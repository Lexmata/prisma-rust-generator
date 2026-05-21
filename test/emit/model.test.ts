import { describe, it, expect } from "vitest";
import { emitModel } from "../../src/emit/model.js";
import type { ModelIR } from "../../src/ir/types.js";

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
      prismaName: "firmId",
      rustName: "firm_id",
      dbName: "firmId",
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
    {
      prismaName: "deletedAt",
      rustName: "deleted_at",
      dbName: "deletedAt",
      type: { kind: "scalar", rust: "chrono::DateTime<chrono::Utc>", eq: true, copy: true },
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
      prismaName: "cases",
      rustName: "cases",
      fromModel: "User",
      toModel: "Case",
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

describe("emitModel", () => {
  it("emits a struct with FK columns and serde-skipped relations", () => {
    const out = emitModel(user, {
      serde: true,
      vis: "pub",
      eqEligible: true,
      moduleOf: (name) => (name === "Firm" ? "firms" : "cases"),
      extraDerives: [],
    });
    expect(out).toContain("pub struct User {");
    expect(out).toContain("pub id: uuid::Uuid,");
    expect(out).toContain("pub firm_id: uuid::Uuid,");
    expect(out).toContain("pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,");
    expect(out).toContain(`#[serde(default, skip_serializing_if = "Option::is_none")]`);
    expect(out).toContain("pub firm: Option<Box<crate::firms::Firm>>,");
    expect(out).toContain(`#[serde(default, skip_serializing_if = "Vec::is_empty")]`);
    expect(out).toContain("pub cases: Vec<crate::cases::Case>,");
    expect(out).toContain("Eq");
  });
  it("omits Eq derive when not eligible", () => {
    const out = emitModel(user, {
      serde: true,
      vis: "pub",
      eqEligible: false,
      moduleOf: (n) => (n === "Firm" ? "firms" : "cases"),
      extraDerives: [],
    });
    expect(out).not.toMatch(/derive\([^)]*\bEq\b/);
  });
});
