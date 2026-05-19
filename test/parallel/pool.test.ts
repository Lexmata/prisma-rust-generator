import { describe, it, expect } from "vitest";
import { mapInPool } from "../../src/parallel/pool.js";

describe("mapInPool", () => {
  it("preserves input order in the output", async () => {
    const out = await mapInPool([1, 2, 3, 4, 5], 2, async (x) => x * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });
  it("respects concurrency=1 by running serially", async () => {
    const log: number[] = [];
    await mapInPool([1, 2, 3], 1, async (x) => {
      log.push(x);
      return x;
    });
    expect(log).toEqual([1, 2, 3]);
  });
  it("propagates errors", async () => {
    await expect(
      mapInPool([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error("boom");
        return x;
      }),
    ).rejects.toThrow(/boom/);
  });
});
