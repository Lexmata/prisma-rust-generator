import { describe, it, expect } from "vitest";
import { emitPerFile } from "../../src/layout/per-file.js";
import type { IR } from "../../src/ir/types.js";
import type { GeneratorConfig } from "../../src/types.js";

const ir: IR = {
  models: [
    {
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
      relations: [],
      idFields: ["id"],
      uniqueGroups: [],
      docs: [],
    },
    {
      name: "Firm",
      module: "firms",
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
  modelEqEligibility: new Map([
    ["User", true],
    ["Firm", true],
  ]),
  inputCycles: new Set(),
  schemaEdition: "2021",
};

function defaultCfg(): GeneratorConfig {
  return {
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
    runRustfmt: false,
    requireRustfmt: false,
    rustfmtBinary: "rustfmt",
    clippyAllowList: ["clippy::upper_case_acronyms", "dead_code"],
    concurrency: 1,
    rustfmtShardSize: 16,
    filePreamble: "",
  };
}

describe("emitPerFile", () => {
  it("creates one file per module plus shared/filters and lib.rs", () => {
    const files = emitPerFile(ir, defaultCfg());
    expect(files.has("users.rs")).toBe(true);
    expect(files.has("firms.rs")).toBe(true);
    expect(files.has("shared/filters.rs")).toBe(true);
    expect(files.has("lib.rs")).toBe(true);
    expect(files.get("lib.rs")!).toContain("pub mod users;");
    expect(files.get("lib.rs")!).toContain("pub mod firms;");
    expect(files.get("lib.rs")!).toContain("pub mod shared;");
    expect(files.get("users.rs")!).toContain("pub struct User");
    expect(files.get("users.rs")!).toContain("pub struct UserWhereInput");
    expect(files.get("users.rs")!).toContain("pub struct UserRelationFilter");
  });
});
