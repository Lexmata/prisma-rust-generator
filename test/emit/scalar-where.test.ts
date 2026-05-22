import { describe, it, expect } from "vitest";
import { emitModelScalarWhereInput } from "../../src/emit/inputs/scalar-where.js";
import type { FieldIR, ModelIR } from "../../src/ir/types.js";

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

const nameField: FieldIR = {
  prismaName: "name",
  rustName: "name",
  dbName: "name",
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

const userModel: ModelIR = {
  name: "User",
  module: "users",
  dbName: "User",
  scalarFields: [idField, nameField],
  relations: [],
  idFields: ["id"],
  uniqueGroups: [],
  docs: [],
};

describe("emitModelScalarWhereInput", () => {
  it("emits a per-model struct with scalar filter fields", () => {
    const out = emitModelScalarWhereInput(userModel, {
      serde: true,
      vis: "pub",
    });
    expect(out).toContain("pub struct UserScalarWhereInput {");
    expect(out).toContain("pub id: Option<crate::shared::filters::UuidFilter>");
    expect(out).toContain(
      "pub name: Option<crate::shared::filters::StringNullableFilter>",
    );
  });

  it("emits AND/OR/NOT with serde renames when serde is on", () => {
    const out = emitModelScalarWhereInput(userModel, {
      serde: true,
      vis: "pub",
    });
    expect(out).toContain(`#[serde(rename = "AND")]`);
    expect(out).toContain("pub and: Option<Vec<UserScalarWhereInput>>");
    expect(out).toContain(`#[serde(rename = "OR")]`);
    expect(out).toContain(`#[serde(rename = "NOT")]`);
  });

  it("omits all #[serde(...)] attributes when serde is off", () => {
    const out = emitModelScalarWhereInput(userModel, {
      serde: false,
      vis: "pub",
    });
    expect(out).not.toContain("#[serde");
    expect(out).not.toContain("Serialize");
    expect(out).not.toContain("Deserialize");
    expect(out).toContain("pub and: Option<Vec<UserScalarWhereInput>>");
  });

  it("respects pub(crate) visibility", () => {
    const out = emitModelScalarWhereInput(userModel, {
      serde: true,
      vis: "pub(crate)",
    });
    expect(out).toContain("pub(crate) struct UserScalarWhereInput {");
  });
});
