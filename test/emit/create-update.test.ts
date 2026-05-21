import { describe, it, expect } from "vitest";
import { emitCreateInputs } from "../../src/emit/inputs/create.js";
import { emitUpdateInputs } from "../../src/emit/inputs/update.js";
import type { ModelIR, RelationIR } from "../../src/ir/types.js";

const noRelations: ModelIR = {
  name: "AllScalars",
  module: "schema",
  dbName: "AllScalars",
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
      prismaName: "text",
      rustName: "text",
      dbName: "text",
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
      dbName: "count",
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

  it("UpdateMany variants drop serde derives when serde is off", () => {
    const out = emitUpdateInputs(noRelations, {
      serde: false,
      vis: "pub",
      moduleOf: () => "",
    });
    // Both UpdateMany emitters previously routed through a hardcoded-serde
    // helper that emitted Serialize/Deserialize unconditionally — this
    // guards that regression.
    expect(out).not.toContain("Serialize");
    expect(out).not.toContain("Deserialize");
    expect(out).not.toContain("#[serde");
    expect(out).toContain("pub struct AllScalarsUpdateManyMutationInput {");
    expect(out).toContain("pub struct AllScalarsUncheckedUpdateManyInput {");
  });
});

const oneRelation: ModelIR = {
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
  ],
  relations: [
    {
      prismaName: "author",
      rustName: "author",
      fromModel: "Post",
      toModel: "User",
      cardinality: "one",
      required: true,
      fkFieldNames: [],
      backRelationName: null,
      docs: [],
    } satisfies RelationIR,
  ],
  idFields: ["id"],
  uniqueGroups: [],
  docs: [],
};

describe("nested relation field Box wrapping", () => {
  it("wraps CreateInput relation fields in Option<Box<...>>", () => {
    const out = emitCreateInputs(oneRelation, {
      serde: true,
      vis: "pub",
      moduleOf: () => "posts",
    });
    // Without Box, deeply mutually-recursive input graphs overflow
    // drop-check; this assertion guards the regression.
    expect(out).toMatch(/pub author: Option<Box<crate::posts::User\w+>>/);
  });

  it("wraps UpdateInput relation fields in Option<Box<...>>", () => {
    const out = emitUpdateInputs(oneRelation, {
      serde: true,
      vis: "pub",
      moduleOf: () => "posts",
    });
    expect(out).toMatch(/pub author: Option<Box<crate::posts::User\w+>>/);
  });
});
