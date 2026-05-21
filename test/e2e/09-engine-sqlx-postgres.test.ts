import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

describe("e2e 09-engine-sqlx-postgres", () => {
  it(
    "generates engine output that compiles cleanly",
    async () => {
      await runFixture("09-engine-sqlx-postgres", { engine: "sqlx-postgres" });
      await rustVerify("09-engine-sqlx-postgres");
    },
    600_000,
  );
});
