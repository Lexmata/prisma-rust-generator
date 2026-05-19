import { describe, it, expect } from "vitest";
import { emitOrderByWithRelationInput } from "../../src/emit/inputs/order-by.js";
import { emitSelectInput, emitIncludeInput } from "../../src/emit/inputs/select-include.js";
import type { ModelIR } from "../../src/ir/types.js";

const model: ModelIR = {
  name: "User",
  module: "users",
  scalarFields: [
    {
      prismaName: "id",
      rustName: "id",
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
  ],
  idFields: ["id"],
  uniqueGroups: [],
  docs: [],
};

describe("OrderBy/Select/Include emitters", () => {
  it("emits MOrderByWithRelationInput with SortOrder for scalars and nested for relations", () => {
    const out = emitOrderByWithRelationInput(model, {
      serde: true,
      vis: "pub",
      moduleOf: (n) => (n === "Firm" ? "firms" : "users"),
    });
    expect(out).toContain("pub struct UserOrderByWithRelationInput {");
    expect(out).toContain("pub id: Option<crate::shared::filters::SortOrder>,");
    expect(out).toContain(
      "pub firm: Option<Box<crate::firms::FirmOrderByWithRelationInput>>,",
    );
  });
  it("emits MSelect with bool per scalar and bool per relation", () => {
    const out = emitSelectInput(model, {
      serde: true,
      vis: "pub",
      moduleOf: (n) => (n === "Firm" ? "firms" : "users"),
    });
    expect(out).toContain("pub struct UserSelect {");
    expect(out).toContain("pub id: Option<bool>,");
    expect(out).toContain("pub firm: Option<bool>,");
  });
  it("emits MInclude with bool per relation", () => {
    const out = emitIncludeInput(model, {
      serde: true,
      vis: "pub",
      moduleOf: (n) => (n === "Firm" ? "firms" : "users"),
    });
    expect(out).toContain("pub struct UserInclude {");
    expect(out).toContain("pub firm: Option<bool>,");
  });
});
