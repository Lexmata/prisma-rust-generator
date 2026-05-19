import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

describe("e2e 12-time-crate", () => {
  it(
    "generates DateTime output using the time crate (instead of chrono)",
    async () => {
      await runFixture("12-time-crate", { dateTimeCrate: "time" });
      await rustVerify("12-time-crate");
    },
    180_000,
  );
});
