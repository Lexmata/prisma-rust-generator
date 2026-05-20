import { describe, it, expect } from "vitest";
import { isSkipRequested } from "../src/options.js";

describe("isSkipRequested", () => {
  it("returns false for non-string values", () => {
    // Explicit undefined mirrors the call site in src/index.ts where
    // opts.generator.config.skip is absent — the exact code path.
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(isSkipRequested(undefined)).toBe(false);
    expect(isSkipRequested(null)).toBe(false);
    expect(isSkipRequested(0)).toBe(false);
    expect(isSkipRequested(true)).toBe(false);
    expect(isSkipRequested(["1"])).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isSkipRequested("")).toBe(false);
  });

  it.each(["0", "false", "False", "FALSE", "no", "NO", "off", " off "])(
    "returns false for falsy literal %j",
    (v) => {
      expect(isSkipRequested(v)).toBe(false);
    },
  );

  it.each(["1", "true", "True", "TRUE", "yes", "on", " 1 ", "anything"])(
    "returns true for truthy value %j",
    (v) => {
      expect(isSkipRequested(v)).toBe(true);
    },
  );
});
