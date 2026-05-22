import type { FieldIR, ModelIR } from "../../../ir/types.js";
import { toSnakeCase } from "../../../ir/names.js";
import { filterFamilyForRustType } from "../../filters/model.js";
import type { Backend } from "./backend.js";
import { bindFromBorrow, bindFromStruct } from "./bind-ref.js";
import { quoteIdent } from "./quote-ident.js";
import type { ModuleResolver } from "../../type-ref.js";

/**
 * Build the comma-separated, backend-quoted column list for a `RETURNING`
 * clause. Order matches `m.scalarFields` so the `FromRow` impl (which reads
 * by name) stays correct regardless of column ordering.
 */
function colsList(m: ModelIR, backend: Backend): string {
  return m.scalarFields.map((f) => quoteIdent(backend, f.dbName)).join(", ");
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
 * Count the number of distinct fields the emitter places into
 * `${Model}WhereUniqueInput`. Mirrors the collection logic in
 * `src/emit/inputs/where-unique.ts` — union of `idFields` and each
 * `uniqueGroups.fields`, deduped by prisma name.
 *
 * Used to decide whether the requery write path can drop the
 * `..Default::default()` struct-update tail on the find_unique call. When
 * the WhereUniqueInput has exactly one field, clippy's `needless_update`
 * fires on the tail; eliding it keeps the generated code lint-clean.
 */
function uniqueFieldCount(m: ModelIR): number {
  const names = new Set<string>(m.idFields);
  for (const g of m.uniqueGroups) for (const f of g.fields) names.add(f);
  return names.size;
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

function pushWhereCall(
  backend: Backend,
  module: string,
  modelSnake: string,
): string {
  return `crate::engine::${backend.dirName}::${module}::push_${modelSnake}_where`;
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
function emitCreateColumnPushes(m: ModelIR, backend: Backend): string[] {
  const lines: string[] = [];
  const addressable = m.scalarFields.filter((f) => !f.hasDefault);
  const required = addressable.filter((f) => !(f.optional || f.list));
  const optional = addressable.filter((f) => f.optional || f.list);

  // Required scalars — hardcoded separators, no runtime flag needed.
  required.forEach((f, idx) => {
    const colLit = JSON.stringify(quoteIdent(backend, f.dbName));
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
        const colLit = JSON.stringify(quoteIdent(backend, f.dbName));
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
        const colLit = JSON.stringify(quoteIdent(backend, f.dbName));
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
 * Per-id-field strategy for the requery write path. Selected at emit time
 * from `FieldIR.defaultKind` so the generated `create()` body knows how to
 * look up the row it just inserted.
 *
 *   "last-insert-id"   — autoincrement @id; read back via
 *                        `result.last_insert_id()`.
 *   "client-generated" — String @id @default(uuid()|cuid()); generate the
 *                        value before the INSERT and inject it as the
 *                        @id column value, then re-use it for find_unique.
 *   "user-supplied"    — the @id is part of the input struct (no default,
 *                        or @default(literal)); read straight from input.
 *   "unsupported"      — `dbgenerated` or `@default(now())` on @id, or a
 *                        backend that returns "unsupported" from
 *                        insertedIdStrategy. Generates a `todo!()` body.
 */
type IdDiscoveryStrategy =
  | { kind: "last-insert-id" }
  | { kind: "client-generated" }
  | { kind: "user-supplied" }
  | { kind: "unsupported"; reason: string };

function pickInsertedIdStrategy(
  idField: FieldIR,
  backend: Backend,
): IdDiscoveryStrategy {
  const dk = idField.defaultKind;
  if (dk === null || dk === "literal" || dk === "other") {
    return { kind: "user-supplied" };
  }
  if (dk === "dbgenerated") {
    return {
      kind: "unsupported",
      reason: "dbgenerated @id not supported on requery backends",
    };
  }
  if (dk === "now") {
    return {
      kind: "unsupported",
      reason: "@default(now()) on @id not supported on requery backends",
    };
  }
  // autoincrement / uuid / cuid → ask the backend.
  const strategy = backend.insertedIdStrategy(dk);
  if (strategy === "last-insert-id") return { kind: "last-insert-id" };
  if (strategy === "client-generated") return { kind: "client-generated" };
  return {
    kind: "unsupported",
    reason: "backend reports no strategy for this default kind",
  };
}

/**
 * Top-level dispatcher: branches on `backend.writeStrategy`.
 * "returning" → classic v0.3.0 emission (Postgres + SQLite).
 * "requery"   → INSERT/UPDATE/DELETE followed by a find_unique fetch (MySQL).
 */
function emitCreate(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  if (backend.writeStrategy === "returning") {
    return emitCreateReturning(m, backend, moduleOf);
  }
  return emitCreateRequery(m, backend, moduleOf);
}

/**
 * Emit `create` — a sparse INSERT. Only columns whose value is present on
 * the input are named in the column list; absent optional/list fields fall
 * through to the DB default (or NULL for nullable columns with no default).
 *
 * Models without explicit non-default scalars (everything @default()-ed)
 * still need a valid INSERT — we emit `DEFAULT VALUES` in that case.
 */
function emitCreateReturning(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const inputPath = `crate::${modulePath}::${m.name}UncheckedCreateInput`;
  const cols = colsList(m, backend);
  const tableQ = quoteIdent(backend, m.dbName);
  const colPushes = emitCreateColumnPushes(m, backend);
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
      `            r#"INSERT INTO ${tableQ} DEFAULT VALUES RETURNING ${cols}"#,`,
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
      `            r#"INSERT INTO ${tableQ} ({}) VALUES ("#,`,
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
      `                r#"INSERT INTO ${tableQ} DEFAULT VALUES RETURNING ${cols}"#,`,
      `            );`,
      `            return qb.build_query_as::<Self>().fetch_one(executor).await;`,
      `        }`,
      `        let mut qb = sqlx::QueryBuilder::new(format!(`,
      `            r#"INSERT INTO ${tableQ} ({}) VALUES ("#,`,
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
    `        E: sqlx::Executor<'e, Database = ${backend.dbType}>,`,
    `    {`,
    ...body,
    `    }`,
    `}`,
  ].join("\n");
}

/**
 * Emit `create` for backends without RETURNING (writeStrategy === "requery").
 *
 * Strategy: take an `sqlx::Acquire` (so we can re-use the same connection
 * for both the INSERT and the follow-up find_unique), run the INSERT,
 * derive the id of the inserted row (via `result.last_insert_id()`, a
 * client-generated uuid, or an id pulled from the input), then
 * `find_unique` the row back.
 *
 * Composite-id models, and models whose @id can't be discovered after the
 * INSERT (e.g. `dbgenerated`, `@default(now())`), emit a `todo!()` body.
 */
function emitCreateRequery(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const inputPath = `crate::${modulePath}::${m.name}UncheckedCreateInput`;
  const whereUniquePath = `crate::${modulePath}::${m.name}WhereUniqueInput`;
  const tableQ = quoteIdent(backend, m.dbName);

  const idField = singleIdField(m);

  const sig = [
    `    pub async fn create<'e, A>(`,
    `        acq: A,`,
    `        input: ${inputPath},`,
    `    ) -> sqlx::Result<Self>`,
    `    where`,
    `        A: sqlx::Acquire<'e, Database = ${backend.dbType}>,`,
    `    {`,
  ];

  if (idField === null) {
    return [
      `impl ${modelPath} {`,
      ...sig,
      `        let _ = (acq, input);`,
      `        todo!("composite unique not yet supported")`,
      `    }`,
      `}`,
    ].join("\n");
  }

  const strategy = pickInsertedIdStrategy(idField, backend);
  if (strategy.kind === "unsupported") {
    return [
      `impl ${modelPath} {`,
      ...sig,
      `        let _ = (acq, input);`,
      `        todo!(${JSON.stringify(`create() requires a supported id-discovery strategy; got: ${strategy.reason}`)})`,
      `    }`,
      `}`,
    ].join("\n");
  }

  const idRustType = idField.type.kind === "scalar" ? idField.type.rust : "()";
  const idColLit = JSON.stringify(quoteIdent(backend, idField.dbName));
  let idIsCopy = false;
  if (idField.type.kind === "scalar") idIsCopy = idField.type.copy;
  else if (idField.type.kind === "enumRef") idIsCopy = true;

  const addressable = m.scalarFields.filter((f) => !f.hasDefault);
  const required = addressable.filter((f) => !(f.optional || f.list));
  const optional = addressable.filter((f) => f.optional || f.list);
  const hasAnyAddressable = addressable.length > 0;
  const hasRequired = required.length > 0;

  // Will the INSERT bind a `result` we need to read back? Only the
  // last-insert-id strategy reads result; all others can use `_result`
  // to keep clippy quiet.
  const needsResult = strategy.kind === "last-insert-id";
  const resultBinding = needsResult ? "let result" : "let _result";

  const body: string[] = [`        let mut conn = acq.acquire().await?;`];

  if (strategy.kind === "client-generated") {
    body.push(`        let _generated_id: ${idRustType} = uuid::Uuid::new_v4().to_string();`);
  }

  if (strategy.kind === "user-supplied") {
    const idExpr = idIsCopy ? `input.${idField.rustName}` : `input.${idField.rustName}.clone()`;
    body.push(`        let _user_id: ${idRustType} = ${idExpr};`);
  }

  if (strategy.kind === "client-generated") {
    // INSERT prepends the id column.
    body.push(`        let mut cols = String::new();`);
    body.push(`        cols.push_str(${idColLit});`);
    for (const f of required) {
      const colLit = JSON.stringify(quoteIdent(backend, f.dbName));
      body.push(
        `        cols.push_str(", ");`,
        `        cols.push_str(${colLit});`,
      );
    }
    for (const f of optional) {
      const colLit = JSON.stringify(quoteIdent(backend, f.dbName));
      body.push(
        `        if input.${f.rustName}.is_some() {`,
        `            cols.push_str(", ");`,
        `            cols.push_str(${colLit});`,
        `        }`,
      );
    }
    body.push(
      `        let mut qb = sqlx::QueryBuilder::new(format!(`,
      `            r#"INSERT INTO ${tableQ} ({}) VALUES ("#,`,
      `            cols,`,
      `        ));`,
    );
    body.push(`        qb.push_bind(_generated_id.clone());`);
    for (const f of required) {
      body.push(
        `        qb.push(", ");`,
        `        qb.push_bind(input.${f.rustName});`,
      );
    }
    for (const f of optional) {
      body.push(
        `        if let Some(v) = input.${f.rustName} {`,
        `            qb.push(", ");`,
        `            qb.push_bind(v);`,
        `        }`,
      );
    }
    body.push(`        qb.push(")");`);
    body.push(`        ${resultBinding} = qb.build().execute(&mut *conn).await?;`);
  } else if (!hasAnyAddressable) {
    body.push(
      `        let _ = input;`,
      `        let mut qb = sqlx::QueryBuilder::new(`,
      `            r#"INSERT INTO ${tableQ} DEFAULT VALUES"#,`,
      `        );`,
      `        ${resultBinding} = qb.build().execute(&mut *conn).await?;`,
    );
  } else if (hasRequired) {
    body.push(`        let mut cols = String::new();`);
    required.forEach((f, idx) => {
      const colLit = JSON.stringify(quoteIdent(backend, f.dbName));
      if (idx > 0) body.push(`        cols.push_str(", ");`);
      body.push(`        cols.push_str(${colLit});`);
    });
    for (const f of optional) {
      const colLit = JSON.stringify(quoteIdent(backend, f.dbName));
      body.push(
        `        if input.${f.rustName}.is_some() {`,
        `            cols.push_str(", ");`,
        `            cols.push_str(${colLit});`,
        `        }`,
      );
    }
    body.push(
      `        let mut qb = sqlx::QueryBuilder::new(format!(`,
      `            r#"INSERT INTO ${tableQ} ({}) VALUES ("#,`,
      `            cols,`,
      `        ));`,
    );
    required.forEach((f, idx) => {
      if (idx > 0) body.push(`        qb.push(", ");`);
      body.push(`        qb.push_bind(input.${f.rustName});`);
    });
    for (const f of optional) {
      body.push(
        `        if let Some(v) = input.${f.rustName} {`,
        `            qb.push(", ");`,
        `            qb.push_bind(v);`,
        `        }`,
      );
    }
    body.push(`        qb.push(")");`);
    body.push(`        ${resultBinding} = qb.build().execute(&mut *conn).await?;`);
  } else {
    // Only optional/list fields are addressable.
    // For the "no addressable values present" case we fall back to
    // DEFAULT VALUES. We hoist the result binding out of the if/else so
    // last-insert-id can read it uniformly.
    body.push(`        let mut cols = String::new();`);
    body.push(`        let mut any_col = false;`);
    for (const f of optional) {
      const colLit = JSON.stringify(quoteIdent(backend, f.dbName));
      body.push(
        `        if input.${f.rustName}.is_some() {`,
        `            if any_col { cols.push_str(", "); }`,
        `            any_col = true;`,
        `            cols.push_str(${colLit});`,
        `        }`,
      );
    }
    body.push(`        let _ = any_col;`);
    body.push(
      `        ${resultBinding} = if cols.is_empty() {`,
      `            let mut qb = sqlx::QueryBuilder::new(`,
      `                r#"INSERT INTO ${tableQ} DEFAULT VALUES"#,`,
      `            );`,
      `            qb.build().execute(&mut *conn).await?`,
      `        } else {`,
      `            let mut qb = sqlx::QueryBuilder::new(format!(`,
      `                r#"INSERT INTO ${tableQ} ({}) VALUES ("#,`,
      `                cols,`,
      `            ));`,
      `            let mut any_val = false;`,
    );
    for (const f of optional) {
      body.push(
        `            if let Some(v) = input.${f.rustName} {`,
        `                if any_val { qb.push(", "); }`,
        `                any_val = true;`,
        `                qb.push_bind(v);`,
        `            }`,
      );
    }
    body.push(
      `            let _ = any_val;`,
      `            qb.push(")");`,
      `            qb.build().execute(&mut *conn).await?`,
      `        };`,
    );
  }

  // Compute the id used to look up the inserted row.
  if (strategy.kind === "last-insert-id") {
    body.push(`        let id: ${idRustType} = result.last_insert_id() as ${idRustType};`);
  } else if (strategy.kind === "client-generated") {
    body.push(`        let id: ${idRustType} = _generated_id;`);
  } else {
    // user-supplied
    body.push(`        let id: ${idRustType} = _user_id;`);
  }

  // When the WhereUniqueInput has more than the @id field (additional
  // @unique scalars or @@unique groups), the rest stay `None` via
  // `..Default::default()`. With exactly one unique field, the struct is
  // already fully specified and clippy's `needless_update` fires on the
  // tail — elide it in that case.
  const wuTail =
    uniqueFieldCount(m) > 1 ? [`                ..Default::default()`] : [];
  body.push(
    `        Self::find_unique(`,
    `            &mut *conn,`,
    `            &${whereUniquePath} {`,
    `                ${idField.rustName}: Some(id),`,
    ...wuTail,
    `            },`,
    `        )`,
    `        .await?`,
    `        .ok_or(sqlx::Error::RowNotFound)`,
  );

  return [`impl ${modelPath} {`, ...sig, ...body, `    }`, `}`].join("\n");
}

/**
 * Emit `create_many` — bulk INSERT covering every non-default column on
 * `*UncheckedCreateInput`. Each row binds every column (None binds NULL for
 * nullable columns), so the column list is fixed and `push_values` can
 * iterate the slice without per-row column logic.
 *
 * Returns `u64` rows_affected (no `RETURNING`).
 */
function emitCreateMany(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const inputPath = `crate::${modulePath}::${m.name}UncheckedCreateInput`;
  const tableQ = quoteIdent(backend, m.dbName);

  const addressable = m.scalarFields.filter((f) => !f.hasDefault);
  const colsCsv = addressable
    .map((f) => quoteIdent(backend, f.dbName))
    .join(", ");

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
      `            r#"INSERT INTO ${tableQ} (${colsCsv}) "#,`,
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
    `        E: sqlx::Executor<'e, Database = ${backend.dbType}>,`,
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
function emitUpdateSetClauses(m: ModelIR, backend: Backend): string[] {
  const lines: string[] = [];
  for (const f of m.scalarFields) {
    const colQ = quoteIdent(backend, f.dbName);
    const colEq = JSON.stringify(`${colQ} = `);
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
      const incLit = JSON.stringify(`${colQ} = ${colQ} + `);
      const decLit = JSON.stringify(`${colQ} = ${colQ} - `);
      const mulLit = JSON.stringify(`${colQ} = ${colQ} * `);
      const divLit = JSON.stringify(`${colQ} = ${colQ} / `);
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
 * Top-level dispatcher: branches on `backend.writeStrategy`.
 * "returning" → classic v0.3.0 emission (Postgres + SQLite).
 * "requery"   → UPDATE followed by a find_unique fetch (MySQL).
 */
function emitUpdate(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  if (backend.writeStrategy === "returning") {
    return emitUpdateReturning(m, backend, moduleOf);
  }
  return emitUpdateRequery(m, backend, moduleOf);
}

/**
 * Emit `update` — locate one row by `WhereUniqueInput` and apply
 * `*UncheckedUpdateInput`. Composite-id models emit a `todo!()` body
 * (same v1 deferral as `find_unique`).
 */
function emitUpdateReturning(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const inputPath = `crate::${modulePath}::${m.name}UncheckedUpdateInput`;
  const whereUniquePath = `crate::${modulePath}::${m.name}WhereUniqueInput`;
  const cols = colsList(m, backend);
  const tableQ = quoteIdent(backend, m.dbName);

  const idField = singleIdField(m);

  const body: string[] = [];
  if (idField === null) {
    body.push(
      `        let _ = (executor, w, input);`,
      `        todo!("composite unique not yet supported")`,
    );
  } else {
    const idColEq = JSON.stringify(`${quoteIdent(backend, idField.dbName)} = `);
    const setClauses = emitUpdateSetClauses(m, backend);
    body.push(
      `        let mut qb = sqlx::QueryBuilder::new(`,
      `            r#"UPDATE ${tableQ} SET "#,`,
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
    `        E: sqlx::Executor<'e, Database = ${backend.dbType}>,`,
    `    {`,
    ...body,
    `    }`,
    `}`,
  ].join("\n");
}

/**
 * Emit `update` for backends without RETURNING. The shape is the v0.3.0
 * UPDATE without the trailing `RETURNING <cols>`, followed by a
 * find_unique fetch over the same WhereUniqueInput.
 *
 * Takes an `sqlx::Acquire` so the same connection backs both statements.
 */
function emitUpdateRequery(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const inputPath = `crate::${modulePath}::${m.name}UncheckedUpdateInput`;
  const whereUniquePath = `crate::${modulePath}::${m.name}WhereUniqueInput`;
  const tableQ = quoteIdent(backend, m.dbName);

  const idField = singleIdField(m);

  const sig = [
    `    pub async fn update<'e, A>(`,
    `        acq: A,`,
    `        w: &${whereUniquePath},`,
    `        input: ${inputPath},`,
    `    ) -> sqlx::Result<Self>`,
    `    where`,
    `        A: sqlx::Acquire<'e, Database = ${backend.dbType}>,`,
    `    {`,
  ];

  if (idField === null) {
    return [
      `impl ${modelPath} {`,
      ...sig,
      `        let _ = (acq, w, input);`,
      `        todo!("composite unique not yet supported")`,
      `    }`,
      `}`,
    ].join("\n");
  }

  const idColEq = JSON.stringify(`${quoteIdent(backend, idField.dbName)} = `);
  const setClauses = emitUpdateSetClauses(m, backend);

  const body: string[] = [
    `        let mut conn = acq.acquire().await?;`,
    `        let mut qb = sqlx::QueryBuilder::new(`,
    `            r#"UPDATE ${tableQ} SET "#,`,
    `        );`,
    `        let mut first = true;`,
    ...setClauses,
    `        if first {`,
    `            // Nothing to update — fall back to a plain find_unique so the`,
    `            // caller still gets the row back (or RowNotFound if absent).`,
    `            return Self::find_unique(&mut *conn, w).await?.ok_or(sqlx::Error::RowNotFound);`,
    `        }`,
    `        qb.push(" WHERE ");`,
    `        if let Some(value) = &w.${idField.rustName} {`,
    `            qb.push(${idColEq});`,
    `            qb.push_bind(${bindFromBorrow(idField, "value")});`,
    `        } else {`,
    `            return Err(sqlx::Error::RowNotFound);`,
    `        }`,
    `        qb.build().execute(&mut *conn).await?;`,
    `        Self::find_unique(&mut *conn, w).await?.ok_or(sqlx::Error::RowNotFound)`,
  ];

  return [`impl ${modelPath} {`, ...sig, ...body, `    }`, `}`].join("\n");
}

/**
 * Emit `update_many` — bulk update by `WhereInput`. Returns `u64`
 * rows_affected, no `RETURNING`. Skips when no SET clauses were produced
 * (avoids invalid `UPDATE t SET WHERE ...` SQL).
 */
function emitUpdateMany(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const inputPath = `crate::${modulePath}::${m.name}UncheckedUpdateManyInput`;
  const whereInputPath = `crate::${modulePath}::${m.name}WhereInput`;
  const modelSnake = toSnakeCase(m.name);
  const pushWhere = pushWhereCall(backend, modulePath, modelSnake);
  const tableQ = quoteIdent(backend, m.dbName);

  const setClauses = emitUpdateSetClauses(m, backend);

  return [
    `impl ${modelPath} {`,
    `    pub async fn update_many<'e, E>(`,
    `        executor: E,`,
    `        w: &${whereInputPath},`,
    `        input: ${inputPath},`,
    `    ) -> sqlx::Result<u64>`,
    `    where`,
    `        E: sqlx::Executor<'e, Database = ${backend.dbType}>,`,
    `    {`,
    `        let mut qb = sqlx::QueryBuilder::new(`,
    `            r#"UPDATE ${tableQ} SET "#,`,
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
 * Top-level dispatcher: branches on `backend.writeStrategy`.
 * "returning" → classic v0.3.0 emission (Postgres + SQLite).
 * "requery"   → find_unique BEFORE the DELETE so the row is captured.
 */
function emitDelete(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  if (backend.writeStrategy === "returning") {
    return emitDeleteReturning(m, backend, moduleOf);
  }
  return emitDeleteRequery(m, backend, moduleOf);
}

/**
 * Emit `delete` — locate one row by `WhereUniqueInput` and remove it,
 * returning the deleted row via `RETURNING`. Composite-id models emit a
 * `todo!()` body.
 */
function emitDeleteReturning(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const whereUniquePath = `crate::${modulePath}::${m.name}WhereUniqueInput`;
  const cols = colsList(m, backend);
  const tableQ = quoteIdent(backend, m.dbName);
  const idField = singleIdField(m);

  const body: string[] = [];
  if (idField === null) {
    body.push(
      `        let _ = (executor, w);`,
      `        todo!("composite unique not yet supported")`,
    );
  } else {
    const idColEq = JSON.stringify(`${quoteIdent(backend, idField.dbName)} = `);
    body.push(
      `        let mut qb = sqlx::QueryBuilder::new(`,
      `            r#"DELETE FROM ${tableQ} WHERE "#,`,
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
    `        E: sqlx::Executor<'e, Database = ${backend.dbType}>,`,
    `    {`,
    ...body,
    `    }`,
    `}`,
  ].join("\n");
}

/**
 * Emit `delete` for backends without RETURNING. Capture the row via
 * find_unique BEFORE issuing the DELETE so we still have a value to
 * return.
 */
function emitDeleteRequery(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const whereUniquePath = `crate::${modulePath}::${m.name}WhereUniqueInput`;
  const tableQ = quoteIdent(backend, m.dbName);
  const idField = singleIdField(m);

  const sig = [
    `    pub async fn delete<'e, A>(`,
    `        acq: A,`,
    `        w: &${whereUniquePath},`,
    `    ) -> sqlx::Result<Self>`,
    `    where`,
    `        A: sqlx::Acquire<'e, Database = ${backend.dbType}>,`,
    `    {`,
  ];

  if (idField === null) {
    return [
      `impl ${modelPath} {`,
      ...sig,
      `        let _ = (acq, w);`,
      `        todo!("composite unique not yet supported")`,
      `    }`,
      `}`,
    ].join("\n");
  }

  const idColEq = JSON.stringify(`${quoteIdent(backend, idField.dbName)} = `);

  const body: string[] = [
    `        let mut conn = acq.acquire().await?;`,
    `        let row = Self::find_unique(&mut *conn, w)`,
    `            .await?`,
    `            .ok_or(sqlx::Error::RowNotFound)?;`,
    `        let mut qb = sqlx::QueryBuilder::new(`,
    `            r#"DELETE FROM ${tableQ} WHERE "#,`,
    `        );`,
    `        if let Some(value) = &w.${idField.rustName} {`,
    `            qb.push(${idColEq});`,
    `            qb.push_bind(${bindFromBorrow(idField, "value")});`,
    `        } else {`,
    `            return Err(sqlx::Error::RowNotFound);`,
    `        }`,
    `        qb.build().execute(&mut *conn).await?;`,
    `        Ok(row)`,
  ];

  return [`impl ${modelPath} {`, ...sig, ...body, `    }`, `}`].join("\n");
}

/**
 * Emit `delete_many` — bulk DELETE by `WhereInput`. Returns `u64`
 * rows_affected. Empty WHERE inputs translate to `WHERE TRUE` (delete all),
 * matching Prisma's semantics.
 */
function emitDeleteMany(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const whereInputPath = `crate::${modulePath}::${m.name}WhereInput`;
  const modelSnake = toSnakeCase(m.name);
  const pushWhere = pushWhereCall(backend, modulePath, modelSnake);
  const tableQ = quoteIdent(backend, m.dbName);

  return [
    `impl ${modelPath} {`,
    `    pub async fn delete_many<'e, E>(`,
    `        executor: E,`,
    `        w: &${whereInputPath},`,
    `    ) -> sqlx::Result<u64>`,
    `    where`,
    `        E: sqlx::Executor<'e, Database = ${backend.dbType}>,`,
    `    {`,
    `        let mut qb = sqlx::QueryBuilder::new(`,
    `            r#"DELETE FROM ${tableQ} WHERE "#,`,
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
export function emitWrites(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  return [
    emitCreate(m, backend, moduleOf),
    emitCreateMany(m, backend, moduleOf),
    emitUpdate(m, backend, moduleOf),
    emitUpdateMany(m, backend, moduleOf),
    emitDelete(m, backend, moduleOf),
    emitDeleteMany(m, backend, moduleOf),
    "",
  ].join("\n\n");
}
