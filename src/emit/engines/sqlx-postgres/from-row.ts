import type { ModelIR } from "../../../ir/types.js";
import type { ModuleResolver } from "../../type-ref.js";

/**
 * Emit a `sqlx::FromRow` implementation for the given model targeting
 * `sqlx::postgres::PgRow`.
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
 */
export function emitFromRow(m: ModelIR, moduleOf?: ModuleResolver): string {
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const scalarLines = m.scalarFields.map(
    (f) => `            ${f.rustName}: row.try_get(${JSON.stringify(f.dbName)})?,`,
  );
  const relationLines = m.relations.map((r) => {
    const init = r.cardinality === "one" ? "None" : "Vec::new()";
    return `            ${r.rustName}: ${init},`;
  });

  const lines = [
    `impl sqlx::FromRow<'_, sqlx::postgres::PgRow> for crate::${modulePath}::${m.name} {`,
    `    fn from_row(row: &sqlx::postgres::PgRow) -> sqlx::Result<Self> {`,
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
