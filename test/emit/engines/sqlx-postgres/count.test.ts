import { describe, expect, it } from "vitest";
import { emitCount } from "../../../../src/emit/engines/sqlx-postgres/count.js";
import type { ModelIR } from "../../../../src/ir/types.js";

const user: ModelIR = {
  name: "User",
  module: "users",
  dbName: "User",
  scalarFields: [
    {
      prismaName: "id",
      rustName: "id",
      dbName: "id",
      type: { kind: "scalar", rust: "uuid::Uuid", eq: true, copy: true },
      optional: false,
      list: false,
      isFk: false,
      isId: true,
      isUnique: true,
      hasDefault: true,
      docs: [],
      serdeRenameOverride: null,
    },
    {
      prismaName: "email",
      rustName: "email",
      dbName: "email",
      type: { kind: "scalar", rust: "String", eq: true, copy: false },
      optional: false,
      list: false,
      isFk: false,
      isId: false,
      isUnique: true,
      hasDefault: false,
      docs: [],
      serdeRenameOverride: null,
    },
  ],
  relations: [],
  idFields: ["id"],
  uniqueGroups: [],
  docs: [],
};

describe("emitCount (sqlx-postgres)", () => {
  const out = emitCount(user);

  it("emits an inherent impl with the expected signature", () => {
    expect(out).toContain("impl crate::users::User {");
    expect(out).toContain("pub async fn count<'e, E>(");
    expect(out).toContain("executor: E,");
    expect(out).toContain("w: Option<&crate::users::UserWhereInput>,");
    expect(out).toContain("-> sqlx::Result<i64>");
    expect(out).toContain(
      "E: sqlx::Executor<'e, Database = sqlx::Postgres>,",
    );
  });

  it("issues COUNT(*) against the model's dbName table", () => {
    expect(out).toContain(`SELECT COUNT(*) FROM "User" WHERE`);
  });

  it("dispatches the predicate through push_<m>_where when w is Some", () => {
    expect(out).toContain("if let Some(w) = w {");
    expect(out).toContain(
      "if !crate::engine::sqlx_postgres::users::push_user_where(&mut qb, w) {",
    );
  });

  it("falls back to TRUE when w is None or empty", () => {
    expect(out).toContain(`qb.push("TRUE");`);
  });

  it("decodes the result as a 1-tuple of i64 and returns the count", () => {
    expect(out).toContain(
      "let row = qb.build_query_as::<(i64,)>().fetch_one(executor).await?;",
    );
    expect(out).toContain("Ok(row.0)");
  });

  it("uses the model's @@map dbName when present", () => {
    const remapped: ModelIR = {
      ...user,
      dbName: "users_table",
      module: "auth",
    };
    const remappedOut = emitCount(remapped);
    expect(remappedOut).toContain(`FROM "users_table" WHERE`);
    expect(remappedOut).toContain(
      "crate::engine::sqlx_postgres::auth::push_user_where",
    );
  });
});
