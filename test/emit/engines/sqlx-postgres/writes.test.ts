import { describe, expect, it } from "vitest";
import { emitWrites } from "../../../../src/emit/engines/sqlx-postgres/writes.js";
import type { FieldIR, ModelIR } from "../../../../src/ir/types.js";

const idField: FieldIR = {
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
};

const emailField: FieldIR = {
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
};

const loginCountField: FieldIR = {
  prismaName: "loginCount",
  rustName: "login_count",
  dbName: "loginCount",
  type: { kind: "scalar", rust: "i32", eq: true, copy: true },
  optional: false,
  list: false,
  isFk: false,
  isId: false,
  isUnique: false,
  hasDefault: false,
  docs: [],
  serdeRenameOverride: null,
};

const bioField: FieldIR = {
  prismaName: "bio",
  rustName: "bio",
  dbName: "bio",
  type: { kind: "scalar", rust: "String", eq: true, copy: false },
  optional: true,
  list: false,
  isFk: false,
  isId: false,
  isUnique: false,
  hasDefault: false,
  docs: [],
  serdeRenameOverride: null,
};

const user: ModelIR = {
  name: "User",
  module: "users",
  dbName: "User",
  scalarFields: [idField, emailField, loginCountField, bioField],
  relations: [],
  idFields: ["id"],
  uniqueGroups: [],
  docs: [],
};

const out = emitWrites(user);

describe("emitWrites (sqlx-postgres) — create", () => {
  it("emits an inherent impl with the expected signature", () => {
    expect(out).toContain("impl crate::users::User {");
    expect(out).toContain("pub async fn create<'e, E>(");
    expect(out).toContain("input: crate::users::UserUncheckedCreateInput,");
    expect(out).toContain("-> sqlx::Result<Self>");
    expect(out).toContain(
      "E: sqlx::Executor<'e, Database = sqlx::Postgres>,",
    );
  });

  it("INSERTs into the model's dbName table", () => {
    expect(out).toContain(`INSERT INTO "User"`);
  });

  it("RETURNS every scalar column", () => {
    expect(out).toContain(
      `qb.push(r#") RETURNING "id", "email", "loginCount", "bio""#);`,
    );
  });

  it("unconditionally pushes required columns and binds their values", () => {
    expect(out).toContain(String.raw`cols.push_str("\"email\"");`);
    expect(out).toContain(`qb.push_bind(input.email);`);
    expect(out).toContain(String.raw`cols.push_str("\"loginCount\"");`);
    expect(out).toContain(`qb.push_bind(input.login_count);`);
  });

  it("conditionally pushes optional columns only when Some()", () => {
    expect(out).toContain("if input.bio.is_some() {");
    expect(out).toContain(String.raw`cols.push_str("\"bio\"");`);
    expect(out).toContain("if let Some(v) = input.bio {");
    expect(out).toContain("qb.push_bind(v);");
  });

  it("dispatches via fetch_one", () => {
    expect(out).toContain(
      "qb.build_query_as::<Self>().fetch_one(executor).await",
    );
  });
});

describe("emitWrites (sqlx-postgres) — create_many", () => {
  it("emits an inherent impl returning u64 rows_affected", () => {
    expect(out).toContain("pub async fn create_many<'e, E>(");
    expect(out).toContain(
      "inputs: &[crate::users::UserUncheckedCreateInput],",
    );
    expect(out).toContain("-> sqlx::Result<u64>");
  });

  it("short-circuits on empty input slices", () => {
    expect(out).toContain("if inputs.is_empty() { return Ok(0); }");
  });

  it("uses push_values to bulk-bind every addressable column", () => {
    expect(out).toContain(`INSERT INTO "User" ("email", "loginCount", "bio")`);
    expect(out).toContain("qb.push_values(inputs, |mut row, input|");
    // email is String (non-Copy) so cloned; login_count is i32 (Copy) so
    // accessed directly; bio is Option<String> (non-Copy) so cloned.
    expect(out).toContain("row.push_bind(input.email.clone());");
    expect(out).toContain("row.push_bind(input.login_count);");
    expect(out).toContain("row.push_bind(input.bio.clone());");
  });

  it("returns rows_affected without a RETURNING clause", () => {
    expect(out).toContain("Ok(result.rows_affected())");
  });
});

describe("emitWrites (sqlx-postgres) — update", () => {
  it("emits an inherent impl over WhereUniqueInput + UncheckedUpdateInput", () => {
    expect(out).toContain("pub async fn update<'e, E>(");
    expect(out).toContain("w: &crate::users::UserWhereUniqueInput,");
    expect(out).toContain("input: crate::users::UserUncheckedUpdateInput,");
    expect(out).toContain("-> sqlx::Result<Self>");
  });

  it("emits a set branch for every scalar field", () => {
    expect(out).toContain("if let Some(op) = input.id {");
    expect(out).toContain("if let Some(op) = input.email {");
    expect(out).toContain("if let Some(op) = input.login_count {");
    expect(out).toContain("if let Some(op) = input.bio {");
    expect(out).toContain("if let Some(v) = op.set {");
  });

  it("emits increment/decrement/multiply/divide for numeric fields only", () => {
    // login_count is i32 → numeric ops present
    expect(out).toContain("if let Some(v) = op.increment {");
    expect(out).toContain("if let Some(v) = op.decrement {");
    expect(out).toContain("if let Some(v) = op.multiply {");
    expect(out).toContain("if let Some(v) = op.divide {");
    expect(out).toContain(
      String.raw`qb.push("\"loginCount\" = \"loginCount\" + ");`,
    );
    expect(out).toContain(
      String.raw`qb.push("\"loginCount\" = \"loginCount\" - ");`,
    );
    expect(out).toContain(
      String.raw`qb.push("\"loginCount\" = \"loginCount\" * ");`,
    );
    expect(out).toContain(
      String.raw`qb.push("\"loginCount\" = \"loginCount\" / ");`,
    );
  });

  it("does NOT emit numeric ops for non-numeric fields", () => {
    // Email is a String — its op-input only has `set`. The emitter walks
    // each field's branch in order; for the four scalars on User, only
    // login_count carries numeric ops. update + update_many both walk the
    // SET clauses, so the total count of `op.increment` references is
    // exactly 2 — one per top-level op function, never more.
    const incrementMatches = out.match(/op\.increment/g) ?? [];
    expect(incrementMatches).toHaveLength(2);
  });

  it("returns the updated row via RETURNING", () => {
    expect(out).toContain(
      `qb.push(r#" RETURNING "id", "email", "loginCount", "bio""#);`,
    );
    expect(out).toContain(
      "qb.build_query_as::<Self>().fetch_one(executor).await",
    );
  });

  it("falls back to find_unique when no SET clauses were produced", () => {
    expect(out).toContain(
      "return Self::find_unique(executor, w).await?.ok_or(sqlx::Error::RowNotFound);",
    );
  });

  it("binds the @id field via WhereUniqueInput", () => {
    expect(out).toContain("if let Some(value) = &w.id {");
    expect(out).toContain(String.raw`qb.push("\"id\" = ");`);
    // uuid::Uuid is Copy → deref-bind, not clone (clippy::clone_on_copy).
    expect(out).toContain("qb.push_bind(*value);");
  });

  it("emits a todo!() body for composite-id models", () => {
    const composite: ModelIR = { ...user, idFields: ["a", "b"] };
    const compositeOut = emitWrites(composite);
    expect(compositeOut).toContain(
      `todo!("composite unique not yet supported")`,
    );
  });
});

describe("emitWrites (sqlx-postgres) — update_many", () => {
  it("emits an inherent impl over WhereInput + UncheckedUpdateManyInput", () => {
    expect(out).toContain("pub async fn update_many<'e, E>(");
    expect(out).toContain("w: &crate::users::UserWhereInput,");
    expect(out).toContain(
      "input: crate::users::UserUncheckedUpdateManyInput,",
    );
    expect(out).toContain("-> sqlx::Result<u64>");
  });

  it("dispatches WHERE via push_<m>_where", () => {
    expect(out).toContain(
      "if !crate::engine::sqlx_postgres::users::push_user_where(&mut qb, w) {",
    );
  });

  it("returns rows_affected without RETURNING", () => {
    // Two update arms exist (update + update_many). Both end with the
    // SET clauses and only update has a RETURNING clause — confirm
    // update_many ends with a build().execute() instead.
    expect(out).toContain("Ok(result.rows_affected())");
  });

  it("short-circuits to Ok(0) when no SET clauses were produced", () => {
    expect(out).toContain("return Ok(0);");
  });
});

describe("emitWrites (sqlx-postgres) — delete", () => {
  it("emits an inherent impl returning the deleted row", () => {
    expect(out).toContain("pub async fn delete<'e, E>(");
    expect(out).toContain("w: &crate::users::UserWhereUniqueInput,");
    expect(out).toContain("-> sqlx::Result<Self>");
  });

  it("issues DELETE ... RETURNING", () => {
    expect(out).toContain(`DELETE FROM "User" WHERE`);
    expect(out).toContain(
      `qb.push(r#" RETURNING "id", "email", "loginCount", "bio""#);`,
    );
  });

  it("binds the @id field and errors when absent", () => {
    expect(out).toContain("if let Some(value) = &w.id {");
    expect(out).toContain("return Err(sqlx::Error::RowNotFound);");
  });
});

describe("emitWrites (sqlx-postgres) — delete_many", () => {
  it("emits an inherent impl returning u64", () => {
    expect(out).toContain("pub async fn delete_many<'e, E>(");
    expect(out).toContain("w: &crate::users::UserWhereInput,");
    expect(out).toContain("-> sqlx::Result<u64>");
  });

  it("dispatches WHERE via push_<m>_where with TRUE fallback", () => {
    expect(out).toContain(
      "if !crate::engine::sqlx_postgres::users::push_user_where(&mut qb, w) {",
    );
    expect(out).toContain(`qb.push("TRUE");`);
  });
});
