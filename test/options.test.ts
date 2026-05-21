import { describe, it, expect } from "vitest";
import { isSkipRequested, parseGeneratorConfig } from "../src/options.js";

describe("isSkipRequested", () => {
  it("returns false for non-string values", () => {
    // Explicit undefined mirrors the call site in src/index.ts where
    // opts.generator.config.skip is absent — the exact code path.
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(isSkipRequested(undefined)).toBe(false);
    expect(isSkipRequested(null)).toBe(false);
    expect(isSkipRequested(0)).toBe(false);
    expect(isSkipRequested(true)).toBe(false);
    expect(isSkipRequested(["1"])).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isSkipRequested("")).toBe(false);
  });

  it.each(["0", "false", "False", "FALSE", "no", "NO", "off", " off "])(
    "returns false for falsy literal %j",
    (v) => {
      expect(isSkipRequested(v)).toBe(false);
    },
  );

  it.each(["1", "true", "True", "TRUE", "yes", "on", " 1 ", "anything"])(
    "returns true for truthy value %j",
    (v) => {
      expect(isSkipRequested(v)).toBe(true);
    },
  );
});

function makeOpts(
  overrides: Record<string, string> = {},
): Parameters<typeof parseGeneratorConfig>[0] {
  return {
    generator: {
      output: { value: "/tmp/out", fromEnvVar: null },
      config: overrides,
    },
    schemaPath: "",
    datamodel: "",
    datasources: [],
    otherGenerators: [],
    version: "",
    binaryPaths: undefined,
    dmmf: undefined as never,
  } as unknown as Parameters<typeof parseGeneratorConfig>[0];
}

describe("parseGeneratorConfig — engine field", () => {
  it("defaults engine to null when unset", () => {
    const cfg = parseGeneratorConfig(makeOpts());
    expect(cfg.engine).toBeNull();
  });

  it("accepts engine = 'sqlx-postgres'", () => {
    const cfg = parseGeneratorConfig(makeOpts({ engine: "sqlx-postgres" }));
    expect(cfg.engine).toBe("sqlx-postgres");
  });

  it("rejects unknown engine values", () => {
    expect(() =>
      parseGeneratorConfig(makeOpts({ engine: "not-an-engine" })),
    ).toThrow(/engine must be one of/);
  });
});

describe("parseGeneratorConfig — engine x outputLayout validation", () => {
  it("accepts engine = 'sqlx-postgres' + outputLayout = 'per-file'", () => {
    const cfg = parseGeneratorConfig(
      makeOpts({ engine: "sqlx-postgres", outputLayout: "per-file" }),
    );
    expect(cfg.engine).toBe("sqlx-postgres");
    expect(cfg.outputLayout).toBe("per-file");
  });

  it("accepts engine = 'sqlx-postgres' + outputLayout = 'per-model'", () => {
    const cfg = parseGeneratorConfig(
      makeOpts({ engine: "sqlx-postgres", outputLayout: "per-model" }),
    );
    expect(cfg.engine).toBe("sqlx-postgres");
    expect(cfg.outputLayout).toBe("per-model");
  });

  it("rejects engine = 'sqlx-postgres' + outputLayout = 'single'", () => {
    expect(() =>
      parseGeneratorConfig(
        makeOpts({ engine: "sqlx-postgres", outputLayout: "single" }),
      ),
    ).toThrow(
      /engine = "sqlx-postgres" is not yet supported with outputLayout = "single"/,
    );
  });

  it("allows outputLayout = 'single' when engine is unset", () => {
    const cfg = parseGeneratorConfig(makeOpts({ outputLayout: "single" }));
    expect(cfg.engine).toBeNull();
    expect(cfg.outputLayout).toBe("single");
  });
});

describe("parseGeneratorConfig — sqlx-sqlite engine", () => {
  it("accepts engine = 'sqlx-sqlite'", () => {
    const cfg = parseGeneratorConfig(makeOpts({ engine: "sqlx-sqlite" }));
    expect(cfg.engine).toBe("sqlx-sqlite");
  });

  it("rejects engine = 'sqlx-sqlite' with outputLayout = 'single'", () => {
    expect(() =>
      parseGeneratorConfig(
        makeOpts({ engine: "sqlx-sqlite", outputLayout: "single" }),
      ),
    ).toThrow(/sqlx-sqlite.*single|single.*sqlx-sqlite/);
  });
});
