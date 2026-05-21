import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

describe("e2e 10-engine-per-model", () => {
  it(
    "generates engine output under per-model layout that compiles cleanly",
    async () => {
      await runFixture("10-engine-per-model", {
        engine: "sqlx-postgres",
        outputLayout: "per-model",
      });
      await rustVerify("10-engine-per-model");
    },
    600_000,
  );
});
