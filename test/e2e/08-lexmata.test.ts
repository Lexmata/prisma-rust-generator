import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

// Canonical stress test: 17 .prisma files, ~2k lines, ~80 models with
// hundreds of relations, copied from the real lexmata-models schema.
describe("e2e 08-lexmata", () => {
  it(
    "generates the full lexmata-models schema (multi-file) and compiles cleanly",
    async () => {
      await runFixture("08-lexmata");
      await rustVerify("08-lexmata");
    },
    300_000,
  );
});
