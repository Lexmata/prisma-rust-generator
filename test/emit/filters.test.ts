import { describe, it, expect } from "vitest";
import { emitSharedScalarFilters } from "../../src/emit/filters/scalar.js";
import { emitEnumFilter } from "../../src/emit/filters/enum.js";
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

describe("emitSharedScalarFilters", () => {
  it("emits StringFilter with full operator set", () => {
    const out = emitSharedScalarFilters({ serde: true, vis: "pub", cfg: defaultCfg() });
    expect(out).toContain("pub enum StringFilter {");
    expect(out).toContain("Equals(String)");
    expect(out).toContain("Contains(String)");
    expect(out).toContain("Not(Box<StringFilter>)");
    expect(out).toContain("Mode(QueryMode)");
    expect(out).toContain("pub enum StringNullableFilter {");
    expect(out).toContain("IsNull(bool)");
  });
  it("emits all scalar filter families", () => {
    const out = emitSharedScalarFilters({ serde: true, vis: "pub", cfg: defaultCfg() });
    for (const fam of [
      "StringFilter",
      "IntFilter",
      "BigIntFilter",
      "FloatFilter",
      "DecimalFilter",
      "BoolFilter",
      "DateTimeFilter",
      "UuidFilter",
      "BytesFilter",
      "JsonFilter",
    ]) {
      expect(out).toContain(`pub enum ${fam} {`);
      expect(out).toContain(`pub enum ${fam.replace("Filter", "NullableFilter")} {`);
    }
  });
});

describe("emitEnumFilter", () => {
  it("emits RoleFilter and RoleNullableFilter with Equals/In/NotIn/Not", () => {
    const out = emitEnumFilter("Role", "auth", { serde: true, vis: "pub" });
    expect(out).toContain("pub enum RoleFilter {");
    expect(out).toContain("Equals(crate::auth::Role)");
    expect(out).toContain("In(Vec<crate::auth::Role>)");
    expect(out).toContain("Not(Box<RoleFilter>)");
    expect(out).toContain("pub enum RoleNullableFilter {");
    expect(out).toContain("IsNull(bool)");
  });
});
