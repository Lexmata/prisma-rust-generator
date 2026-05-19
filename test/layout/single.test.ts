import { describe, it, expect } from "vitest";
import { emitSingle } from "../../src/layout/single.js";
import type { IR } from "../../src/ir/types.js";
import type { GeneratorConfig } from "../../src/types.js";

function defaultCfg(): GeneratorConfig {
  return {
    output: "out",
    outputLayout: "single",
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

describe("emitSingle", () => {
  it("emits a single lib.rs containing models, enums, and shared types", () => {
    const ir: IR = {
      models: [
        {
          name: "User",
          module: "auth",
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
        },
      ],
      enums: [],
      modelEqEligibility: new Map([["User", true]]),
      inputCycles: new Set(),
      schemaEdition: "2021",
    };
    const files = emitSingle(ir, defaultCfg());
    expect(files.size).toBe(1);
    expect(files.has("lib.rs")).toBe(true);
    const lib = files.get("lib.rs")!;
    expect(lib).toContain("pub struct User");
    expect(lib).toContain("pub enum StringFilter");
    expect(lib).toContain("pub struct UserWhereInput");
  });
});
