import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

describe("e2e 11-engine-sqlx-sqlite", () => {
  it(
    "generates engine output that compiles cleanly",
    async () => {
      await runFixture("11-engine-sqlx-sqlite", { engine: "sqlx-sqlite" });
      await rustVerify("11-engine-sqlx-sqlite");
    },
    600_000,
  );
});
