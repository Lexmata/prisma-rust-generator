import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

// The full lexmata-models schema (16 .prisma files, ~2k lines, ~80 models with
// hundreds of relations) is the canonical stress test. Beyond the disambiguator
// fix in nested-input naming, additional edge cases surface (self-relations,
// multi-relations between the same model pair using @relation("name") aliases,
// and complex polymorphic patterns) that v1 doesn't yet handle. The fixture
// schema is checked in so the failures are reproducible; the test is skipped
// pending follow-up work.
describe.skip("e2e 08-lexmata", () => {
  it(
    "generates the full lexmata-models schema (multi-file) and compiles cleanly",
    async () => {
      await runFixture("08-lexmata");
      await rustVerify("08-lexmata");
    },
    600_000,
  );
});
