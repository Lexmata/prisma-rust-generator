import { describe, expect, it } from "vitest";
import { POSTGRES } from "../../../../src/emit/engines/sqlx/backends/index.js";
import { emitWhereTranslator } from "../../../../src/emit/engines/sqlx/where-translator.js";
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
    {
      prismaName: "role",
      rustName: "role",
      dbName: "role",
      type: { kind: "enumRef", enumName: "Role", module: "users" },
      optional: false,
      list: false,
      isFk: false,
      isId: false,
      isUnique: false,
      hasDefault: false,
      docs: [],
      serdeRenameOverride: null,
    },
    {
      prismaName: "nickname",
      rustName: "nickname",
      dbName: "nickname",
      type: { kind: "scalar", rust: "String", eq: true, copy: false },
      optional: true,
      list: false,
      isFk: false,
      isId: false,
      isUnique: false,
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

const emptyModels: ReadonlyMap<string, ModelIR> = new Map([["User", user]]);

describe("emitWhereTranslator (sqlx-postgres)", () => {
  const out = emitWhereTranslator(user, emptyModels, POSTGRES);

  it("emits a push_<m>_where with the correct signature", () => {
    expect(out).toContain("pub(crate) fn push_user_where(");
    expect(out).toContain(
      "qb: &mut sqlx::QueryBuilder<'_, sqlx::Postgres>,",
    );
    expect(out).toContain("w: &crate::users::UserWhereInput,");
    expect(out).toContain(") -> bool {");
  });

  it("dispatches the uuid id field to push_uuid_filter with its db name", () => {
    expect(out).toContain(
      `crate::engine::sqlx_postgres::filters::push_uuid_filter(qb, "id", f);`,
    );
  });

  it("dispatches the String email field to push_string_filter with its db name", () => {
    expect(out).toContain(
      `crate::engine::sqlx_postgres::filters::push_string_filter(qb, "email", f);`,
    );
  });

  it("dispatches the enum role field to push_role_filter with its db name", () => {
    expect(out).toContain(
      `crate::engine::sqlx_postgres::filters::push_role_filter(qb, "role", f);`,
    );
  });

  it("uses the *_nullable_filter variant for optional fields", () => {
    expect(out).toContain(
      `crate::engine::sqlx_postgres::filters::push_string_nullable_filter(qb, "nickname", f);`,
    );
  });

  it("emits the AND composition block", () => {
    expect(out).toContain("if let Some(group) = &w.and {");
  });

  it("emits the OR composition block", () => {
    expect(out).toContain("if let Some(group) = &w.or {");
  });

  it("emits the NOT composition block", () => {
    expect(out).toContain("if let Some(group) = &w.not {");
  });

  it("recurses into itself for nested AND/OR/NOT groups", () => {
    // The function body should reference its own name when descending into
    // sub-WhereInputs. Count to confirm all three branches recurse.
    const recursions = out.split("push_user_where(qb, sub)").length - 1;
    expect(recursions).toBe(3);
  });
});

// ---- Relation EXISTS subquery tests --------------------------------------

const firm: ModelIR = {
  name: "Firm",
  module: "firms",
  dbName: "Firm",
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
      prismaName: "name",
      rustName: "name",
      dbName: "name",
      type: { kind: "scalar", rust: "String", eq: true, copy: false },
      optional: false,
      list: false,
      isFk: false,
      isId: false,
      isUnique: false,
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

describe("emitWhereTranslator — to-one relation EXISTS subquery", () => {
  // User holds a FK firmId pointing at Firm; User.firm is a to-one relation.
  const userWithFirm: ModelIR = {
    ...user,
    scalarFields: [
      ...user.scalarFields,
      {
        prismaName: "firmId",
        rustName: "firm_id",
        dbName: "firm_id",
        type: { kind: "scalar", rust: "uuid::Uuid", eq: true, copy: true },
        optional: false,
        list: false,
        isFk: true,
        isId: false,
        isUnique: false,
        hasDefault: false,
        docs: [],
        serdeRenameOverride: null,
      },
    ],
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

  const allModels = new Map<string, ModelIR>([
    ["User", userWithFirm],
    ["Firm", firm],
  ]);
  const out = emitWhereTranslator(userWithFirm, allModels, POSTGRES);

  it("opens an `is` branch on the relation filter wrapper", () => {
    expect(out).toContain("if let Some(rel) = &w.firm {");
    expect(out).toContain("if let Some(sub) = &rel.is {");
    expect(out).toContain("if let Some(sub) = &rel.is_not {");
  });

  it("emits EXISTS (SELECT 1 FROM \"Firm\" t WHERE ...) joining on the FK column", () => {
    expect(out).toContain(
      String.raw`qb.push("EXISTS (SELECT 1 FROM \"Firm\" t WHERE t.\"id\" = \"User\".\"firm_id\" AND (");`,
    );
  });

  it("emits NOT EXISTS for the is_not branch", () => {
    expect(out).toContain(
      String.raw`qb.push("NOT EXISTS (SELECT 1 FROM \"Firm\" t WHERE t.\"id\" = \"User\".\"firm_id\" AND (");`,
    );
  });

  it("recurses into the target model's push_firm_where for the subfilter", () => {
    expect(out).toContain(
      `if !crate::engine::sqlx_postgres::firms::push_firm_where(qb, sub) { qb.push("TRUE"); }`,
    );
  });

  it("closes the subquery with `))`", () => {
    expect(out).toContain(`qb.push("))");`);
  });
});

describe("emitWhereTranslator — to-many relation EXISTS subquery", () => {
  // Post.authorId -> User.id; User.posts is a to-many relation.
  const post: ModelIR = {
    name: "Post",
    module: "posts",
    dbName: "Post",
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
        prismaName: "authorId",
        rustName: "author_id",
        dbName: "author_id",
        type: { kind: "scalar", rust: "uuid::Uuid", eq: true, copy: true },
        optional: false,
        list: false,
        isFk: true,
        isId: false,
        isUnique: false,
        hasDefault: false,
        docs: [],
        serdeRenameOverride: null,
      },
    ],
    relations: [
      {
        prismaName: "author",
        rustName: "author",
        fromModel: "Post",
        toModel: "User",
        cardinality: "one",
        required: true,
        fkFieldNames: ["authorId"],
        backRelationName: null,
        docs: [],
      },
    ],
    idFields: ["id"],
    uniqueGroups: [],
    docs: [],
  };

  const userWithPosts: ModelIR = {
    ...user,
    relations: [
      {
        prismaName: "posts",
        rustName: "posts",
        fromModel: "User",
        toModel: "Post",
        cardinality: "many",
        required: false,
        fkFieldNames: [],
        backRelationName: null,
        docs: [],
      },
    ],
  };

  const allModels = new Map<string, ModelIR>([
    ["User", userWithPosts],
    ["Post", post],
  ]);
  const out = emitWhereTranslator(userWithPosts, allModels, POSTGRES);

  it("opens branches for every / some / none on the list relation filter", () => {
    expect(out).toContain("if let Some(rel) = &w.posts {");
    expect(out).toContain("if let Some(sub) = &rel.every {");
    expect(out).toContain("if let Some(sub) = &rel.some {");
    expect(out).toContain("if let Some(sub) = &rel.none {");
  });

  it("emits the `some` EXISTS subquery joined on the back-FK", () => {
    expect(out).toContain(
      String.raw`qb.push("EXISTS (SELECT 1 FROM \"Post\" t WHERE t.\"author_id\" = \"User\".\"id\" AND (");`,
    );
  });

  it("emits `every` as NOT EXISTS ... AND NOT (...)", () => {
    expect(out).toContain(
      String.raw`qb.push("NOT EXISTS (SELECT 1 FROM \"Post\" t WHERE t.\"author_id\" = \"User\".\"id\" AND NOT (");`,
    );
  });

  it("emits `none` as NOT EXISTS ... AND (...)", () => {
    expect(out).toContain(
      String.raw`qb.push("NOT EXISTS (SELECT 1 FROM \"Post\" t WHERE t.\"author_id\" = \"User\".\"id\" AND (");`,
    );
  });

  it("recurses into the target's push_post_where for each branch", () => {
    const calls =
      out.split("crate::engine::sqlx_postgres::posts::push_post_where(qb, sub)")
        .length - 1;
    expect(calls).toBe(3);
  });
});
