import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

describe("e2e 14-stress + engine = sqlx-postgres", () => {
  it(
    "generates engine output against the ~75-model synthetic stress schema cleanly",
    async () => {
      // Use a separate compile dir so this test and the ORM-agnostic
      // 14-stress test can run in parallel without racing on the same
      // src/ directory (each test rm -rfs its outDir).
      await runFixture("14-stress", { engine: "sqlx-postgres" }, "14-stress-engine");
      await rustVerify("14-stress-engine");
    },
    600_000,
  );
});
