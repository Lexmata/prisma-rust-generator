import { describe, it, expect } from "vitest";
import type { DMMF } from "@prisma/generator-helper";
import { buildIR } from "../../src/ir/build.js";
import type { GeneratorConfig } from "../../src/types.js";

const cfg: GeneratorConfig = {
  output: "out",
  outputLayout: "per-file",
  moduleName: null,
  moduleVisibility: "pub",
  dateTimeCrate: "chrono",
  decimalCrate: "rust_decimal",
  uuidFromDbUuid: true,
  bytesCrate: "std",
  jsonCrate: "serde_json",
  serde: true,
  extraDerives: [],
  edition: "2021",
  runRustfmt: true,
  requireRustfmt: true,
  rustfmtBinary: "rustfmt",
  clippyAllowList: [],
  concurrency: 1,
  rustfmtShardSize: 16,
  filePreamble: "",
};

const minimalDmmf: DMMF.Document = {
  datamodel: {
    models: [
      {
        name: "User",
        dbName: null,
        fields: [
          {
            name: "id",
            kind: "scalar",
            isList: false,
            isRequired: true,
            isUnique: false,
            isId: true,
            isReadOnly: false,
            hasDefaultValue: true,
            type: "String",
            nativeType: ["Uuid", []],
            default: { name: "uuid", args: [] },
            isGenerated: false,
            isUpdatedAt: false,
          },
          {
            name: "email",
            kind: "scalar",
            isList: false,
            isRequired: true,
            isUnique: true,
            isId: false,
            isReadOnly: false,
            hasDefaultValue: false,
            type: "String",
            isGenerated: false,
            isUpdatedAt: false,
          },
        ],
        primaryKey: { name: null, fields: ["id"] },
        uniqueFields: [],
        uniqueIndexes: [],
        isGenerated: false,
      } as unknown as DMMF.Model,
    ],
    enums: [],
    types: [],
    indexes: [],
  },
  schema: {
    inputObjectTypes: { prisma: [] },
    outputObjectTypes: { prisma: [], model: [] },
    enumTypes: { prisma: [] },
    fieldRefTypes: { prisma: [] },
  },
  mappings: { modelOperations: [], otherOperations: { read: [], write: [] } },
};

describe("buildIR", () => {
  it("emits a User model with mapped fields", async () => {
    const fileMap = new Map([["User", "users"]]);
    const ir = await buildIR(minimalDmmf, fileMap, cfg);
    expect(ir.models).toHaveLength(1);
    const user = ir.models[0]!;
    expect(user.name).toBe("User");
    expect(user.module).toBe("users");
    expect(user.scalarFields.map((f) => f.rustName)).toEqual(["id", "email"]);
    expect(user.scalarFields[0]!.type).toEqual({ kind: "scalar", rust: "uuid::Uuid", eq: true, copy: true });
    expect(user.scalarFields[0]!.isId).toBe(true);
    expect(user.scalarFields[1]!.isUnique).toBe(true);
  });
});
