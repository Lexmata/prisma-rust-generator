import { describe, expect, it } from "vitest";
import { emitFromRow } from "../../../../src/emit/engines/sqlx-postgres/from-row.js";
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
    {
      prismaName: "posts",
      rustName: "posts",
      fromModel: "User",
      toModel: "Post",
      cardinality: "many",
      required: true,
      fkFieldNames: [],
      backRelationName: null,
      docs: [],
    },
  ],
  idFields: ["id"],
  uniqueGroups: [],
  docs: [],
};

describe("emitFromRow (sqlx-postgres)", () => {
  it("emits a FromRow impl that reads scalars via try_get and zero-inits relations", () => {
    const out = emitFromRow(user);
    expect(out).toContain(
      "impl sqlx::FromRow<'_, sqlx::postgres::PgRow> for crate::users::User",
    );
    expect(out).toContain(`row.try_get("id")`);
    expect(out).toContain(`row.try_get("email")`);
    expect(out).toContain(`row.try_get("firm_id")`);
    expect(out).toContain("firm: None");
    expect(out).toContain("posts: Vec::new()");
  });

  it("reads via the dbName, not the prisma/rust name", () => {
    const renamed: ModelIR = {
      ...user,
      scalarFields: [
        {
          prismaName: "createdAt",
          rustName: "created_at",
          dbName: "created_at_col",
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
        },
      ],
      relations: [],
    };
    const out = emitFromRow(renamed);
    expect(out).toContain(`created_at: row.try_get("created_at_col")?`);
    expect(out).not.toContain(`row.try_get("createdAt")`);
    expect(out).not.toContain(`row.try_get("created_at")?`);
  });

  it("relies on the module-level `use sqlx::Row as _;` import so try_get is in scope", () => {
    // The per-file layout writes `use sqlx::Row as _;` once at the top of each
    // engine/<dir>/<module>.rs file. Re-importing inside every FromRow impl
    // is redundant and trips clippy's unused_imports lint, so the emitter
    // intentionally omits the local `use`.
    const out = emitFromRow(user);
    expect(out).not.toContain("use sqlx::Row;");
    expect(out).toContain("row.try_get(");
  });
});
