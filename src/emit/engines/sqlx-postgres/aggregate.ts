import type { FieldIR, ModelIR } from "../../../ir/types.js";
import { toSnakeCase } from "../../../ir/names.js";
import type { ModuleResolver } from "../../type-ref.js";

/**
 * Aggregate-method emitter for the sqlx-postgres engine.
 *
 * Emits two artifacts per model:
 *   1. `<M>AggregateResult` (+ `<M>{Count,Avg,Sum,Min,Max}AggregateResult`) —
 *      strongly-typed Rust structs mirroring the input-side aggregate selectors
 *      but holding computed values instead of `Option<bool>` flags.
 *   2. `impl <M> { pub async fn aggregate(...) }` — runs a single SELECT that
 *      computes every possible aggregation column unconditionally (cheap on
 *      Postgres for one row) and unpacks the row into `<M>AggregateResult`
 *      using the requesting input's `Option<bool>` flags to decide which
 *      fields to populate.
 *
 * Pragmatic v1 type choices:
 *   - Count returns are always `i64` (Postgres `COUNT` is `bigint`).
 *   - Avg and Sum are cast to `double precision` in SQL so the binding type is
 *     always `Option<f64>` regardless of source column type. This loses
 *     precision for Decimal columns (acknowledged limitation, see CHANGELOG).
 *   - Min/Max preserve the source column's Rust type, wrapped in `Option<T>`
 *     because both functions return NULL on empty tables.
 *
 * Models with no orderable scalars (every field is Json/Bytes) still emit the
 * empty Min/Max result structs and the method — the SELECT just won't compute
 * those columns, and the unpacking returns `None` for everything.
 */

/** Numeric Rust types that flow through Avg/Sum. Mirrors the input emitter. */
const NUMERIC_RUSTS = new Set([
  "i16",
  "i32",
  "i64",
  "u32",
  "f32",
  "f64",
  "rust_decimal::Decimal",
  "bigdecimal::BigDecimal",
]);

const NON_ORDERABLE_RUSTS = new Set(["serde_json::Value"]);

function isNumeric(f: FieldIR): boolean {
  return f.type.kind === "scalar" && NUMERIC_RUSTS.has(f.type.rust);
}

function isOrderable(f: FieldIR): boolean {
  if (f.type.kind !== "scalar") return false;
  return !NON_ORDERABLE_RUSTS.has(f.type.rust) && f.type.rust !== "Vec<u8>";
}

/**
 * Map a field's IR type to the Rust type used for Min/Max aggregation result
 * fields. Enums and scalars decode through their natural Rust mapping; relation
 * fields don't reach this path (we only iterate `scalarFields`).
 */
function minMaxRustType(f: FieldIR, moduleOf?: ModuleResolver): string {
  if (f.type.kind === "scalar") return f.type.rust;
  if (f.type.kind === "enumRef") {
    const resolved = moduleOf ? moduleOf(f.type.enumName) : f.type.module;
    const mod = resolved ? `crate::${resolved}::` : `crate::`;
    return `${mod}${f.type.enumName}`;
  }
  // modelRef should never appear in scalarFields, but stay defensive.
  return "()";
}

/**
 * Emit the five per-aggregation result structs plus the bundle struct.
 *
 * Each per-aggregation struct holds `Option<T>` per field: `None` when the
 * caller didn't request that aggregation for that column, `Some(value)` when
 * it was requested. Counts are always `i64`; Avg/Sum are always `f64` to
 * sidestep Postgres's variable return types; Min/Max preserve source types.
 */
function emitResultStructs(m: ModelIR, moduleOf?: ModuleResolver): string {
  const lines: string[] = [];
  const ser = (rename: string): string => `#[serde(rename = "${rename}")]`;

  // Count: one Option<i64> per scalar + _all.
  lines.push(
    `#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]`,
    `#[serde(rename_all = "camelCase")]`,
    `pub struct ${m.name}CountAggregateResult {`,
  );
  for (const f of m.scalarFields) {
    lines.push(`    pub ${f.rustName}: Option<i64>,`);
  }
  lines.push(`    ${ser("_all")}`);
  lines.push(`    pub aggregate_all: Option<i64>,`);
  lines.push(`}`, ``);

  // Avg: one Option<f64> per numeric scalar.
  lines.push(
    `#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]`,
    `#[serde(rename_all = "camelCase")]`,
    `pub struct ${m.name}AvgAggregateResult {`,
  );
  for (const f of m.scalarFields) {
    if (!isNumeric(f)) continue;
    lines.push(`    pub ${f.rustName}: Option<f64>,`);
  }
  lines.push(`}`, ``);

  // Sum: one Option<f64> per numeric scalar (cast to double precision in SQL).
  lines.push(
    `#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]`,
    `#[serde(rename_all = "camelCase")]`,
    `pub struct ${m.name}SumAggregateResult {`,
  );
  for (const f of m.scalarFields) {
    if (!isNumeric(f)) continue;
    lines.push(`    pub ${f.rustName}: Option<f64>,`);
  }
  lines.push(`}`, ``);

  // Min: one Option<T> per orderable scalar.
  lines.push(
    `#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]`,
    `#[serde(rename_all = "camelCase")]`,
    `pub struct ${m.name}MinAggregateResult {`,
  );
  for (const f of m.scalarFields) {
    if (!isOrderable(f)) continue;
    lines.push(`    pub ${f.rustName}: Option<${minMaxRustType(f, moduleOf)}>,`);
  }
  lines.push(`}`, ``);

  // Max mirrors Min exactly.
  lines.push(
    `#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]`,
    `#[serde(rename_all = "camelCase")]`,
    `pub struct ${m.name}MaxAggregateResult {`,
  );
  for (const f of m.scalarFields) {
    if (!isOrderable(f)) continue;
    lines.push(`    pub ${f.rustName}: Option<${minMaxRustType(f, moduleOf)}>,`);
  }
  lines.push(`}`, ``);

  // Bundle.
  lines.push(
    `#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]`,
    `#[serde(rename_all = "camelCase")]`,
    `pub struct ${m.name}AggregateResult {`,
    `    ${ser("_count")}`,
    `    pub aggregate_count: Option<${m.name}CountAggregateResult>,`,
    `    ${ser("_avg")}`,
    `    pub aggregate_avg: Option<${m.name}AvgAggregateResult>,`,
    `    ${ser("_sum")}`,
    `    pub aggregate_sum: Option<${m.name}SumAggregateResult>,`,
    `    ${ser("_min")}`,
    `    pub aggregate_min: Option<${m.name}MinAggregateResult>,`,
    `    ${ser("_max")}`,
    `    pub aggregate_max: Option<${m.name}MaxAggregateResult>,`,
    `}`,
  );

  return lines.join("\n");
}

/**
 * SQL column aliases — kept distinct per (aggregation, field) so unpacking the
 * row by alias is unambiguous. The aliases use the field's snake-case Rust
 * name (not the DB column name) so they're guaranteed to be valid SQL
 * identifiers and easy to map back to struct fields.
 */
function countAlias(f: FieldIR): string {
  return `count_${f.rustName}`;
}
function avgAlias(f: FieldIR): string {
  return `avg_${f.rustName}`;
}
function sumAlias(f: FieldIR): string {
  return `sum_${f.rustName}`;
}
function minAlias(f: FieldIR): string {
  return `min_${f.rustName}`;
}
function maxAlias(f: FieldIR): string {
  return `max_${f.rustName}`;
}

/**
 * Build the SELECT clause as a fixed string — every possible aggregation column
 * is computed regardless of what the caller asked for. Trades a few unused
 * column computations for trivial unpacking.
 */
function buildSelectClause(m: ModelIR): string {
  // COUNT(*) is always present so the result struct can populate `_all`
  // without relying on any per-field column existing.
  const parts: string[] = [`COUNT(*) AS count_all`];
  for (const f of m.scalarFields) {
    parts.push(`COUNT("${f.dbName}") AS ${countAlias(f)}`);
  }
  for (const f of m.scalarFields) {
    if (!isNumeric(f)) continue;
    // Cast to double precision so the binding type is always f64. Sidesteps
    // Postgres's NUMERIC returns for SUM(int) and AVG(decimal).
    parts.push(
      `AVG("${f.dbName}")::double precision AS ${avgAlias(f)}`,
      `SUM("${f.dbName}")::double precision AS ${sumAlias(f)}`,
    );
  }
  for (const f of m.scalarFields) {
    if (!isOrderable(f)) continue;
    parts.push(
      `MIN("${f.dbName}") AS ${minAlias(f)}`,
      `MAX("${f.dbName}") AS ${maxAlias(f)}`,
    );
  }
  return parts.join(", ");
}

/**
 * Emit the row-unpacking expression for a single per-aggregation result, gated
 * on the corresponding input field being `Some(true)`. Produces a
 * `<M>{Count,Avg,Sum,Min,Max}AggregateResult` literal.
 *
 * Each field reads the row via `row.try_get(alias)`. Because every column is
 * always in the SELECT, `try_get` will always find the column — the value can
 * still be NULL for empty tables, which decodes to `None` for the
 * `Option<T>`-typed binding.
 *
 * The wrapping pattern is `input.X.as_ref().map(|req| -> sqlx::Result<_> {
 * Ok(...) }).transpose()?` — keeps the per-field `?`s inside the closure body
 * while still propagating errors at the outer struct level. Avoids clippy's
 * `manual_map` lint that fires on `match Option<T> { None => None, Some(x) =>
 * Some(...) }`.
 */
function emitUnpackBlock(
  reqField: string,
  resultStruct: string,
  fieldLines: string[],
  reqBinding: string,
): string[] {
  return [
    `        ${reqField}: input.${reqField}.as_ref().map(|${reqBinding}| -> sqlx::Result<_> {`,
    `            Ok(${resultStruct} {`,
    ...fieldLines.map((fl) => `                ${fl}`),
    `            })`,
    `        }).transpose()?,`,
  ];
}

function emitCountUnpack(m: ModelIR): string[] {
  const fieldLines: string[] = [];
  for (const f of m.scalarFields) {
    fieldLines.push(
      `${f.rustName}: if req.${f.rustName}.unwrap_or(false) { row.try_get::<Option<i64>, _>("${countAlias(f)}")? } else { None },`,
    );
  }
  fieldLines.push(
    `aggregate_all: if req.aggregate_all.unwrap_or(false) { row.try_get::<Option<i64>, _>("count_all")? } else { None },`,
  );
  // Count always has at least `_all`, so `req` is always read.
  return emitUnpackBlock(
    "aggregate_count",
    `${m.name}CountAggregateResult`,
    fieldLines,
    "req",
  );
}

function emitNumericUnpack(
  m: ModelIR,
  kind: "Avg" | "Sum",
  aliasOf: (f: FieldIR) => string,
): string[] {
  const reqField = kind === "Avg" ? "aggregate_avg" : "aggregate_sum";
  const resultStruct = `${m.name}${kind}AggregateResult`;
  const fieldLines: string[] = [];
  for (const f of m.scalarFields) {
    if (!isNumeric(f)) continue;
    fieldLines.push(
      `${f.rustName}: if req.${f.rustName}.unwrap_or(false) { row.try_get::<Option<f64>, _>("${aliasOf(f)}")? } else { None },`,
    );
  }
  // If the result struct is empty (no numeric scalars), the closure body
  // doesn't read `req` — bind it as `_req` to keep clippy quiet.
  const binding = fieldLines.length === 0 ? "_req" : "req";
  return emitUnpackBlock(reqField, resultStruct, fieldLines, binding);
}

function emitOrderableUnpack(
  m: ModelIR,
  kind: "Min" | "Max",
  aliasOf: (f: FieldIR) => string,
  moduleOf?: ModuleResolver,
): string[] {
  const reqField = kind === "Min" ? "aggregate_min" : "aggregate_max";
  const resultStruct = `${m.name}${kind}AggregateResult`;
  const fieldLines: string[] = [];
  for (const f of m.scalarFields) {
    if (!isOrderable(f)) continue;
    const ty = minMaxRustType(f, moduleOf);
    fieldLines.push(
      `${f.rustName}: if req.${f.rustName}.unwrap_or(false) { row.try_get::<Option<${ty}>, _>("${aliasOf(f)}")? } else { None },`,
    );
  }
  const binding = fieldLines.length === 0 ? "_req" : "req";
  return emitUnpackBlock(reqField, resultStruct, fieldLines, binding);
}

/**
 * Emit the `aggregate` inherent method on the model.
 */
function emitAggregateMethod(m: ModelIR, moduleOf?: ModuleResolver): string {
  const modelSnake = toSnakeCase(m.name);
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const inputPath = `crate::${modulePath}::${m.name}AggregateInput`;
  // Result structs live in the engine module alongside the method, so the
  // return type is a bare path (the method body is in the same module).
  const resultPath = `${m.name}AggregateResult`;
  const pushWhere = `crate::engine::sqlx_postgres::${modulePath}::push_${modelSnake}_where`;

  const selectClause = buildSelectClause(m);

  const body: string[] = [
    `        let mut qb = sqlx::QueryBuilder::new(`,
    `            r#"SELECT ${selectClause} FROM "${m.dbName}" WHERE "#,`,
    `        );`,
    `        if let Some(w) = &input.r#where {`,
    `            if !${pushWhere}(&mut qb, w) {`,
    `                qb.push("TRUE");`,
    `            }`,
    `        } else {`,
    `            qb.push("TRUE");`,
    `        }`,
    `        let row = qb.build().fetch_one(executor).await?;`,
    `        use sqlx::Row;`,
    `        Ok(${m.name}AggregateResult {`,
    ...emitCountUnpack(m),
    ...emitNumericUnpack(m, "Avg", avgAlias),
    ...emitNumericUnpack(m, "Sum", sumAlias),
    ...emitOrderableUnpack(m, "Min", minAlias, moduleOf),
    ...emitOrderableUnpack(m, "Max", maxAlias, moduleOf),
    `        })`,
  ];

  return [
    `impl ${modelPath} {`,
    `    pub async fn aggregate<'e, E>(`,
    `        executor: E,`,
    `        input: &${inputPath},`,
    `    ) -> sqlx::Result<${resultPath}>`,
    `    where`,
    `        E: sqlx::Executor<'e, Database = sqlx::Postgres>,`,
    `    {`,
    ...body,
    `    }`,
    `}`,
    ``,
  ].join("\n");
}

/**
 * Top-level entrypoint — emits the result struct family + the aggregate
 * method for a single model. The result structs are emitted into the engine
 * module (alongside the method) rather than the schema module, so the schema
 * module stays focused on shape definitions and the engine owns its own
 * unpacking types.
 */
export function emitAggregate(m: ModelIR, moduleOf?: ModuleResolver): string {
  return [emitResultStructs(m, moduleOf), ``, emitAggregateMethod(m, moduleOf)].join("\n");
}
