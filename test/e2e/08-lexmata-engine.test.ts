import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

describe("e2e 08-lexmata + engine = sqlx-postgres", () => {
  it(
    "generates engine output against the 80-model lexmata schema cleanly",
    async () => {
      // Use a separate compile dir so this test and the ORM-agnostic
      // 08-lexmata test can run in parallel without racing on the same
      // src/ directory (each test rm -rfs its outDir).
      await runFixture("08-lexmata", { engine: "sqlx-postgres" }, "08-lexmata-engine");
      await rustVerify("08-lexmata-engine");
    },
    600_000,
  );
});
