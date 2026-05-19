import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

describe("e2e 05-keywords", () => {
  it(
    "generates fields named after Rust keywords with r# raw-ident prefixes",
    async () => {
      await runFixture("05-keywords");
      await rustVerify("05-keywords");
    },
    180_000,
  );
});
