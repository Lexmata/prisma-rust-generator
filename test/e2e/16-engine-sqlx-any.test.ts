import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

describe("e2e 16-engine-sqlx-any", () => {
  it(
    "generates engine output that compiles cleanly",
    async () => {
      await runFixture("16-engine-sqlx-any", { engine: "sqlx-any" });
      await rustVerify("16-engine-sqlx-any");
    },
    600_000,
  );
});
