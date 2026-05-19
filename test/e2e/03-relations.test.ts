import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

describe("e2e 03-relations", () => {
  it(
    "generates relation+nested-input output that compiles cleanly",
    async () => {
      await runFixture("03-relations");
      await rustVerify("03-relations");
    },
    300_000,
  );
});
