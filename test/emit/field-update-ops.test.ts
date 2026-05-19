import { describe, it, expect } from "vitest";
import { emitFieldUpdateOps } from "../../src/emit/inputs/field-update-ops.js";
import type { GeneratorConfig } from "../../src/types.js";

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
    clippyAllowList: [],
    concurrency: 1,
    rustfmtShardSize: 16,
    filePreamble: "",
  };
}

describe("emitFieldUpdateOps", () => {
  it("emits IntFieldUpdateOperationsInput with arithmetic ops", () => {
    const out = emitFieldUpdateOps({ serde: true, vis: "pub", cfg: defaultCfg() });
    expect(out).toContain("pub struct IntFieldUpdateOperationsInput {");
    expect(out).toContain("pub set: Option<i32>,");
    expect(out).toContain("pub increment: Option<i32>,");
    expect(out).toContain("pub decrement: Option<i32>,");
    expect(out).toContain("pub multiply: Option<i32>,");
    expect(out).toContain("pub divide: Option<i32>,");
    expect(out).toContain("pub struct NullableIntFieldUpdateOperationsInput {");
  });
  it("emits set-only variants for non-numeric families", () => {
    const out = emitFieldUpdateOps({ serde: true, vis: "pub", cfg: defaultCfg() });
    for (const fam of ["String", "Bool", "DateTime", "Uuid", "Bytes", "Json"]) {
      expect(out).toContain(`pub struct ${fam}FieldUpdateOperationsInput {`);
      expect(out).toContain(`pub struct Nullable${fam}FieldUpdateOperationsInput {`);
    }
  });
  it("emits list-update variants per scalar", () => {
    const out = emitFieldUpdateOps({ serde: true, vis: "pub", cfg: defaultCfg() });
    expect(out).toContain("pub struct StringListFieldUpdateOperationsInput {");
    expect(out).toContain("pub set: Option<Vec<String>>,");
    expect(out).toContain("pub push: Option<crate::shared::filters::OneOrMany<String>>,");
  });
});
