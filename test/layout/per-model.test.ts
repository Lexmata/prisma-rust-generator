import { describe, it, expect } from "vitest";
import { emitPerModel } from "../../src/layout/per-model.js";
import type { IR, ModelIR } from "../../src/ir/types.js";
import type { GeneratorConfig } from "../../src/types.js";

function stubModel(name: string, module: string): ModelIR {
  return {
    name,
    module,
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
    relations: [],
    idFields: ["id"],
    uniqueGroups: [],
    docs: [],
  };
}

function defaultCfg(): GeneratorConfig {
  return {
    output: "out",
    outputLayout: "per-model",
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
    runRustfmt: false,
    requireRustfmt: false,
    rustfmtBinary: "rustfmt",
    clippyAllowList: [],
    concurrency: 1,
    rustfmtShardSize: 16,
    filePreamble: "",
  };
}

describe("emitPerModel", () => {
  it("emits one file per model under models/", () => {
    const ir: IR = {
      models: [stubModel("User", "auth"), stubModel("Firm", "auth")],
      enums: [],
      modelEqEligibility: new Map(),
      inputCycles: new Set(),
      schemaEdition: "2021",
    };
    const files = emitPerModel(ir, defaultCfg());
    expect(files.has("models/user.rs")).toBe(true);
    expect(files.has("models/firm.rs")).toBe(true);
    expect(files.has("shared/filters.rs")).toBe(true);
    expect(files.has("lib.rs")).toBe(true);
  });
});
