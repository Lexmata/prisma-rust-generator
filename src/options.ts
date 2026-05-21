import type { GeneratorOptions } from "@prisma/generator-helper";
import * as os from "node:os";
import type { GeneratorConfig } from "./types.js";

export function parseGeneratorConfig(opts: GeneratorOptions): GeneratorConfig {
  const generator = opts.generator;
  if (!generator?.output?.value) {
    throw new Error("generator output is required");
  }
  const raw = generator.config as Record<string, string | string[] | undefined>;

  const layout = pickEnum(
    raw.outputLayout,
    ["per-file", "per-model", "single"] as const,
    "per-file",
    "outputLayout",
  );
  const vis = pickEnum(
    raw.moduleVisibility,
    ["pub", "pub(crate)"] as const,
    "pub",
    "moduleVisibility",
  );
  const dt = pickEnum(
    raw.dateTimeCrate,
    ["chrono", "time"] as const,
    "chrono",
    "dateTimeCrate",
  );
  const dec = pickEnum(
    raw.decimalCrate,
    ["rust_decimal", "bigdecimal"] as const,
    "rust_decimal",
    "decimalCrate",
  );
  const bytes = pickEnum(raw.bytesCrate, ["std", "bytes"] as const, "std", "bytesCrate");
  const json = pickEnum(
    raw.jsonCrate,
    ["serde_json", "string"] as const,
    "serde_json",
    "jsonCrate",
  );
  const edition = pickEnum(raw.edition, ["2021", "2024"] as const, "2021", "edition");
  const engine =
    raw.engine == null
      ? null
      : pickEnum(raw.engine, ["sqlx-postgres"] as const, "sqlx-postgres", "engine");

  if (engine !== null && layout === "single") {
    throw new Error(
      `engine = "${engine}" is not yet supported with outputLayout = "single". Use "per-file" or "per-model".`,
    );
  }

  return {
    output: generator.output.value,
    outputLayout: layout,
    moduleName: pickString(raw.moduleName, null),
    moduleVisibility: vis,
    dateTimeCrate: dt,
    decimalCrate: dec,
    uuidFromDbUuid: pickBool(raw.uuidFromDbUuid, true),
    bytesCrate: bytes,
    jsonCrate: json,
    serde: pickBool(raw.serde, true),
    extraDerives: pickList(raw.extraDerives, []),
    edition,
    runRustfmt: pickBool(raw.runRustfmt, true),
    requireRustfmt: pickBool(raw.requireRustfmt, true),
    rustfmtBinary: pickString(raw.rustfmtBinary, "rustfmt") ?? "rustfmt",
    clippyAllowList: pickList(raw.clippyAllowList, [
      "clippy::upper_case_acronyms",
      "dead_code",
    ]),
    concurrency: pickInt(raw.concurrency, Math.min(os.cpus().length, 8)),
    rustfmtShardSize: pickInt(raw.rustfmtShardSize, 16),
    filePreamble: pickString(raw.filePreamble, "") ?? "",
    engine,
  };
}

function pickEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  def: T,
  name: string,
): T {
  if (v == null) return def;
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new Error(
      `${name} must be one of ${allowed.join(", ")}; got ${String(v)}`,
    );
  }
  return v as T;
}
function pickBool(v: unknown, def: boolean): boolean {
  if (v == null) return def;
  if (v === "true") return true;
  if (v === "false") return false;
  if (typeof v === "boolean") return v;
  throw new Error(`expected boolean, got ${String(v)}`);
}
function pickInt(v: unknown, def: number): number {
  if (v == null) return def;
  const n = typeof v === "string" ? Number.parseInt(v, 10) : Number(v);
  if (!Number.isFinite(n)) throw new Error(`expected integer, got ${String(v)}`);
  return n;
}
function pickString(v: unknown, def: string | null): string | null {
  if (v == null) return def;
  return typeof v === "string" ? v : String(v);
}
function pickList(v: unknown, def: readonly string[]): readonly string[] {
  if (v == null) return def;
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}

// Returns true when the `skip` generator-config value is set to a truthy
// string. Consumers wire this up in schema.prisma via Prisma's env()
// function — see README. Truthy = anything other than the empty string
// or a recognized falsy literal ("0", "false", "no", "off",
// case-insensitive). Common shapes (=1, =true, =yes) all trigger;
// =0/=false do not.
export function isSkipRequested(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "") return false;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return true;
}
