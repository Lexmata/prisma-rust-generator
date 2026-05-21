import type { EnumIR } from "../../../ir/types.js";
import type { ModuleResolver } from "../../type-ref.js";
import type { Backend } from "./backend.js";

/**
 * Emit the per-enum sqlx codecs for the supplied backend. Dispatches on
 * `backend.enumStorage`:
 *
 *   "native" — emit `Type` / `Decode` / `Encode` impls bound to the
 *              backend's database type, matching Prisma's native enum
 *              representation (Postgres `CREATE TYPE ... AS ENUM (...)`).
 *              This is the v0.2.0 behavior.
 *   "text"   — emit codecs that round-trip through a textual column
 *              (SQLite has no native enum support). Implementation
 *              deferred to Task 16 of the sqlx-sqlite engine plan.
 */
export function emitSqlxEnumImpls(
  e: EnumIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  if (backend.enumStorage === "native") {
    return emitNativeEnum(e, backend, moduleOf);
  }
  return emitTextEnum(e, backend, moduleOf);
}

/**
 * Native-enum codec — Postgres path. Prisma maps each enum to a real
 * PostgreSQL `CREATE TYPE ... AS ENUM (...)` declaration whose type name
 * matches the Prisma enum name (e.g. `"Role"`), and whose variants use the
 * Prisma variant names verbatim.
 *
 * The generated impls delegate to the Postgres TEXT codecs: `Decode` reads
 * a `&str` and matches it against each variant, `Encode` writes the
 * variant's Prisma name. This avoids requiring `sqlx`'s derive macro on
 * the original enum definition (which would couple the ORM-agnostic core
 * to the engine choice).
 *
 * The `Type<Database>` trait parameter is taken from `backend.dbType` so
 * a future native-enum backend (e.g. MySQL) can reuse this path; the
 * Postgres-specific value/buffer types remain hardcoded because v0.3.0
 * ships only `sqlx-postgres` on the `"native"` branch.
 */
function emitNativeEnum(
  e: EnumIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  const modulePath = moduleOf ? moduleOf(e.name) : e.module;
  const enumPath = `crate::${modulePath}::${e.name}`;
  const db = backend.dbType;
  const variantArms = e.variants.map(
    (v) =>
      `            ${JSON.stringify(v.prismaName)} => Ok(${enumPath}::${v.rustName}),`,
  );
  const encodeArms = e.variants.map(
    (v) =>
      `            ${enumPath}::${v.rustName} => ${JSON.stringify(v.prismaName)},`,
  );

  const lines = [
    `impl sqlx::Type<${db}> for ${enumPath} {`,
    `    fn type_info() -> sqlx::postgres::PgTypeInfo {`,
    `        sqlx::postgres::PgTypeInfo::with_name(${JSON.stringify(e.name)})`,
    `    }`,
    `    fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {`,
    `        *ty == Self::type_info() || <&str as sqlx::Type<${db}>>::compatible(ty)`,
    `    }`,
    `}`,
    ``,
    `impl<'r> sqlx::Decode<'r, ${db}> for ${enumPath} {`,
    `    fn decode(`,
    `        value: sqlx::postgres::PgValueRef<'r>,`,
    `    ) -> Result<Self, sqlx::error::BoxDynError> {`,
    `        let s = <&str as sqlx::Decode<${db}>>::decode(value)?;`,
    `        match s {`,
    ...variantArms,
    `            other => Err(format!("unknown ${e.name} variant: {other}").into()),`,
    `        }`,
    `    }`,
    `}`,
    ``,
    `impl<'q> sqlx::Encode<'q, ${db}> for ${enumPath} {`,
    `    fn encode_by_ref(`,
    `        &self,`,
    `        buf: &mut sqlx::postgres::PgArgumentBuffer,`,
    `    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {`,
    `        let s: &'static str = match self {`,
    ...encodeArms,
    `        };`,
    `        <&str as sqlx::Encode<${db}>>::encode(s, buf)`,
    `    }`,
    `}`,
    ``,
    `impl sqlx::postgres::PgHasArrayType for ${enumPath} {`,
    `    fn array_type_info() -> sqlx::postgres::PgTypeInfo {`,
    `        sqlx::postgres::PgTypeInfo::with_name(${JSON.stringify(`_${e.name}`)})`,
    `    }`,
    `}`,
    ``,
  ];

  return lines.join("\n");
}

/**
 * Text-storage codec — SQLite path. Prisma's SQLite provider has no native
 * enum type, so the generated column is plain TEXT and we serialise each
 * Rust enum variant as its Prisma variant name verbatim
 * (`Role::ADMIN` ↔ `"ADMIN"`).
 *
 * Unlike the native path, the codec lifts everything through sqlx's generic
 * `Database` trait — `<Database as ...>::TypeInfo`, `ValueRef<'r>`,
 * `ArgumentBuffer<'q>` — so the same emission could in principle be reused
 * for another text-storage backend (e.g. MySQL VARCHAR columns) without
 * touching this function. The concrete database type comes from
 * `backend.dbType`.
 *
 * Decode reads `&str` and matches against each variant; an unknown value
 * surfaces as a `sqlx::error::BoxDynError`. Encode writes the variant's
 * Prisma name through the existing `&str` Encode impl, which handles
 * lifetime-extending the borrowed string into sqlx's argument buffer.
 */
function emitTextEnum(
  e: EnumIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  const modulePath = moduleOf ? moduleOf(e.name) : e.module;
  const enumPath = `crate::${modulePath}::${e.name}`;
  const db = backend.dbType;

  const decodeArms = e.variants.map(
    (v) =>
      `            ${JSON.stringify(v.prismaName)} => Ok(${enumPath}::${v.rustName}),`,
  );
  const encodeArms = e.variants.map(
    (v) =>
      `            ${enumPath}::${v.rustName} => ${JSON.stringify(v.prismaName)},`,
  );

  const lines = [
    `impl sqlx::Type<${db}> for ${enumPath} {`,
    `    fn type_info() -> <${db} as sqlx::Database>::TypeInfo {`,
    `        <String as sqlx::Type<${db}>>::type_info()`,
    `    }`,
    `    fn compatible(ty: &<${db} as sqlx::Database>::TypeInfo) -> bool {`,
    `        <String as sqlx::Type<${db}>>::compatible(ty)`,
    `    }`,
    `}`,
    ``,
    `impl<'r> sqlx::Decode<'r, ${db}> for ${enumPath} {`,
    `    fn decode(`,
    `        value: <${db} as sqlx::Database>::ValueRef<'r>,`,
    `    ) -> Result<Self, sqlx::error::BoxDynError> {`,
    `        let s = <&str as sqlx::Decode<${db}>>::decode(value)?;`,
    `        match s {`,
    ...decodeArms,
    `            other => Err(format!("unknown ${e.name} variant: {other}").into()),`,
    `        }`,
    `    }`,
    `}`,
    ``,
    `impl<'q> sqlx::Encode<'q, ${db}> for ${enumPath} {`,
    `    fn encode_by_ref(`,
    `        &self,`,
    `        buf: &mut <${db} as sqlx::Database>::ArgumentBuffer<'q>,`,
    `    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {`,
    `        let s: &'static str = match self {`,
    ...encodeArms,
    `        };`,
    `        <&str as sqlx::Encode<'q, ${db}>>::encode(s, buf)`,
    `    }`,
    `}`,
    ``,
  ];

  return lines.join("\n");
}
