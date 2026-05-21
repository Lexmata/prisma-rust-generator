import type { FieldIR, ModelIR, RelationIR } from "../../../ir/types.js";
import { toSnakeCase } from "../../../ir/names.js";
import type { ModuleResolver } from "../../type-ref.js";

/**
 * Resolve the snake_case filter-family key for a scalar or enum field. This
 * key is used to pick the right `push_<family>_filter` (or
 * `push_<family>_nullable_filter`) function emitted by `filter-pushers.ts`.
 *
 * Relation fields are out of scope here — they get their own translator in a
 * follow-up task.
 */
function filterFamilyForField(f: FieldIR): string {
  if (f.type.kind === "scalar") {
    const r = f.type.rust;
    if (r === "String") return "string";
    if (r === "uuid::Uuid") return "uuid";
    if (r === "i32" || r === "i16" || r === "u32") return "int";
    if (r === "i64") return "bigint";
    if (r === "f32" || r === "f64") return "float";
    if (r.startsWith("rust_decimal") || r.startsWith("bigdecimal")) return "decimal";
    if (r === "bool") return "bool";
    if (r.startsWith("chrono::") || r.startsWith("time::")) return "datetime";
    if (r === "serde_json::Value") return "json";
    if (r === "Vec<u8>" || r === "bytes::Bytes") return "bytes";
    throw new Error(`unknown scalar Rust type: ${r}`);
  }
  if (f.type.kind === "enumRef") {
    return toSnakeCase(f.type.enumName);
  }
  throw new Error("relation fields don't go through scalar pushers");
}

/**
 * Look up the dbName of a scalar field by its Prisma name.
 */
function dbNameOfScalar(m: ModelIR, prismaName: string): string | null {
  const f = m.scalarFields.find((sf) => sf.prismaName === prismaName);
  return f ? f.dbName : null;
}

/**
 * Find the inverse relation on `target` that points back at `source` and
 * holds the FK. For a to-many relation on the source, this is the to-one
 * relation on the target whose `toModel` is the source. There may be more
 * than one such relation (e.g. CaseTask has both `creator` and `assignee`
 * pointing at User); the caller passes `fromRel` so we can disambiguate
 * using `backRelationName` when populated, falling back to the
 * unambiguous-single-candidate case.
 *
 * Returns null when no clear match exists — the emitter then skips the
 * relation with a TODO marker rather than producing an incorrect SQL join.
 */
function findBackRelation(
  source: ModelIR,
  fromRel: RelationIR,
  target: ModelIR,
): RelationIR | null {
  const candidates = target.relations.filter(
    (tr) =>
      tr.toModel === source.name &&
      tr.cardinality === "one" &&
      tr.fkFieldNames.length > 0,
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;
  // Multiple candidates: try to disambiguate by name. If backRelationName is
  // populated, use it. Otherwise we cannot tell which inverse pairs with
  // `fromRel`.
  if (fromRel.backRelationName) {
    return (
      candidates.find((c) => c.prismaName === fromRel.backRelationName) ?? null
    );
  }
  return null;
}

/**
 * Emit the EXISTS / NOT EXISTS subquery block for a single to-one relation
 * field on the source model.
 */
function emitToOneRelationBlock(
  source: ModelIR,
  rel: RelationIR,
  target: ModelIR,
  moduleOf?: ModuleResolver,
): string[] {
  // Multi-FK relations (composite foreign keys) are rare and out of scope
  // for v1: emit a no-op block with a TODO marker so the generated Rust
  // still compiles but reviewers can grep for it.
  if (rel.fkFieldNames.length !== 1) {
    return [
      `    // TODO(prisma-rust-generator): multi-FK to-one relation \`${rel.prismaName}\` on \`${source.name}\` skipped`,
      `    // (composite FK relation filters not yet supported by sqlx-postgres engine).`,
      `    let _ = &w.${rel.rustName};`,
    ];
  }
  const fkCol = dbNameOfScalar(source, rel.fkFieldNames[0]!);
  const targetIdField = target.idFields[0];
  const targetIdCol = targetIdField
    ? dbNameOfScalar(target, targetIdField)
    : null;
  if (!fkCol || !targetIdCol) {
    return [
      `    // TODO(prisma-rust-generator): could not resolve FK/PK columns for to-one relation \`${rel.prismaName}\` on \`${source.name}\`.`,
      `    let _ = &w.${rel.rustName};`,
    ];
  }
  const targetSnake = toSnakeCase(target.name);
  const targetModule = moduleOf ? moduleOf(target.name) : target.module;
  const targetPush = `crate::engine::sqlx_postgres::${targetModule}::push_${targetSnake}_where`;
  const isHead =
    `EXISTS (SELECT 1 FROM "${target.dbName}" t WHERE t."${targetIdCol}" = "${source.dbName}"."${fkCol}" AND (`;
  const isNotHead =
    `NOT EXISTS (SELECT 1 FROM "${target.dbName}" t WHERE t."${targetIdCol}" = "${source.dbName}"."${fkCol}" AND (`;
  return [
    `    if let Some(rel) = &w.${rel.rustName} {`,
    `        if let Some(sub) = &rel.is {`,
    `            if any { qb.push(" AND "); }`,
    `            any = true;`,
    `            qb.push(${JSON.stringify(isHead)});`,
    `            if !${targetPush}(qb, sub) { qb.push("TRUE"); }`,
    `            qb.push("))");`,
    `        }`,
    `        if let Some(sub) = &rel.is_not {`,
    `            if any { qb.push(" AND "); }`,
    `            any = true;`,
    `            qb.push(${JSON.stringify(isNotHead)});`,
    `            if !${targetPush}(qb, sub) { qb.push("TRUE"); }`,
    `            qb.push("))");`,
    `        }`,
    `    }`,
  ];
}

/**
 * Emit the EXISTS / NOT EXISTS subquery block for a single to-many relation
 * field on the source model.
 */
function emitToManyRelationBlock(
  source: ModelIR,
  rel: RelationIR,
  target: ModelIR,
  moduleOf?: ModuleResolver,
): string[] {
  const sourceIdField = source.idFields[0];
  const sourceIdCol = sourceIdField
    ? dbNameOfScalar(source, sourceIdField)
    : null;
  const back = findBackRelation(source, rel, target);
  if (!back) {
    return [
      `    // TODO(prisma-rust-generator): could not resolve back-relation for to-many \`${rel.prismaName}\` on \`${source.name}\` -> \`${target.name}\`.`,
      `    let _ = &w.${rel.rustName};`,
    ];
  }
  if (back.fkFieldNames.length !== 1) {
    return [
      `    // TODO(prisma-rust-generator): multi-FK back-relation for to-many \`${rel.prismaName}\` on \`${source.name}\` skipped.`,
      `    let _ = &w.${rel.rustName};`,
    ];
  }
  const targetFkCol = dbNameOfScalar(target, back.fkFieldNames[0]!);
  if (!sourceIdCol || !targetFkCol) {
    return [
      `    // TODO(prisma-rust-generator): could not resolve PK/FK columns for to-many \`${rel.prismaName}\` on \`${source.name}\`.`,
      `    let _ = &w.${rel.rustName};`,
    ];
  }
  const targetSnake = toSnakeCase(target.name);
  const targetModule = moduleOf ? moduleOf(target.name) : target.module;
  const targetPush = `crate::engine::sqlx_postgres::${targetModule}::push_${targetSnake}_where`;
  const everyHead =
    `NOT EXISTS (SELECT 1 FROM "${target.dbName}" t WHERE t."${targetFkCol}" = "${source.dbName}"."${sourceIdCol}" AND NOT (`;
  const someHead =
    `EXISTS (SELECT 1 FROM "${target.dbName}" t WHERE t."${targetFkCol}" = "${source.dbName}"."${sourceIdCol}" AND (`;
  const noneHead =
    `NOT EXISTS (SELECT 1 FROM "${target.dbName}" t WHERE t."${targetFkCol}" = "${source.dbName}"."${sourceIdCol}" AND (`;
  return [
    `    if let Some(rel) = &w.${rel.rustName} {`,
    `        if let Some(sub) = &rel.every {`,
    `            if any { qb.push(" AND "); }`,
    `            any = true;`,
    `            qb.push(${JSON.stringify(everyHead)});`,
    `            if !${targetPush}(qb, sub) { qb.push("TRUE"); }`,
    `            qb.push("))");`,
    `        }`,
    `        if let Some(sub) = &rel.some {`,
    `            if any { qb.push(" AND "); }`,
    `            any = true;`,
    `            qb.push(${JSON.stringify(someHead)});`,
    `            if !${targetPush}(qb, sub) { qb.push("TRUE"); }`,
    `            qb.push("))");`,
    `        }`,
    `        if let Some(sub) = &rel.none {`,
    `            if any { qb.push(" AND "); }`,
    `            any = true;`,
    `            qb.push(${JSON.stringify(noneHead)});`,
    `            if !${targetPush}(qb, sub) { qb.push("TRUE"); }`,
    `            qb.push("))");`,
    `        }`,
    `    }`,
  ];
}

/**
 * Emit `push_<m>_where`, the top-level translator that walks a
 * `*WhereInput` struct and pushes a parenthesized SQL predicate group via
 * `sqlx::QueryBuilder`. One scalar/enum branch per field, plus EXISTS
 * subqueries for each relation field, plus recursive dispatch for
 * `and` / `or` / `not` arrays.
 *
 * Returns a `bool`: `true` if at least one predicate was pushed, `false` if
 * the input was effectively empty. Callers can use this to splice `TRUE` in
 * for empty groups so the outer `AND` chain stays valid.
 */
export function emitWhereTranslator(
  m: ModelIR,
  allModels: ReadonlyMap<string, ModelIR>,
  moduleOf?: ModuleResolver,
): string {
  const fnName = `push_${toSnakeCase(m.name)}_where`;
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const whereType = `crate::${modulePath}::${m.name}WhereInput`;

  const fieldBlocks: string[] = [];
  for (const f of m.scalarFields) {
    const family = filterFamilyForField(f);
    const pusher = f.optional
      ? `push_${family}_nullable_filter`
      : `push_${family}_filter`;
    fieldBlocks.push(
      `    if let Some(f) = &w.${f.rustName} {`,
      `        if any { qb.push(" AND "); }`,
      `        any = true;`,
      `        crate::engine::sqlx_postgres::filters::${pusher}(qb, ${JSON.stringify(f.dbName)}, f);`,
      `    }`,
    );
  }

  const relationBlocks: string[] = [];
  for (const r of m.relations) {
    const target = allModels.get(r.toModel);
    if (!target) {
      relationBlocks.push(
        `    // TODO(prisma-rust-generator): target model \`${r.toModel}\` for relation \`${r.prismaName}\` on \`${m.name}\` not found in IR.`,
        `    let _ = &w.${r.rustName};`,
      );
      continue;
    }
    if (r.cardinality === "one") {
      relationBlocks.push(...emitToOneRelationBlock(m, r, target, moduleOf));
    } else {
      relationBlocks.push(...emitToManyRelationBlock(m, r, target, moduleOf));
    }
  }

  const andBlock = [
    `    if let Some(group) = &w.and {`,
    `        for sub in group {`,
    `            if any { qb.push(" AND "); }`,
    `            any = true;`,
    `            qb.push("(");`,
    `            if !${fnName}(qb, sub) { qb.push("TRUE"); }`,
    `            qb.push(")");`,
    `        }`,
    `    }`,
  ];

  const orBlock = [
    `    if let Some(group) = &w.or {`,
    `        if any { qb.push(" AND "); }`,
    `        any = true;`,
    `        qb.push("(");`,
    `        let mut first = true;`,
    `        for sub in group {`,
    `            if !first { qb.push(" OR "); }`,
    `            first = false;`,
    `            qb.push("(");`,
    `            if !${fnName}(qb, sub) { qb.push("TRUE"); }`,
    `            qb.push(")");`,
    `        }`,
    `        qb.push(")");`,
    `    }`,
  ];

  const notBlock = [
    `    if let Some(group) = &w.not {`,
    `        for sub in group {`,
    `            if any { qb.push(" AND "); }`,
    `            any = true;`,
    `            qb.push("NOT (");`,
    `            if !${fnName}(qb, sub) { qb.push("TRUE"); }`,
    `            qb.push(")");`,
    `        }`,
    `    }`,
  ];

  const lines = [
    `pub(crate) fn ${fnName}(`,
    `    qb: &mut sqlx::QueryBuilder<'_, sqlx::Postgres>,`,
    `    w: &${whereType},`,
    `) -> bool {`,
    `    let mut any = false;`,
    ...fieldBlocks,
    ...relationBlocks,
    ...andBlock,
    ...orBlock,
    ...notBlock,
    `    any`,
    `}`,
  ];

  return lines.join("\n");
}
