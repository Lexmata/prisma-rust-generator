import { describe, it, expect } from "vitest";
import { emitCreateInputs } from "../../src/emit/inputs/create.js";
import { emitUpdateInputs } from "../../src/emit/inputs/update.js";
import type { ModelIR } from "../../src/ir/types.js";

const noRelations: ModelIR = {
  name: "AllScalars",
  module: "schema",
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
    {
      prismaName: "text",
      rustName: "text",
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
    {
      prismaName: "count",
      rustName: "count",
      type: { kind: "scalar", rust: "i32", eq: true, copy: true },
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

describe("emitCreateInputs", () => {
  it("emits MCreateInput skipping defaulted fields", () => {
    const out = emitCreateInputs(noRelations, {
      serde: true,
      vis: "pub",
      moduleOf: () => "",
    });
    expect(out).toContain("pub struct AllScalarsCreateInput {");
    expect(out).not.toContain("pub id:");
    expect(out).toContain("pub text: String,");
    expect(out).toContain("pub count: i32,");
    expect(out).toContain("pub struct AllScalarsUncheckedCreateInput {");
    expect(out).toContain("pub struct AllScalarsCreateManyInput {");
  });
});

describe("emitUpdateInputs", () => {
  it("emits MUpdateInput with scalar op-input wrapping", () => {
    const out = emitUpdateInputs(noRelations, {
      serde: true,
      vis: "pub",
      moduleOf: () => "",
    });
    expect(out).toContain("pub struct AllScalarsUpdateInput {");
    expect(out).toContain(
      "pub id: Option<crate::shared::filters::UuidFieldUpdateOperationsInput>,",
    );
    expect(out).toContain(
      "pub text: Option<crate::shared::filters::StringFieldUpdateOperationsInput>,",
    );
    expect(out).toContain(
      "pub count: Option<crate::shared::filters::IntFieldUpdateOperationsInput>,",
    );
    expect(out).toContain("pub struct AllScalarsUncheckedUpdateInput {");
    expect(out).toContain("pub struct AllScalarsUpdateManyMutationInput {");
    expect(out).toContain("pub struct AllScalarsUncheckedUpdateManyInput {");
  });
});
