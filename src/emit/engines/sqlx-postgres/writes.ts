import type { FieldIR, ModelIR } from "../../../ir/types.js";
import { toSnakeCase } from "../../../ir/names.js";
import { filterFamilyForRustType } from "../../filters/model.js";
import { bindFromBorrow, bindFromStruct } from "./bind-ref.js";
import type { ModuleResolver } from "../../type-ref.js";

/**
 * Build the comma-separated, double-quoted column list for a `RETURNING`
 * clause. Order matches `m.scalarFields` so the `FromRow` impl (which reads
 * by name) stays correct regardless of column ordering.
 */
function colsList(m: ModelIR): string {
  return m.scalarFields.map((f) => `"${f.dbName}"`).join(", ");
}

/**
 * Wrap a SQL snippet (that itself contains double-quoted identifiers) in a
 * Rust raw-string literal so we can splice it into a generated source file
 * without escaping every embedded `"`. Uses `r#"..."#` — the double-`#`
 * variant would only be needed if the snippet contained `"#`, which it
 * never does for column lists.
 */
function rustRawString(sql: string): string {
  return `r#"${sql}"#`;
}

/**
 * Locate the model's single `@id` scalar field. Returns `null` for composite
 * primary keys (which the v1 emitter doesn't support for single-row write
 * ops) and for models lacking a primary key entirely.
 */
function singleIdField(m: ModelIR): FieldIR | null {
  if (m.idFields.length !== 1) return null;
  const idPrismaName = m.idFields[0]!;
  return m.scalarFields.find((f) => f.prismaName === idPrismaName) ?? null;
}

/**
 * The `*FieldUpdateOperationsInput` structs grow `increment` / `decrement` /
 * `multiply` / `divide` only for numeric scalar families. Other field kinds
 * (String, Bool, DateTime, Uuid, Bytes, Json, enums) only carry `set`.
 *
 * Returns true when the field's op-input struct exposes the numeric branches
 * — driven by the same Rust-type → family resolver the input emitter uses,
 * so the two never diverge.
 */
function fieldHasNumericOps(f: FieldIR): boolean {
  if (f.type.kind !== "scalar") return false;
  const family = filterFamilyForRustType(f.type.rust);
  return (
    family === "Int" ||
    family === "BigInt" ||
    family === "Float" ||
    family === "Decimal"
  );
}

function pushWhereCall(module: string, modelSnake: string): string {
  return `crate::engine::sqlx_postgres::${module}::push_${modelSnake}_where`;
}

/**
 * Emit the column-name pushes for the `create` INSERT, one push per
 * `*UncheckedCreateInput` field.
 *
 * `*UncheckedCreateInput` excludes scalar fields that carry a default — those
 * fields are not addressable from the input struct, so they fall through to
 * the DB's default value. Of the fields that remain:
 *   - non-optional, non-list (required-no-default) → emitted with hard-coded
 *     separators (the first required field has no leading `, `, every
 *     subsequent required field gets a literal `, ` prepended).
 *   - optional or list → emitted with a runtime `first` flag that prepends
 *     `, ` once any prior field (required or optional) has already been
 *     written. The flag is *read* before each conditional optional push but
 *     never assigned dead-end; clippy stays quiet because the final
 *     `first = false` only appears inside a still-reachable branch when at
 *     least one later optional field's condition might be evaluated.
 *
 * Lines are emitted as a flat string array so the caller can splice them
 * between fixed surrounding lines without nested template indentation.
 */
function emitCreateColumnPushes(m: ModelIR): string[] {
  const lines: string[] = [];
  const addressable = m.scalarFields.filter((f) => !f.hasDefault);
  const required = addressable.filter((f) => !(f.optional || f.list));
  const optional = addressable.filter((f) => f.optional || f.list);

  // Required scalars — hardcoded separators, no runtime flag needed.
  required.forEach((f, idx) => {
    const colLit = JSON.stringify(`"${f.dbName}"`);
    if (idx > 0) {
      lines.push(`        cols.push_str(", ");`);
    }
    lines.push(`        cols.push_str(${colLit});`);
  });

  // Optional scalars — wrap each in `if input.<f>.is_some()`. If any required
  // field exists, we always need a leading `, ` for each optional field that
  // activates. Otherwise, track a runtime `any_col` flag so the first
  // activated optional skips its leading `, `.
  if (optional.length > 0) {
    if (required.length > 0) {
      // Every activated optional gets a leading ", ".
      for (const f of optional) {
        const colLit = JSON.stringify(`"${f.dbName}"`);
        lines.push(
          `        if input.${f.rustName}.is_some() {`,
          `            cols.push_str(", ");`,
          `            cols.push_str(${colLit});`,
          `        }`,
        );
      }
    } else {
      // No required fields — first activated optional skips its leading `, `.
      // We need a `any_col` flag, but it must be read after every assignment
      // to keep clippy quiet. Achieved by checking it before EVERY assignment
      // including the first.
      lines.push(`        let mut any_col = false;`);
      for (const f of optional) {
        const colLit = JSON.stringify(`"${f.dbName}"`);
        lines.push(
          `        if input.${f.rustName}.is_some() {`,
          `            if any_col { cols.push_str(", "); }`,
          `            any_col = true;`,
          `            cols.push_str(${colLit});`,
          `        }`,
        );
      }
      // Drop the last possibly-dead assignment by reading it once.
      lines.push(`        let _ = any_col;`);
    }
  }
  return lines;
}

/**
 * Mirror of `emitCreateColumnPushes` for value bindings — same separator
 * logic, but with `qb.push(", ")` and `qb.push_bind(...)` instead of
 * `cols.push_str(...)`.
 */
function emitCreateValuePushes(m: ModelIR): string[] {
  const lines: string[] = [];
  const addressable = m.scalarFields.filter((f) => !f.hasDefault);
  const required = addressable.filter((f) => !(f.optional || f.list));
  const optional = addressable.filter((f) => f.optional || f.list);

  required.forEach((f, idx) => {
    if (idx > 0) {
      lines.push(`        qb.push(", ");`);
    }
    lines.push(`        qb.push_bind(input.${f.rustName});`);
  });

  if (optional.length > 0) {
    if (required.length > 0) {
      for (const f of optional) {
        lines.push(
          `        if let Some(v) = input.${f.rustName} {`,
          `            qb.push(", ");`,
          `            qb.push_bind(v);`,
          `        }`,
        );
      }
    } else {
      lines.push(`        let mut any_val = false;`);
      for (const f of optional) {
        lines.push(
          `        if let Some(v) = input.${f.rustName} {`,
          `            if any_val { qb.push(", "); }`,
          `            any_val = true;`,
          `            qb.push_bind(v);`,
          `        }`,
        );
      }
      lines.push(`        let _ = any_val;`);
    }
  }
  return lines;
}

/**
 * Emit `create` — a sparse INSERT. Only columns whose value is present on
 * the input are named in the column list; absent optional/list fields fall
 * through to the DB default (or NULL for nullable columns with no default).
 *
 * Models without explicit non-default scalars (everything @default()-ed)
 * still need a valid INSERT — we emit `DEFAULT VALUES` in that case.
 */
function emitCreate(m: ModelIR, moduleOf?: ModuleResolver): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const inputPath = `crate::${modulePath}::${m.name}UncheckedCreateInput`;
  const cols = colsList(m);
  const colPushes = emitCreateColumnPushes(m);
  const valPushes = emitCreateValuePushes(m);

  const addressable = m.scalarFields.filter((f) => !f.hasDefault);
  const required = addressable.filter((f) => !(f.optional || f.list));
  const hasAnyAddressable = addressable.length > 0;
  const hasRequired = required.length > 0;

  const body: string[] = [];
  if (!hasAnyAddressable) {
    // Every scalar has a default — the Unchecked input has no addressable
    // fields. Use INSERT DEFAULT VALUES so the row is created from defaults.
    body.push(
      `        let _ = input;`,
      `        let mut qb = sqlx::QueryBuilder::new(`,
      `            r#"INSERT INTO "${m.dbName}" DEFAULT VALUES RETURNING ${cols}"#,`,
      `        );`,
      `        qb.build_query_as::<Self>().fetch_one(executor).await`,
    );
  } else if (hasRequired) {
    // At least one required column is always present — no DEFAULT VALUES
    // fallback needed.
    body.push(
      `        let mut cols = String::new();`,
      ...colPushes,
      `        let mut qb = sqlx::QueryBuilder::new(format!(`,
      `            r#"INSERT INTO "${m.dbName}" ({}) VALUES ("#,`,
      `            cols,`,
      `        ));`,
      ...valPushes,
      `        qb.push(${rustRawString(`) RETURNING ${cols}`)});`,
      `        qb.build_query_as::<Self>().fetch_one(executor).await`,
    );
  } else {
    // Only optional/list fields are addressable — fall back to
    // DEFAULT VALUES when none are provided.
    body.push(
      `        let mut cols = String::new();`,
      ...colPushes,
      `        if cols.is_empty() {`,
      `            let mut qb = sqlx::QueryBuilder::new(`,
      `                r#"INSERT INTO "${m.dbName}" DEFAULT VALUES RETURNING ${cols}"#,`,
      `            );`,
      `            return qb.build_query_as::<Self>().fetch_one(executor).await;`,
      `        }`,
      `        let mut qb = sqlx::QueryBuilder::new(format!(`,
      `            r#"INSERT INTO "${m.dbName}" ({}) VALUES ("#,`,
      `            cols,`,
      `        ));`,
      ...valPushes,
      `        qb.push(${rustRawString(`) RETURNING ${cols}`)});`,
      `        qb.build_query_as::<Self>().fetch_one(executor).await`,
    );
  }

  return [
    `impl ${modelPath} {`,
    `    pub async fn create<'e, E>(`,
    `        executor: E,`,
    `        input: ${inputPath},`,
    `    ) -> sqlx::Result<Self>`,
    `    where`,
    `        E: sqlx::Executor<'e, Database = sqlx::Postgres>,`,
    `    {`,
    ...body,
    `    }`,
    `}`,
  ].join("\n");
}

/**
 * Emit `create_many` — bulk INSERT covering every non-default column on
 * `*UncheckedCreateInput`. Each row binds every column (None binds NULL for
 * nullable columns), so the column list is fixed and `push_values` can
 * iterate the slice without per-row column logic.
 *
 * Returns `u64` rows_affected (no `RETURNING`).
 */
function emitCreateMany(m: ModelIR, moduleOf?: ModuleResolver): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const inputPath = `crate::${modulePath}::${m.name}UncheckedCreateInput`;

  const addressable = m.scalarFields.filter((f) => !f.hasDefault);
  const colsCsv = addressable.map((f) => `"${f.dbName}"`).join(", ");

  const valueBinds = addressable.map(
    (f) => `            row.push_bind(${bindFromStruct(f, `input.${f.rustName}`)});`,
  );

  const body: string[] = [];
  if (addressable.length === 0) {
    // Edge case: no addressable columns (every scalar has @default). A bulk
    // `INSERT INTO t () VALUES ()` is invalid SQL; per-row DEFAULT VALUES
    // would need an &mut Executor that doesn't fit `Executor<'e>`. We defer
    // this to v2 of the engine — surface at runtime via `todo!()` rather
    // than emit broken SQL or a borrowck-unsafe loop.
    body.push(
      `        let _ = (executor, inputs);`,
      `        todo!("create_many for models with no addressable scalars is not supported")`,
    );
  } else {
    body.push(
      `        if inputs.is_empty() { return Ok(0); }`,
      `        let mut qb = sqlx::QueryBuilder::new(`,
      `            r#"INSERT INTO "${m.dbName}" (${colsCsv}) "#,`,
      `        );`,
      `        qb.push_values(inputs, |mut row, input| {`,
      ...valueBinds,
      `        });`,
      `        let result = qb.build().execute(executor).await?;`,
      `        Ok(result.rows_affected())`,
    );
  }

  return [
    `impl ${modelPath} {`,
    `    pub async fn create_many<'e, E>(`,
    `        executor: E,`,
    `        inputs: &[${inputPath}],`,
    `    ) -> sqlx::Result<u64>`,
    `    where`,
    `        E: sqlx::Executor<'e, Database = sqlx::Postgres>,`,
    `    {`,
    ...body,
    `    }`,
    `}`,
  ].join("\n");
}

/**
 * Emit per-field SET clauses for a row update. Walks `*UncheckedUpdateInput`
 * (or `*UncheckedUpdateManyInput` — they have the same scalar shape) and
 * pushes `"<col>" = $n` for each `Some(op)` whose `set` (or numeric op) is
 * also `Some`.
 *
 * For nullable scalar fields the op's `set` is `Option<Option<T>>` — outer
 * `Some` means "the caller wants to set this column", inner `Some(v)` /
 * `None` chooses the new value (v or NULL). sqlx binds `Option<T>` as either
 * the value or NULL, so we can bind the inner Option directly without
 * unwrapping.
 */
function emitUpdateSetClauses(m: ModelIR): string[] {
  const lines: string[] = [];
  for (const f of m.scalarFields) {
    const colEq = JSON.stringify(`"${f.dbName}" = `);
    lines.push(`        if let Some(op) = input.${f.rustName} {`);
    // `set` arm. For nullable fields op.set is Option<Option<T>>; for
    // non-nullable it's Option<T>. Either way, the outer `if let Some(v)`
    // gives us the value to bind directly.
    lines.push(
      `            if let Some(v) = op.set {`,
      `                if !first { qb.push(", "); }`,
      `                first = false;`,
      `                qb.push(${colEq});`,
      `                qb.push_bind(v);`,
      `            }`,
    );
    if (fieldHasNumericOps(f)) {
      // For numeric ops the op-input struct stores Option<T> (never
      // Option<Option<T>>) — increment by NULL would be meaningless.
      const incLit = JSON.stringify(`"${f.dbName}" = "${f.dbName}" + `);
      const decLit = JSON.stringify(`"${f.dbName}" = "${f.dbName}" - `);
      const mulLit = JSON.stringify(`"${f.dbName}" = "${f.dbName}" * `);
      const divLit = JSON.stringify(`"${f.dbName}" = "${f.dbName}" / `);
      lines.push(
        `            if let Some(v) = op.increment {`,
        `                if !first { qb.push(", "); }`,
        `                first = false;`,
        `                qb.push(${incLit});`,
        `                qb.push_bind(v);`,
        `            }`,
        `            if let Some(v) = op.decrement {`,
        `                if !first { qb.push(", "); }`,
        `                first = false;`,
        `                qb.push(${decLit});`,
        `                qb.push_bind(v);`,
        `            }`,
        `            if let Some(v) = op.multiply {`,
        `                if !first { qb.push(", "); }`,
        `                first = false;`,
        `                qb.push(${mulLit});`,
        `                qb.push_bind(v);`,
        `            }`,
        `            if let Some(v) = op.divide {`,
        `                if !first { qb.push(", "); }`,
        `                first = false;`,
        `                qb.push(${divLit});`,
        `                qb.push_bind(v);`,
        `            }`,
        );
    }
    lines.push(`        }`);
  }
  return lines;
}

/**
 * Emit `update` — locate one row by `WhereUniqueInput` and apply
 * `*UncheckedUpdateInput`. Composite-id models emit a `todo!()` body
 * (same v1 deferral as `find_unique`).
 */
function emitUpdate(m: ModelIR, moduleOf?: ModuleResolver): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const inputPath = `crate::${modulePath}::${m.name}UncheckedUpdateInput`;
  const whereUniquePath = `crate::${modulePath}::${m.name}WhereUniqueInput`;
  const cols = colsList(m);

  const idField = singleIdField(m);

  const body: string[] = [];
  if (idField === null) {
    body.push(
      `        let _ = (executor, w, input);`,
      `        todo!("composite unique not yet supported")`,
    );
  } else {
    const idColEq = JSON.stringify(`"${idField.dbName}" = `);
    const setClauses = emitUpdateSetClauses(m);
    body.push(
      `        let mut qb = sqlx::QueryBuilder::new(`,
      `            r#"UPDATE "${m.dbName}" SET "#,`,
      `        );`,
      `        let mut first = true;`,
      ...setClauses,
      `        if first {`,
      `            // Nothing to update — fall back to a plain find_unique so the`,
      `            // caller still gets the row back (or RowNotFound if absent).`,
      `            return Self::find_unique(executor, w).await?.ok_or(sqlx::Error::RowNotFound);`,
      `        }`,
      `        qb.push(" WHERE ");`,
      `        if let Some(value) = &w.${idField.rustName} {`,
      `            qb.push(${idColEq});`,
      `            qb.push_bind(${bindFromBorrow(idField, "value")});`,
      `        } else {`,
      `            return Err(sqlx::Error::RowNotFound);`,
      `        }`,
      `        qb.push(${rustRawString(` RETURNING ${cols}`)});`,
      `        qb.build_query_as::<Self>().fetch_one(executor).await`,
    );
  }

  return [
    `impl ${modelPath} {`,
    `    pub async fn update<'e, E>(`,
    `        executor: E,`,
    `        w: &${whereUniquePath},`,
    `        input: ${inputPath},`,
    `    ) -> sqlx::Result<Self>`,
    `    where`,
    `        E: sqlx::Executor<'e, Database = sqlx::Postgres>,`,
    `    {`,
    ...body,
    `    }`,
    `}`,
  ].join("\n");
}

/**
 * Emit `update_many` — bulk update by `WhereInput`. Returns `u64`
 * rows_affected, no `RETURNING`. Skips when no SET clauses were produced
 * (avoids invalid `UPDATE t SET WHERE ...` SQL).
 */
function emitUpdateMany(m: ModelIR, moduleOf?: ModuleResolver): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const inputPath = `crate::${modulePath}::${m.name}UncheckedUpdateManyInput`;
  const whereInputPath = `crate::${modulePath}::${m.name}WhereInput`;
  const modelSnake = toSnakeCase(m.name);
  const pushWhere = pushWhereCall(modulePath, modelSnake);

  const setClauses = emitUpdateSetClauses(m);

  return [
    `impl ${modelPath} {`,
    `    pub async fn update_many<'e, E>(`,
    `        executor: E,`,
    `        w: &${whereInputPath},`,
    `        input: ${inputPath},`,
    `    ) -> sqlx::Result<u64>`,
    `    where`,
    `        E: sqlx::Executor<'e, Database = sqlx::Postgres>,`,
    `    {`,
    `        let mut qb = sqlx::QueryBuilder::new(`,
    `            r#"UPDATE "${m.dbName}" SET "#,`,
    `        );`,
    `        let mut first = true;`,
    ...setClauses,
    `        if first {`,
    `            // No-op update — return 0 rows affected without issuing SQL.`,
    `            return Ok(0);`,
    `        }`,
    `        qb.push(" WHERE ");`,
    `        if !${pushWhere}(&mut qb, w) {`,
    `            qb.push("TRUE");`,
    `        }`,
    `        let result = qb.build().execute(executor).await?;`,
    `        Ok(result.rows_affected())`,
    `    }`,
    `}`,
  ].join("\n");
}

/**
 * Emit `delete` — locate one row by `WhereUniqueInput` and remove it,
 * returning the deleted row via `RETURNING`. Composite-id models emit a
 * `todo!()` body.
 */
function emitDelete(m: ModelIR, moduleOf?: ModuleResolver): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const whereUniquePath = `crate::${modulePath}::${m.name}WhereUniqueInput`;
  const cols = colsList(m);
  const idField = singleIdField(m);

  const body: string[] = [];
  if (idField === null) {
    body.push(
      `        let _ = (executor, w);`,
      `        todo!("composite unique not yet supported")`,
    );
  } else {
    const idColEq = JSON.stringify(`"${idField.dbName}" = `);
    body.push(
      `        let mut qb = sqlx::QueryBuilder::new(`,
      `            r#"DELETE FROM "${m.dbName}" WHERE "#,`,
      `        );`,
      `        if let Some(value) = &w.${idField.rustName} {`,
      `            qb.push(${idColEq});`,
      `            qb.push_bind(${bindFromBorrow(idField, "value")});`,
      `        } else {`,
      `            return Err(sqlx::Error::RowNotFound);`,
      `        }`,
      `        qb.push(${rustRawString(` RETURNING ${cols}`)});`,
      `        qb.build_query_as::<Self>().fetch_one(executor).await`,
    );
  }

  return [
    `impl ${modelPath} {`,
    `    pub async fn delete<'e, E>(`,
    `        executor: E,`,
    `        w: &${whereUniquePath},`,
    `    ) -> sqlx::Result<Self>`,
    `    where`,
    `        E: sqlx::Executor<'e, Database = sqlx::Postgres>,`,
    `    {`,
    ...body,
    `    }`,
    `}`,
  ].join("\n");
}

/**
 * Emit `delete_many` — bulk DELETE by `WhereInput`. Returns `u64`
 * rows_affected. Empty WHERE inputs translate to `WHERE TRUE` (delete all),
 * matching Prisma's semantics.
 */
function emitDeleteMany(m: ModelIR, moduleOf?: ModuleResolver): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const whereInputPath = `crate::${modulePath}::${m.name}WhereInput`;
  const modelSnake = toSnakeCase(m.name);
  const pushWhere = pushWhereCall(modulePath, modelSnake);

  return [
    `impl ${modelPath} {`,
    `    pub async fn delete_many<'e, E>(`,
    `        executor: E,`,
    `        w: &${whereInputPath},`,
    `    ) -> sqlx::Result<u64>`,
    `    where`,
    `        E: sqlx::Executor<'e, Database = sqlx::Postgres>,`,
    `    {`,
    `        let mut qb = sqlx::QueryBuilder::new(`,
    `            r#"DELETE FROM "${m.dbName}" WHERE "#,`,
    `        );`,
    `        if !${pushWhere}(&mut qb, w) {`,
    `            qb.push("TRUE");`,
    `        }`,
    `        let result = qb.build().execute(executor).await?;`,
    `        Ok(result.rows_affected())`,
    `    }`,
    `}`,
  ].join("\n");
}

/**
 * Emit the full write-path surface for a model: create / create_many /
 * update / update_many / delete / delete_many as inherent impls on the
 * generated model struct.
 *
 * Each operation lives in its own `impl <Model>` block so the source is
 * easy to scan; rustc folds them into one impl table at compile time.
 *
 * Single-row ops (`create`, `update`, `delete`) use `RETURNING` to fetch
 * the affected row. Bulk ops (`create_many`, `update_many`, `delete_many`)
 * return `u64` rows_affected.
 */
export function emitWrites(m: ModelIR, moduleOf?: ModuleResolver): string {
  return [
    emitCreate(m, moduleOf),
    emitCreateMany(m, moduleOf),
    emitUpdate(m, moduleOf),
    emitUpdateMany(m, moduleOf),
    emitDelete(m, moduleOf),
    emitDeleteMany(m, moduleOf),
    "",
  ].join("\n\n");
}
