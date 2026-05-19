import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

describe("e2e 01-scalars", () => {
  it(
    "generates output that compiles cleanly under cargo check/clippy/fmt",
    async () => {
      await runFixture("01-scalars");
      await rustVerify("01-scalars");
    },
    180_000,
  );
});
