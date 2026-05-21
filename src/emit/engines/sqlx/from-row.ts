import type { ModelIR } from "../../../ir/types.js";
import type { ModuleResolver } from "../../type-ref.js";
import type { Backend } from "./backend.js";

/**
 * Emit a `sqlx::FromRow` implementation for the given model targeting
 * the backend's row type (`backend.rowType` — e.g. `sqlx::postgres::PgRow`
 * for Postgres, `sqlx::sqlite::SqliteRow` for SQLite).
 *
 * Scalar fields read their value via `row.try_get("<dbName>")?`. Relation
 * fields are zero-initialized: to-one relations become `None`, to-many
 * relations become `Vec::new()`. Consumers that need populated relations
 * issue a follow-up query against the target table.
 *
 * `moduleOf` resolves the model's home module — supplied by the layout so
 * the engine emitter doesn't need to know whether models live under
 * `crate::<file>` (per-file) or `crate::models::<m>` (per-model). When
 * omitted, the resolver defaults to `m.module` (preserves per-file
 * behaviour for unit tests that build IRs by hand).
 *
 * The `row.try_get("...")` argument is a sqlx column-name lookup and is
 * always double-quoted regardless of dialect; it is not an SQL identifier
 * and does not go through the backend's quote helper.
 */
export function emitFromRow(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const scalarLines = m.scalarFields.map(
    (f) => `            ${f.rustName}: row.try_get(${JSON.stringify(f.dbName)})?,`,
  );
  const relationLines = m.relations.map((r) => {
    const init = r.cardinality === "one" ? "None" : "Vec::new()";
    return `            ${r.rustName}: ${init},`;
  });

  const lines = [
    `impl sqlx::FromRow<'_, ${backend.rowType}> for crate::${modulePath}::${m.name} {`,
    `    fn from_row(row: &${backend.rowType}) -> sqlx::Result<Self> {`,
    `        Ok(crate::${modulePath}::${m.name} {`,
    ...scalarLines,
    ...relationLines,
    `        })`,
    `    }`,
    `}`,
    "",
  ];

  return lines.join("\n");
}
