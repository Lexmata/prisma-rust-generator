import { describe, expect, it } from "vitest";
import { emitFinds } from "../../../../src/emit/engines/sqlx-postgres/finds.js";
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

describe("emitFinds (sqlx-postgres) — find_unique", () => {
  const out = emitFinds(user);

  it("emits an inherent impl with the expected signature", () => {
    expect(out).toContain("impl crate::users::User {");
    expect(out).toContain("pub async fn find_unique<'e, E>(");
    expect(out).toContain("executor: E,");
    expect(out).toContain("w: &crate::users::UserWhereUniqueInput,");
    expect(out).toContain("-> sqlx::Result<Option<Self>>");
    expect(out).toContain(
      "E: sqlx::Executor<'e, Database = sqlx::Postgres>,",
    );
  });

  it("selects every scalar column from the model table", () => {
    expect(out).toContain(`"id", "email"`);
    expect(out).toContain(`FROM "User" WHERE`);
  });

  it("binds the @id field by its rustName and dbName", () => {
    expect(out).toContain("if let Some(value) = &w.id {");
    expect(out).toContain(String.raw`qb.push("\"id\" = ");`);
    // uuid::Uuid is Copy, so we deref-bind instead of cloning
    // (clippy::clone_on_copy forbids .clone() on Copy types).
    expect(out).toContain("qb.push_bind(*value);");
  });

  it("returns None when no @id value was provided", () => {
    expect(out).toContain("return Ok(None);");
  });

  it("dispatches via fetch_optional", () => {
    expect(out).toContain(
      "qb.build_query_as::<Self>().fetch_optional(executor).await",
    );
  });

  it("emits a todo! body for composite @id models", () => {
    const compositeIdModel: ModelIR = {
      ...user,
      idFields: ["a", "b"],
    };
    const compositeOut = emitFinds(compositeIdModel);
    expect(compositeOut).toContain(
      `todo!("composite unique not yet supported")`,
    );
    // Don't generate the single-id WHERE-binding path for composite models.
    expect(compositeOut).not.toContain("if let Some(value) = &w.a {");
  });
});

describe("emitFinds (sqlx-postgres) — find_first", () => {
  const out = emitFinds(user);

  it("emits an inherent impl with the expected signature", () => {
    expect(out).toContain("pub async fn find_first<'e, E>(");
    expect(out).toContain("w: &crate::users::UserWhereInput,");
    expect(out).toContain("-> sqlx::Result<Option<Self>>");
  });

  it("dispatches the predicate through push_<m>_where", () => {
    expect(out).toContain(
      "if !crate::engine::sqlx_postgres::users::push_user_where(&mut qb, w) {",
    );
    expect(out).toContain(`qb.push("TRUE");`);
  });

  it("appends LIMIT 1 and fetches one row", () => {
    expect(out).toContain(`qb.push(" LIMIT 1");`);
    expect(out).toContain(
      "qb.build_query_as::<Self>().fetch_optional(executor).await",
    );
  });

  it("uses the dbName for the FROM clause", () => {
    expect(out).toContain(`FROM "User" WHERE`);
  });
});

describe("emitFinds (sqlx-postgres) — find_many builder", () => {
  const out = emitFinds(user);

  it("emits a builder struct over an executor type parameter", () => {
    expect(out).toContain("pub struct UserFindManyBuilder<'a, E> {");
    expect(out).toContain("executor: E,");
    expect(out).toContain("where_input: &'a crate::users::UserWhereInput,");
    expect(out).toContain(
      "order_by: Vec<crate::users::UserOrderByWithRelationInput>,",
    );
    expect(out).toContain("take: Option<i64>,");
    expect(out).toContain("skip: Option<i64>,");
  });

  it("emits chainable order_by / take / skip methods", () => {
    expect(out).toContain("pub fn order_by(");
    expect(out).toContain(
      "order_by: &[crate::users::UserOrderByWithRelationInput],",
    );
    expect(out).toContain("pub fn take(mut self, n: i64) -> Self {");
    expect(out).toContain("pub fn skip(mut self, n: i64) -> Self {");
  });

  it("emits exec returning Vec<Self>", () => {
    expect(out).toContain("pub async fn exec<'e>(self) -> sqlx::Result<Vec<crate::users::User>>");
    expect(out).toContain(
      "E: sqlx::Executor<'e, Database = sqlx::Postgres>,",
    );
    expect(out).toContain(
      "qb.build_query_as::<crate::users::User>().fetch_all(self.executor).await",
    );
  });

  it("walks ORDER BY scalar fields with sort_order_sql", () => {
    expect(out).toContain(`qb.push(" ORDER BY ");`);
    expect(out).toContain("if let Some(o) = ob.id {");
    expect(out).toContain("if let Some(o) = ob.email {");
    expect(out).toContain(
      "qb.push(crate::engine::sqlx_postgres::filters::sort_order_sql(o));",
    );
  });

  it("emits LIMIT and OFFSET via push_bind when take/skip are set", () => {
    expect(out).toContain("if let Some(n) = self.take {");
    expect(out).toContain(`qb.push(" LIMIT ");`);
    expect(out).toContain("if let Some(n) = self.skip {");
    expect(out).toContain(`qb.push(" OFFSET ");`);
    expect(out).toContain("qb.push_bind(n);");
  });

  it("emits an inherent find_many factory on the model that returns the builder", () => {
    expect(out).toContain("pub fn find_many<'a, E>(");
    expect(out).toContain("-> UserFindManyBuilder<'a, E> {");
    expect(out).toContain("UserFindManyBuilder {");
    expect(out).toContain("order_by: Vec::new(),");
    expect(out).toContain("take: None,");
    expect(out).toContain("skip: None,");
  });

  it("skips relation fields on OrderBy with a TODO marker", () => {
    const userWithRel: ModelIR = {
      ...user,
      relations: [
        {
          prismaName: "firm",
          rustName: "firm",
          fromModel: "User",
          toModel: "Firm",
          cardinality: "one",
          required: true,
          fkFieldNames: ["firmId"],
          backRelationName: null,
          docs: [],
        },
      ],
    };
    const relOut = emitFinds(userWithRel);
    expect(relOut).toContain("// TODO(prisma-rust-generator): sorting by relation `firm`");
    expect(relOut).toContain("let _ = &ob.firm;");
  });
});
