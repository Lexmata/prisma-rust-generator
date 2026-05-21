import { describe, expect, it } from "vitest";
import { POSTGRES, SQLITE } from "../../../../src/emit/engines/sqlx/backends/index.js";
import { emitSqlxEnumImpls } from "../../../../src/emit/engines/sqlx/enums.js";
import type { EnumIR } from "../../../../src/ir/types.js";

const roleEnum: EnumIR = {
  name: "Role",
  module: "auth",
  variants: [
    { prismaName: "ADMIN", rustName: "ADMIN", serdeRename: null, docs: [] },
    { prismaName: "USER", rustName: "USER", serdeRename: null, docs: [] },
  ],
  docs: [],
  eqEligible: true,
};

describe("emitSqlxEnumImpls — native (Postgres)", () => {
  it("emits PgTypeInfo + PgHasArrayType impls keyed on the Prisma enum name", () => {
    const out = emitSqlxEnumImpls(roleEnum, POSTGRES);
    expect(out).toContain("impl sqlx::Type<sqlx::Postgres> for crate::auth::Role");
    expect(out).toContain('sqlx::postgres::PgTypeInfo::with_name("Role")');
    expect(out).toContain("impl sqlx::postgres::PgHasArrayType");
    expect(out).toContain('sqlx::postgres::PgTypeInfo::with_name("_Role")');
  });
});

describe("emitSqlxEnumImpls — text-storage (SQLite)", () => {
  it("emits Type / Decode / Encode impls bound to the SQLite database type", () => {
    const out = emitSqlxEnumImpls(roleEnum, SQLITE);
    expect(out).toContain("impl sqlx::Type<sqlx::Sqlite> for crate::auth::Role");
    expect(out).toContain("impl<'r> sqlx::Decode<'r, sqlx::Sqlite>");
    expect(out).toContain("impl<'q> sqlx::Encode<'q, sqlx::Sqlite>");
  });

  it("round-trips through &str / String using the Prisma variant names", () => {
    const out = emitSqlxEnumImpls(roleEnum, SQLITE);
    // Decode: forwards to <&str as Decode<Sqlite>>.
    expect(out).toContain("<&str as sqlx::Decode<sqlx::Sqlite>>::decode");
    // Encode: forwards to <&str as Encode<Sqlite>>.
    expect(out).toContain("<&str as sqlx::Encode<'q, sqlx::Sqlite>>::encode");
    // Variant name strings appear verbatim on both sides.
    expect(out).toContain('"ADMIN" => Ok(crate::auth::Role::ADMIN)');
    expect(out).toContain('"USER" => Ok(crate::auth::Role::USER)');
    expect(out).toContain('crate::auth::Role::ADMIN => "ADMIN"');
    expect(out).toContain('crate::auth::Role::USER => "USER"');
  });

  it("lifts type_info / value-ref / argument-buffer through the generic Database trait", () => {
    const out = emitSqlxEnumImpls(roleEnum, SQLITE);
    expect(out).toContain("<sqlx::Sqlite as sqlx::Database>::TypeInfo");
    expect(out).toContain("<sqlx::Sqlite as sqlx::Database>::ValueRef<'r>");
    expect(out).toContain("<sqlx::Sqlite as sqlx::Database>::ArgumentBuffer<'q>");
  });

  it("does NOT use the native sqlx::Type derive macro for SQLite", () => {
    const out = emitSqlxEnumImpls(roleEnum, SQLITE);
    expect(out).not.toContain("#[sqlx(type_name");
    expect(out).not.toContain("#[derive(sqlx::Type)");
    // No PgHasArrayType leaking in either.
    expect(out).not.toContain("PgHasArrayType");
  });
});
