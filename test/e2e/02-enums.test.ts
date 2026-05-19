import { describe, it } from "vitest";
import { runFixture, rustVerify } from "./run-fixture.js";

describe("e2e 02-enums", () => {
  it("generates enum output that compiles cleanly", async () => {
    await runFixture("02-enums");
    await rustVerify("02-enums");
  }, 180_000);
});
