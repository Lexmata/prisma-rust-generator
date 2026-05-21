import type { EnumIR } from "../../../ir/types.js";
import type { ModuleResolver } from "../../type-ref.js";

/**
 * Emit a `sqlx::Type<Postgres>` implementation for a Prisma enum so it can be
 * read out of `PgRow::try_get` and bound back into queries. Prisma maps each
 * enum to a real PostgreSQL `CREATE TYPE ... AS ENUM (...)` declaration whose
 * type name matches the Prisma enum name (e.g. `"Role"`), and whose variants
 * use the Prisma variant names verbatim.
 *
 * The generated impls delegate to the Postgres TEXT codecs: `Decode` reads a
 * `&str` and matches it against each variant, `Encode` writes the variant's
 * Prisma name. This avoids requiring `sqlx`'s derive macro on the original
 * enum definition (which would couple the ORM-agnostic core to the engine
 * choice).
 */
export function emitSqlxEnumImpls(e: EnumIR, moduleOf?: ModuleResolver): string {
  const modulePath = moduleOf ? moduleOf(e.name) : e.module;
  const enumPath = `crate::${modulePath}::${e.name}`;
  const variantArms = e.variants.map(
    (v) =>
      `            ${JSON.stringify(v.prismaName)} => Ok(${enumPath}::${v.rustName}),`,
  );
  const encodeArms = e.variants.map(
    (v) =>
      `            ${enumPath}::${v.rustName} => ${JSON.stringify(v.prismaName)},`,
  );

  const lines = [
    `impl sqlx::Type<sqlx::Postgres> for ${enumPath} {`,
    `    fn type_info() -> sqlx::postgres::PgTypeInfo {`,
    `        sqlx::postgres::PgTypeInfo::with_name(${JSON.stringify(e.name)})`,
    `    }`,
    `    fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {`,
    `        *ty == Self::type_info() || <&str as sqlx::Type<sqlx::Postgres>>::compatible(ty)`,
    `    }`,
    `}`,
    ``,
    `impl<'r> sqlx::Decode<'r, sqlx::Postgres> for ${enumPath} {`,
    `    fn decode(`,
    `        value: sqlx::postgres::PgValueRef<'r>,`,
    `    ) -> Result<Self, sqlx::error::BoxDynError> {`,
    `        let s = <&str as sqlx::Decode<sqlx::Postgres>>::decode(value)?;`,
    `        match s {`,
    ...variantArms,
    `            other => Err(format!("unknown ${e.name} variant: {other}").into()),`,
    `        }`,
    `    }`,
    `}`,
    ``,
    `impl<'q> sqlx::Encode<'q, sqlx::Postgres> for ${enumPath} {`,
    `    fn encode_by_ref(`,
    `        &self,`,
    `        buf: &mut sqlx::postgres::PgArgumentBuffer,`,
    `    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {`,
    `        let s: &'static str = match self {`,
    ...encodeArms,
    `        };`,
    `        <&str as sqlx::Encode<sqlx::Postgres>>::encode(s, buf)`,
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
