import { describe, it, expect } from "vitest";
import {
  toSnakeCase,
  toPascalCase,
  isReservedRustKeyword,
  rustFieldIdent,
} from "../../src/ir/names.js";

describe("toSnakeCase", () => {
  it.each([
    ["firmId", "firm_id"],
    ["createdAt", "created_at"],
    ["URLEntry", "url_entry"],
    ["HTTPRequest", "http_request"],
    ["XMLHttpRequest", "xml_http_request"],
    ["id", "id"],
    ["_internal", "internal"],
  ])("%s → %s", (input, expected) => {
    expect(toSnakeCase(input)).toBe(expected);
  });
});

describe("toPascalCase", () => {
  it.each([
    ["snake_case_name", "SnakeCaseName"],
    ["URL_TYPE", "UrlType"],
    ["alreadyPascal", "AlreadyPascal"],
  ])("%s → %s", (input, expected) => {
    expect(toPascalCase(input)).toBe(expected);
  });
});

describe("isReservedRustKeyword", () => {
  it.each(["type", "match", "ref", "move", "use", "fn", "let", "self", "Self"])(
    "%s is reserved",
    (kw) => expect(isReservedRustKeyword(kw)).toBe(true),
  );
  it("ordinary identifiers are not reserved", () => {
    expect(isReservedRustKeyword("user")).toBe(false);
  });
});

describe("rustFieldIdent", () => {
  it("snake_cases and raw-prefixes reserved keywords", () => {
    expect(rustFieldIdent("type")).toBe("r#type");
    expect(rustFieldIdent("userType")).toBe("user_type");
  });
});
