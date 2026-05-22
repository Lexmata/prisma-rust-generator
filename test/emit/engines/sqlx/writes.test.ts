import { describe, expect, it } from "vitest";
import {
  MYSQL,
  POSTGRES,
} from "../../../../src/emit/engines/sqlx/backends/index.js";
import { emitWrites } from "../../../../src/emit/engines/sqlx/writes.js";
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
  defaultKind: "uuid",
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
  defaultKind: null,
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
  defaultKind: null,
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
  defaultKind: null,
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

const out = emitWrites(user, POSTGRES);

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
    const compositeOut = emitWrites(composite, POSTGRES);
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

// ---------------------------------------------------------------------------
// MYSQL — requery path. Postgres + SQLite stay on the "returning" path
// (verified above and via the e2e fixtures). MYSQL is the first backend
// whose `writeStrategy === "requery"`, so the emitter takes the new path
// for create/update/delete.
// ---------------------------------------------------------------------------

// String @id @default(uuid()) — exercises the client-generated id branch.
function makeUserModelStringUuidId(): ModelIR {
  const stringUuidId: FieldIR = {
    prismaName: "id",
    rustName: "id",
    dbName: "id",
    type: { kind: "scalar", rust: "String", eq: true, copy: false },
    optional: false,
    list: false,
    isFk: false,
    isId: true,
    isUnique: true,
    hasDefault: true,
    defaultKind: "uuid",
    docs: [],
    serdeRenameOverride: null,
  };
  return {
    name: "User",
    module: "users",
    dbName: "User",
    scalarFields: [stringUuidId, emailField, loginCountField, bioField],
    relations: [],
    idFields: ["id"],
    uniqueGroups: [],
    docs: [],
  };
}

// Int @id @default(autoincrement()) — exercises the last-insert-id branch.
function makeUserModelAutoincrementId(): ModelIR {
  const autoIncId: FieldIR = {
    prismaName: "id",
    rustName: "id",
    dbName: "id",
    type: { kind: "scalar", rust: "i32", eq: true, copy: true },
    optional: false,
    list: false,
    isFk: false,
    isId: true,
    isUnique: true,
    hasDefault: true,
    defaultKind: "autoincrement",
    docs: [],
    serdeRenameOverride: null,
  };
  return {
    name: "User",
    module: "users",
    dbName: "User",
    scalarFields: [autoIncId, emailField, loginCountField, bioField],
    relations: [],
    idFields: ["id"],
    uniqueGroups: [],
    docs: [],
  };
}

describe("emitWrites — MYSQL requery path — create", () => {
  it("create() takes an sqlx::Acquire bound and acquires the connection", () => {
    const mysqlOut = emitWrites(makeUserModelStringUuidId(), MYSQL);
    expect(mysqlOut).toContain("pub async fn create<'e, A>(");
    expect(mysqlOut).toContain(
      "A: sqlx::Acquire<'e, Database = sqlx::MySql>,",
    );
    expect(mysqlOut).toContain("acq.acquire().await?");
  });

  it("create() follows the INSERT with a find_unique on the same conn", () => {
    const mysqlOut = emitWrites(makeUserModelStringUuidId(), MYSQL);
    expect(mysqlOut).toContain("Self::find_unique(");
    expect(mysqlOut).toContain("&mut *conn,");
    expect(mysqlOut).not.toContain("RETURNING");
  });

  it("create() mints a client-side uuid for String @id @default(uuid())", () => {
    const mysqlOut = emitWrites(makeUserModelStringUuidId(), MYSQL);
    expect(mysqlOut).toContain("uuid::Uuid::new_v4().to_string()");
    expect(mysqlOut).toContain("let id: String = _generated_id;");
    expect(mysqlOut).not.toContain("result.last_insert_id()");
  });

  it("create() uses LAST_INSERT_ID for autoincrement Int @id", () => {
    const mysqlOut = emitWrites(makeUserModelAutoincrementId(), MYSQL);
    expect(mysqlOut).toContain("let result = qb.build().execute(&mut *conn).await?;");
    expect(mysqlOut).toContain("result.last_insert_id() as i32");
    expect(mysqlOut).toContain("let id: i32 =");
    expect(mysqlOut).not.toContain("uuid::Uuid::new_v4()");
  });

  it("create() backtick-quotes the table name on MySQL", () => {
    const mysqlOut = emitWrites(makeUserModelStringUuidId(), MYSQL);
    expect(mysqlOut).toContain("INSERT INTO `User`");
  });

  it("create() builds a WhereUniqueInput with the inserted id", () => {
    const mysqlOut = emitWrites(makeUserModelStringUuidId(), MYSQL);
    expect(mysqlOut).toContain("&crate::users::UserWhereUniqueInput {");
    expect(mysqlOut).toContain("id: Some(id),");
    // The test model has only `id` as a unique field, so the
    // WhereUniqueInput is already fully specified — clippy's
    // `needless_update` would fire on `..Default::default()`. Elided.
    expect(mysqlOut).not.toContain("..Default::default()");
  });

  it("create() emits ..Default::default() when the WhereUniqueInput has >1 fields", () => {
    // Re-derive the User model and add a second @unique scalar (email).
    // With two distinct fields in the WhereUniqueInput, the struct-update
    // tail is needed and must reappear.
    const m = makeUserModelStringUuidId();
    const withEmailUnique: ModelIR = {
      ...m,
      uniqueGroups: [{ name: "email", fields: ["email"] }],
    };
    const mysqlOut = emitWrites(withEmailUnique, MYSQL);
    expect(mysqlOut).toContain("&crate::users::UserWhereUniqueInput {");
    expect(mysqlOut).toContain("id: Some(id),");
    expect(mysqlOut).toContain("..Default::default()");
  });
});

describe("emitWrites — MYSQL requery path — update", () => {
  it("update() takes an Acquire bound and follows the UPDATE with find_unique", () => {
    const mysqlOut = emitWrites(makeUserModelStringUuidId(), MYSQL);
    expect(mysqlOut).toMatch(/pub async fn update<'e, A>/);
    expect(mysqlOut).toContain(
      "A: sqlx::Acquire<'e, Database = sqlx::MySql>,",
    );
    expect(mysqlOut).toContain("UPDATE `User` SET");
    expect(mysqlOut).toContain(
      "Self::find_unique(&mut *conn, w).await?.ok_or(sqlx::Error::RowNotFound)",
    );
    expect(mysqlOut).not.toContain(" RETURNING ");
  });
});

describe("emitWrites — MYSQL requery path — delete", () => {
  it("delete() captures the row BEFORE issuing the DELETE", () => {
    const mysqlOut = emitWrites(makeUserModelStringUuidId(), MYSQL);
    const findUniqueIdx = mysqlOut.indexOf("Self::find_unique(&mut *conn, w)");
    const deleteIdx = mysqlOut.indexOf("DELETE FROM `User`");
    expect(findUniqueIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(findUniqueIdx).toBeLessThan(deleteIdx);
  });

  it("delete() takes Acquire and returns Ok(row)", () => {
    const mysqlOut = emitWrites(makeUserModelStringUuidId(), MYSQL);
    expect(mysqlOut).toMatch(/pub async fn delete<'e, A>/);
    expect(mysqlOut).toContain(
      "A: sqlx::Acquire<'e, Database = sqlx::MySql>,",
    );
    expect(mysqlOut).toContain("Ok(row)");
    expect(mysqlOut).not.toContain(" RETURNING ");
  });
});

describe("emitWrites — POSTGRES returning path (regression)", () => {
  it("POSTGRES still emits RETURNING and an Executor bound (unchanged)", () => {
    const pgOut = emitWrites(makeUserModelStringUuidId(), POSTGRES);
    expect(pgOut).toContain("RETURNING");
    expect(pgOut).toContain(
      "E: sqlx::Executor<'e, Database = sqlx::Postgres>,",
    );
    expect(pgOut).not.toContain("acq.acquire()");
    expect(pgOut).not.toContain("uuid::Uuid::new_v4()");
  });
});
