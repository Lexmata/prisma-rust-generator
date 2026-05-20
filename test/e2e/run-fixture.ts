import { execFile } from "node:child_process";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import internals from "@prisma/internals";
const { getDMMF } = internals as { getDMMF: typeof import("@prisma/internals").getDMMF };
import { buildFileMap } from "../../src/ir/file-map.js";
import { buildIR } from "../../src/ir/build.js";
import { emitPerFile } from "../../src/layout/per-file.js";
import type { GeneratorConfig } from "../../src/types.js";

const exec = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runFixture(
  name: string,
  cfg: Partial<GeneratorConfig> = {},
): Promise<void> {
  const fixtureDir = resolve(__dirname, "..", "fixtures", name);
  const outDir = resolve(__dirname, "..", "compile", name, "src");
  const single = join(fixtureDir, "schema.prisma");
  let schemaPath: string;
  let schema: string;
  try {
    schema = await readFile(single, "utf8");
    schemaPath = single;
  } catch {
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(fixtureDir))
      .filter((f) => f.endsWith(".prisma"))
      .toSorted();
    schema = (
      await Promise.all(files.map((f) => readFile(join(fixtureDir, f), "utf8")))
    ).join("\n\n");
    schemaPath = fixtureDir;
  }

  const dmmf = await getDMMF({ datamodel: schema });
  const fileMap = await buildFileMap(schemaPath);
  const fullCfg: GeneratorConfig = { ...DEFAULT_CFG, ...cfg, output: outDir };
  const ir = await buildIR(dmmf, fileMap, fullCfg);
  const files = emitPerFile(ir, fullCfg);

  await rm(outDir, { recursive: true, force: true });
  const written: string[] = [];
  for (const [path, content] of files) {
    const abs = join(outDir, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    written.push(abs);
  }

  await exec("rustfmt", ["--edition", fullCfg.edition, "--emit", "files", ...written]);
}

export async function rustVerify(name: string): Promise<void> {
  const dir = resolve(__dirname, "..", "compile", name);
  const big = { cwd: dir, maxBuffer: 256 * 1024 * 1024 };
  await exec("cargo", ["fmt", "--all", "--", "--check"], big);
  await exec("cargo", ["clippy", "--all-targets", "--", "-D", "warnings"], big);
  await exec("cargo", ["check", "--all-targets"], big);
}

const DEFAULT_CFG: GeneratorConfig = {
  output: "",
  outputLayout: "per-file",
  moduleName: null,
  moduleVisibility: "pub",
  dateTimeCrate: "chrono",
  decimalCrate: "rust_decimal",
  uuidFromDbUuid: true,
  bytesCrate: "std",
  jsonCrate: "serde_json",
  serde: true,
  extraDerives: [],
  edition: "2021",
  runRustfmt: false,
  requireRustfmt: false,
  rustfmtBinary: "rustfmt",
  clippyAllowList: ["clippy::upper_case_acronyms", "dead_code"],
  concurrency: 1,
  rustfmtShardSize: 16,
  filePreamble: "",
};
