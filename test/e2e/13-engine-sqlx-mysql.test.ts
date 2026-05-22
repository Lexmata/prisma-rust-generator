import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

describe("e2e 13-engine-sqlx-mysql", () => {
  it(
    "generates engine output that compiles cleanly",
    async () => {
      await runFixture("13-engine-sqlx-mysql", { engine: "sqlx-mysql" });
      await rustVerify("13-engine-sqlx-mysql");
    },
    600_000,
  );
});
