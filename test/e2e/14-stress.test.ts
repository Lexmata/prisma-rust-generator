import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

// Canonical stress test: 17 .prisma files, ~2k lines, ~75 models with
// hundreds of relations. Synthetic, name-anonymized — see
// scripts/anonymize-stress-fixture.mjs for how it's produced.
describe("e2e 14-stress", () => {
  it(
    "generates the full synthetic stress schema (multi-file) and compiles cleanly",
    async () => {
      await runFixture("14-stress");
      await rustVerify("14-stress");
    },
    300_000,
  );
});
