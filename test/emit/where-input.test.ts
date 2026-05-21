import { describe, it, expect } from "vitest";
import { emitModelWhereInput } from "../../src/emit/filters/model.js";
import { emitRelationFilters } from "../../src/emit/filters/relation.js";
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
      fkFieldNames: [],
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

describe("emitModelWhereInput", () => {
  it("emits a UserWhereInput with scalar, nullable, relation, AND/OR/NOT fields", () => {
    const out = emitModelWhereInput(user, {
      serde: true,
      vis: "pub",
      moduleOf: (n) => (n === "Firm" ? "firms" : "cases"),
    });
    expect(out).toContain("pub struct UserWhereInput {");
    expect(out).toContain("pub id: Option<crate::shared::filters::UuidFilter>,");
    expect(out).toContain(
      "pub deleted_at: Option<crate::shared::filters::DateTimeNullableFilter>,",
    );
    expect(out).toContain("pub firm: Option<crate::firms::FirmRelationFilter>,");
    expect(out).toContain("pub cases: Option<crate::cases::CaseListRelationFilter>,");
    expect(out).toContain(`#[serde(rename = "AND")]`);
    expect(out).toContain("pub and: Option<Vec<UserWhereInput>>,");
    expect(out).toContain("pub or: Option<Vec<UserWhereInput>>,");
    expect(out).toContain("pub not: Option<Vec<UserWhereInput>>,");
  });
});

describe("emitRelationFilters", () => {
  it("emits FirmRelationFilter + FirmListRelationFilter", () => {
    const out = emitRelationFilters("Firm", "firms", { serde: true, vis: "pub" });
    expect(out).toContain("pub struct FirmRelationFilter {");
    expect(out).toContain("pub is: Option<Box<crate::firms::FirmWhereInput>>,");
    expect(out).toContain("pub is_not: Option<Box<crate::firms::FirmWhereInput>>,");
    expect(out).toContain("pub struct FirmListRelationFilter {");
    expect(out).toContain("pub some: Option<Box<crate::firms::FirmWhereInput>>,");
    expect(out).toContain("pub every: Option<Box<crate::firms::FirmWhereInput>>,");
    expect(out).toContain("pub none: Option<Box<crate::firms::FirmWhereInput>>,");
  });
});
