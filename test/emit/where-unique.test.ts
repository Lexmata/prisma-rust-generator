import { describe, it, expect } from "vitest";
import { emitWhereUniqueInput } from "../../src/emit/inputs/where-unique.js";
import type { ModelIR } from "../../src/ir/types.js";

const model: ModelIR = {
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
      defaultKind: "uuid",
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
      defaultKind: null,
      docs: [],
      serdeRenameOverride: null,
    },
  ],
  relations: [],
  idFields: ["id"],
  uniqueGroups: [
    { name: null, fields: ["id"] },
    { name: null, fields: ["email"] },
  ],
  docs: [],
};

describe("emitWhereUniqueInput", () => {
  it("emits Option<T> per unique field", () => {
    const out = emitWhereUniqueInput(model, { serde: true, vis: "pub" });
    expect(out).toContain("pub struct UserWhereUniqueInput {");
    expect(out).toContain("pub id: Option<uuid::Uuid>,");
    expect(out).toContain("pub email: Option<String>,");
  });
});
