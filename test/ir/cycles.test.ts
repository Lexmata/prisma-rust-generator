import { describe, it, expect } from "vitest";
import { findInputCycles } from "../../src/ir/cycles.js";

describe("findInputCycles", () => {
  it("finds direct self-reference", () => {
    const edges = new Map<string, Set<string>>([
      ["UserWhereInput", new Set(["UserWhereInput"])],
    ]);
    const cycles = findInputCycles(edges);
    expect(cycles.has("UserWhereInput")).toBe(true);
  });
  it("finds two-node cycle", () => {
    const edges = new Map<string, Set<string>>([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
    ]);
    const cycles = findInputCycles(edges);
    expect(cycles.has("A")).toBe(true);
    expect(cycles.has("B")).toBe(true);
  });
  it("does not flag acyclic nodes", () => {
    const edges = new Map<string, Set<string>>([
      ["A", new Set(["B"])],
      ["B", new Set()],
    ]);
    const cycles = findInputCycles(edges);
    expect(cycles.size).toBe(0);
  });
});
