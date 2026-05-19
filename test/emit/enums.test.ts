import { describe, it, expect } from "vitest";
import { emitEnum } from "../../src/emit/enums.js";
import type { EnumIR } from "../../src/ir/types.js";

describe("emitEnum", () => {
  it("emits PascalCase variants without rename", () => {
    const e: EnumIR = {
      name: "Role", module: "auth", eqEligible: true, docs: [],
      variants: [
        { prismaName: "Admin", rustName: "Admin", serdeRename: null, docs: [] },
        { prismaName: "Member", rustName: "Member", serdeRename: null, docs: [] },
      ],
    };
    const out = emitEnum(e, { serde: true, vis: "pub" });
    expect(out).toContain("pub enum Role");
    expect(out).toContain("    Admin,\n    Member,\n");
    expect(out).toContain(
      "#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]",
    );
  });
  it("preserves wire format for UPPER_SNAKE variants via serde rename", () => {
    const e: EnumIR = {
      name: "CaseStatus", module: "cases", eqEligible: true, docs: [],
      variants: [
        { prismaName: "IN_REVIEW", rustName: "InReview", serdeRename: "IN_REVIEW", docs: [] },
      ],
    };
    const out = emitEnum(e, { serde: true, vis: "pub" });
    expect(out).toContain(`#[serde(rename = "IN_REVIEW")]\n    InReview,`);
  });
  it("omits Serialize/Deserialize derives when serde=false", () => {
    const e: EnumIR = {
      name: "Role", module: "auth", eqEligible: true, docs: [],
      variants: [{ prismaName: "Admin", rustName: "Admin", serdeRename: null, docs: [] }],
    };
    const out = emitEnum(e, { serde: false, vis: "pub" });
    expect(out).not.toContain("Serialize");
  });
});
