import { describe, it, expect } from "vitest";
import { RustWriter } from "../../src/emit/rust-writer.js";

describe("RustWriter", () => {
  it("emits attributes, derives, and a struct block", () => {
    const w = new RustWriter();
    w.deriveLine(["Debug", "Clone", "PartialEq"]);
    w.line(`#[serde(rename_all = "camelCase")]`);
    w.openStruct("pub", "User");
    w.field("pub id", "uuid::Uuid");
    w.field("pub email", "String");
    w.close();
    expect(w.toString()).toBe(
      `#[derive(Debug, Clone, PartialEq)]\n` +
        `#[serde(rename_all = "camelCase")]\n` +
        `pub struct User {\n` +
        `    pub id: uuid::Uuid,\n` +
        `    pub email: String,\n` +
        `}\n`,
    );
  });
  it("emits an enum block with variants", () => {
    const w = new RustWriter();
    w.deriveLine(["Debug", "Clone", "PartialEq", "Eq"]);
    w.openEnum("pub", "Role");
    w.variant("Admin");
    w.variant("Member");
    w.close();
    expect(w.toString()).toContain("pub enum Role {\n    Admin,\n    Member,\n}");
  });
  it("supports doc comments split into multiple /// lines", () => {
    const w = new RustWriter();
    w.docComments(["first line", "second line"]);
    w.line("pub struct X;");
    expect(w.toString()).toBe("/// first line\n/// second line\npub struct X;\n");
  });
});
