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
  it("emits StringFilter as a struct with the full operator set", () => {
    const out = emitSharedScalarFilters({ serde: true, vis: "pub", cfg: defaultCfg() });
    expect(out).toContain("pub struct StringFilter {");
    expect(out).toContain("pub equals: Option<String>,");
    expect(out).toContain(`#[serde(rename = "in")]`);
    expect(out).toContain("pub r#in: Option<Vec<String>>,");
    expect(out).toContain("pub not_in: Option<Vec<String>>,");
    expect(out).toContain("pub lt: Option<String>,");
    expect(out).toContain("pub lte: Option<String>,");
    expect(out).toContain("pub gt: Option<String>,");
    expect(out).toContain("pub gte: Option<String>,");
    expect(out).toContain("pub contains: Option<String>,");
    expect(out).toContain("pub starts_with: Option<String>,");
    expect(out).toContain("pub ends_with: Option<String>,");
    expect(out).toContain("pub mode: Option<QueryMode>,");
    expect(out).toContain("pub not: Option<Box<StringFilter>>,");
    expect(out).toContain("pub struct StringNullableFilter {");
    expect(out).toContain("pub is_null: Option<bool>,");
  });

  it("emits all scalar filter families as structs", () => {
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
      expect(out).toContain(`pub struct ${fam} {`);
      expect(out).toContain(`pub struct ${fam.replace("Filter", "NullableFilter")} {`);
    }
  });

  it("derives Default on every filter struct so consumers can use ..Default::default()", () => {
    const out = emitSharedScalarFilters({ serde: true, vis: "pub", cfg: defaultCfg() });
    // Every derive line on a filter struct must include Default.
    const lines = out.split("\n");
    const deriveLines = lines.filter((l) => l.includes("#[derive("));
    expect(deriveLines.length).toBeGreaterThan(0);
    for (const l of deriveLines) {
      expect(l).toContain("Default");
    }
  });

  it("emits UuidFilter with mode (case-insensitive) but no lt/lte/gt/gte", () => {
    const out = emitSharedScalarFilters({ serde: true, vis: "pub", cfg: defaultCfg() });
    const uuidBlock = extractBlock(out, "pub struct UuidFilter {");
    expect(uuidBlock).toContain("pub mode: Option<QueryMode>,");
    expect(uuidBlock).not.toContain("pub lt:");
    expect(uuidBlock).not.toContain("pub contains:");
  });

  it("emits IntFilter with ordering but no mode/contains", () => {
    const out = emitSharedScalarFilters({ serde: true, vis: "pub", cfg: defaultCfg() });
    const intBlock = extractBlock(out, "pub struct IntFilter {");
    expect(intBlock).toContain("pub lt: Option<i32>,");
    expect(intBlock).toContain("pub gte: Option<i32>,");
    expect(intBlock).not.toContain("pub mode:");
    expect(intBlock).not.toContain("pub contains:");
  });

  it("omits serde attributes when serde is off", () => {
    const cfg = defaultCfg();
    const out = emitSharedScalarFilters({ serde: false, vis: "pub", cfg });
    expect(out).not.toContain("Serialize");
    expect(out).not.toContain("Deserialize");
    expect(out).not.toContain("#[serde");
    // Struct shape and Default derive must still be present.
    expect(out).toContain("pub struct StringFilter {");
    expect(out).toContain("Default");
  });
});

describe("emitEnumFilter", () => {
  it("emits RoleFilter and RoleNullableFilter as structs", () => {
    const out = emitEnumFilter("Role", "auth", { serde: true, vis: "pub" });
    expect(out).toContain("pub struct RoleFilter {");
    expect(out).toContain("pub equals: Option<crate::auth::Role>,");
    expect(out).toContain("pub r#in: Option<Vec<crate::auth::Role>>,");
    expect(out).toContain("pub not_in: Option<Vec<crate::auth::Role>>,");
    expect(out).toContain("pub not: Option<Box<RoleFilter>>,");
    expect(out).toContain("pub struct RoleNullableFilter {");
    expect(out).toContain("pub is_null: Option<bool>,");
  });

  it("derives Default on enum filter structs and omits Eq/Hash", () => {
    const out = emitEnumFilter("Role", "auth", { serde: true, vis: "pub" });
    const lines = out.split("\n");
    const deriveLines = lines.filter((l) => l.includes("#[derive("));
    expect(deriveLines.length).toBe(2);
    for (const l of deriveLines) {
      expect(l).toContain("Default");
      expect(l).not.toMatch(/\bEq\b/);
      expect(l).not.toContain("Hash");
    }
  });
});

/** Pull out the lines from `header` (inclusive) up to the next closing `}` at column 0. */
function extractBlock(src: string, header: string): string {
  const start = src.indexOf(header);
  if (start === -1) throw new Error(`block not found: ${header}`);
  const tail = src.slice(start);
  // Match through the first `}` that appears at the start of its line.
  const end = tail.search(/\n\}\n/);
  if (end === -1) return tail;
  return tail.slice(0, end + 3);
}
