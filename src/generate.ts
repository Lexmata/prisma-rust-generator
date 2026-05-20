import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GeneratorOptions } from "@prisma/generator-helper";
import internals from "@prisma/internals";
const { getDMMF } = internals as { getDMMF: typeof import("@prisma/internals").getDMMF };
import { parseGeneratorConfig } from "./options.js";
import { buildFileMap } from "./ir/file-map.js";
import { buildIR } from "./ir/build.js";
import { emitPerFile } from "./layout/per-file.js";
import { emitPerModel } from "./layout/per-model.js";
import { emitSingle } from "./layout/single.js";
import { runRustfmt, RustfmtUnavailableError } from "./fmt.js";
import { pruneStaleFiles } from "./prune.js";
import { mapInPool } from "./parallel/pool.js";

export async function generate(opts: GeneratorOptions): Promise<void> {
  const cfg = parseGeneratorConfig(opts);

  const dmmf =
    opts.dmmf ?? (await getDMMF({ datamodel: opts.datamodel }));
  const fileMap = await buildFileMap(opts.schemaPath);
  const ir = await buildIR(dmmf, fileMap, cfg);

  const files =
    cfg.outputLayout === "per-file"
      ? emitPerFile(ir, cfg)
      : (cfg.outputLayout === "per-model"
        ? emitPerModel(ir, cfg)
        : emitSingle(ir, cfg));

  const entries = [...files.entries()].toSorted((a, b) => a[0].localeCompare(b[0]));
  const writtenPaths = await mapInPool(entries, cfg.concurrency, async ([rel, content]) => {
    const abs = join(cfg.output, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return abs;
  });

  if (cfg.runRustfmt) {
    try {
      await runRustfmt({
        files: writtenPaths,
        binary: cfg.rustfmtBinary,
        edition: cfg.edition,
        shardSize: cfg.rustfmtShardSize,
      });
    } catch (error) {
      if (error instanceof RustfmtUnavailableError && !cfg.requireRustfmt) {
        // soft-fail when not required
      } else {
        throw error;
      }
    }
  }

  await pruneStaleFiles(cfg.output, new Set(files.keys()));
}
