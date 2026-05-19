import { describe, it, expect } from "vitest";
import { GENERATOR_NAME } from "../src/index.js";

describe("generator entry", () => {
  it("exports the generator name", () => {
    expect(GENERATOR_NAME).toBe("prisma-rust-generator");
  });
});
