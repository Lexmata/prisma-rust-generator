import { describe, expect, it } from "vitest";
import { POSTGRES } from "../../../../src/emit/engines/sqlx/backends/index.js";
import { emitAggregate } from "../../../../src/emit/engines/sqlx/aggregate.js";
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
  hasDefault: true,
  docs: [],
  serdeRenameOverride: null,
};

const createdAtField: FieldIR = {
  prismaName: "createdAt",
  rustName: "created_at",
  dbName: "createdAt",
  type: {
    kind: "scalar",
    rust: "chrono::DateTime<chrono::Utc>",
    eq: true,
    copy: true,
  },
  optional: false,
  list: false,
  isFk: false,
  isId: false,
  isUnique: false,
  hasDefault: true,
  docs: [],
  serdeRenameOverride: null,
};

const user: ModelIR = {
  name: "User",
  module: "users",
  dbName: "User",
  scalarFields: [idField, emailField, loginCountField, createdAtField],
  relations: [],
  idFields: ["id"],
  uniqueGroups: [],
  docs: [],
};

const out = emitAggregate(user, POSTGRES);

describe("emitAggregate (sqlx-postgres) — result structs", () => {
  it("emits the bundle UserAggregateResult with five sub-aggregations", () => {
    expect(out).toContain("pub struct UserAggregateResult {");
    expect(out).toContain(`#[serde(rename = "_count")]`);
    expect(out).toContain(
      "pub aggregate_count: Option<UserCountAggregateResult>,",
    );
    expect(out).toContain(`#[serde(rename = "_avg")]`);
    expect(out).toContain("pub aggregate_avg: Option<UserAvgAggregateResult>,");
    expect(out).toContain(`#[serde(rename = "_sum")]`);
    expect(out).toContain("pub aggregate_sum: Option<UserSumAggregateResult>,");
    expect(out).toContain(`#[serde(rename = "_min")]`);
    expect(out).toContain("pub aggregate_min: Option<UserMinAggregateResult>,");
    expect(out).toContain(`#[serde(rename = "_max")]`);
    expect(out).toContain("pub aggregate_max: Option<UserMaxAggregateResult>,");
  });

  it("emits one Option<i64> per scalar plus _all on the Count result", () => {
    expect(out).toContain("pub struct UserCountAggregateResult {");
    const block = out
      .split("pub struct UserCountAggregateResult")[1]!
      .split("pub struct")[0]!;
    expect(block).toContain("pub id: Option<i64>,");
    expect(block).toContain("pub email: Option<i64>,");
    expect(block).toContain("pub login_count: Option<i64>,");
    expect(block).toContain("pub created_at: Option<i64>,");
    expect(block).toContain(`#[serde(rename = "_all")]`);
    expect(block).toContain("pub aggregate_all: Option<i64>,");
  });

  it("Avg result holds only numeric fields, typed as Option<f64>", () => {
    const block = out
      .split("pub struct UserAvgAggregateResult")[1]!
      .split("pub struct")[0]!;
    expect(block).toContain("pub login_count: Option<f64>,");
    expect(block).not.toContain("pub id:");
    expect(block).not.toContain("pub email:");
    expect(block).not.toContain("pub created_at:");
  });

  it("Sum result holds only numeric fields, typed as Option<f64>", () => {
    const block = out
      .split("pub struct UserSumAggregateResult")[1]!
      .split("pub struct")[0]!;
    expect(block).toContain("pub login_count: Option<f64>,");
    expect(block).not.toContain("pub id:");
    expect(block).not.toContain("pub email:");
    expect(block).not.toContain("pub created_at:");
  });

  it("Min result preserves source Rust types, wrapped in Option", () => {
    const block = out
      .split("pub struct UserMinAggregateResult")[1]!
      .split("pub struct")[0]!;
    expect(block).toContain("pub id: Option<uuid::Uuid>,");
    expect(block).toContain("pub email: Option<String>,");
    expect(block).toContain("pub login_count: Option<i32>,");
    expect(block).toContain(
      "pub created_at: Option<chrono::DateTime<chrono::Utc>>,",
    );
  });

  it("Max result mirrors Min", () => {
    const block = out
      .split("pub struct UserMaxAggregateResult")[1]!
      .split("pub struct")[0]!;
    expect(block).toContain("pub id: Option<uuid::Uuid>,");
    expect(block).toContain("pub email: Option<String>,");
    expect(block).toContain("pub login_count: Option<i32>,");
    expect(block).toContain(
      "pub created_at: Option<chrono::DateTime<chrono::Utc>>,",
    );
  });
});

describe("emitAggregate (sqlx-postgres) — method", () => {
  it("emits an inherent impl on the model with the right signature", () => {
    expect(out).toContain("impl crate::users::User {");
    expect(out).toContain("pub async fn aggregate<'e, E>(");
    expect(out).toContain("input: &crate::users::UserAggregateInput,");
    expect(out).toContain("-> sqlx::Result<UserAggregateResult>");
    expect(out).toContain(
      "E: sqlx::Executor<'e, Database = sqlx::Postgres>,",
    );
  });

  it("emits COUNT(*) plus per-column COUNT in the SELECT", () => {
    expect(out).toContain(`COUNT(*) AS count_all`);
    expect(out).toContain(`COUNT("id") AS count_id`);
    expect(out).toContain(`COUNT("email") AS count_email`);
    expect(out).toContain(`COUNT("loginCount") AS count_login_count`);
    expect(out).toContain(`COUNT("createdAt") AS count_created_at`);
  });

  it("emits AVG/SUM cast to double precision for numeric columns only", () => {
    expect(out).toContain(
      `AVG("loginCount")::double precision AS avg_login_count`,
    );
    expect(out).toContain(
      `SUM("loginCount")::double precision AS sum_login_count`,
    );
    expect(out).not.toContain(`AVG("id")`);
    expect(out).not.toContain(`AVG("email")`);
    expect(out).not.toContain(`AVG("createdAt")`);
    expect(out).not.toContain(`SUM("id")`);
  });

  it("emits MIN/MAX for orderable columns", () => {
    expect(out).toContain(`MIN("id") AS min_id`);
    expect(out).toContain(`MAX("id") AS max_id`);
    expect(out).toContain(`MIN("createdAt") AS min_created_at`);
    expect(out).toContain(`MAX("createdAt") AS max_created_at`);
  });

  it("dispatches the predicate through push_<m>_where when w is Some", () => {
    expect(out).toContain("if let Some(w) = &input.r#where {");
    expect(out).toContain(
      "if !crate::engine::sqlx_postgres::users::push_user_where(&mut qb, w) {",
    );
  });

  it("falls back to TRUE when input.where is None or empty", () => {
    expect(out).toContain(`qb.push("TRUE");`);
  });

  it("unpacks rows conditionally based on the requesting Option<bool> flags", () => {
    // Spot-check one count branch and one min branch.
    expect(out).toContain(
      `if req.id.unwrap_or(false) { row.try_get::<Option<i64>, _>("count_id")? } else { None }`,
    );
    expect(out).toContain(
      `if req.aggregate_all.unwrap_or(false) { row.try_get::<Option<i64>, _>("count_all")? } else { None }`,
    );
    expect(out).toContain(
      `if req.login_count.unwrap_or(false) { row.try_get::<Option<f64>, _>("avg_login_count")? } else { None }`,
    );
    expect(out).toContain(
      `if req.created_at.unwrap_or(false) { row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("min_created_at")? } else { None }`,
    );
  });

  it("uses sqlx::Row in scope so try_get resolves", () => {
    expect(out).toContain("use sqlx::Row;");
  });

  it("uses the model's @@map dbName when present", () => {
    const remapped: ModelIR = {
      ...user,
      dbName: "users_table",
      module: "auth",
    };
    const remappedOut = emitAggregate(remapped, POSTGRES);
    expect(remappedOut).toContain(`FROM "users_table" WHERE`);
    expect(remappedOut).toContain(
      "crate::engine::sqlx_postgres::auth::push_user_where",
    );
  });
});
