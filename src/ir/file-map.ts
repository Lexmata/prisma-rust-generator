import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

const DECL_RE = /^\s*(model|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm;

// File stems may contain characters valid in filenames but not in Rust module
// idents (hyphens, leading underscores, leading digits). Normalize to a
// snake_case-ish form, prefixing with `m_` when the result would start with a
// digit (Rust idents can't begin with one).
function normalizeStem(stem: string): string {
  const cleaned = stem.replace(/^_+/, "").replaceAll(/[^A-Za-z0-9_]+/g, "_").toLowerCase();
  return /^[0-9]/.test(cleaned) ? `m_${cleaned}` : cleaned;
}

export async function buildFileMap(schemaPath: string): Promise<Map<string, string>> {
  const files = await collectPrismaFiles(schemaPath);
  const out = new Map<string, string>();
  for (const file of files) {
    const stem = normalizeStem(basename(file, extname(file)));
    const text = await readFile(file, "utf8");
    for (const m of text.matchAll(DECL_RE)) {
      const name = m[2]!;
      if (out.has(name)) {
        throw new Error(
          `Duplicate Prisma declaration ${name}: ${out.get(name)} and ${stem}`,
        );
      }
      out.set(name, stem);
    }
  }
  return out;
}

async function collectPrismaFiles(p: string): Promise<string[]> {
  const abs = resolve(p);
  const s = await stat(abs);
  if (s.isFile()) return [abs];
  const entries = await readdir(abs, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = join(abs, e.name);
    if (e.isDirectory()) files.push(...(await collectPrismaFiles(full)));
    else if (e.isFile() && full.endsWith(".prisma")) files.push(full);
  }
  return files.toSorted();
}
