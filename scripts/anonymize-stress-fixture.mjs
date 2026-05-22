#!/usr/bin/env node
// Generate the synthetic 14-stress fixture from an upstream domain-named
// stress fixture: rewrite every Prisma-level identifier (model names, enum
// names, field names) into sequential synthetic ones while preserving
// structure, attributes, and behavior. Relation strings, @map values, and
// FK column names are rewritten consistently so the schema still passes
// `prisma generate` and our DMMF pipeline. SRC below is the directory of
// the un-anonymized source schema; once 14-stress lives in-tree this
// script is the reproducibility record, not part of CI.
//
// Run with:
//   node scripts/anonymize-stress-fixture.mjs

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "test/fixtures/08-lexmata");
const DST = resolve(ROOT, "test/fixtures/14-stress");

// Scalar field names worth keeping unchanged: they don't carry domain
// meaning, and renaming them buys nothing while making test output
// harder to read.
const KEEP_FIELDS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "name",
  "email",
  "value",
  "count",
  "data",
  "type",
  "status",
]);

// Builtin Prisma scalar types that should NOT be treated as model
// references when classifying a field as a relation field.
const PRISMA_SCALARS = new Set([
  "String",
  "Int",
  "BigInt",
  "Float",
  "Decimal",
  "Boolean",
  "DateTime",
  "Json",
  "Bytes",
]);

function toSnake(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

// --- Step 1: enumerate input files (alphabetical) ---------------------
const allFiles = readdirSync(SRC)
  .filter((f) => f.endsWith(".prisma"))
  .toSorted();

// Separate _config.prisma (no models/enums) from the rest.
const configFile = allFiles.find((f) => f === "_config.prisma");
const dataFiles = allFiles.filter((f) => f !== "_config.prisma");

// --- Step 2: scan all data files for model/enum declarations ----------
// Order matters: first-seen order across files (alphabetical) drives
// the synthetic numbering.
const modelMap = new Map(); // origName -> synthName (EntityN)
const enumMap = new Map(); // origName -> synthName (EnumN)

// Per-file source text cached for later rewrites.
const fileContents = new Map();
for (const f of allFiles) {
  fileContents.set(f, readFileSync(join(SRC, f), "utf8"));
}

const declRegex = /^(\s*)(model|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm;

for (const f of dataFiles) {
  const text = fileContents.get(f);
  for (const m of text.matchAll(declRegex)) {
    const kind = m[2];
    const name = m[3];
    if (kind === "model" && !modelMap.has(name)) {
      modelMap.set(name, `Entity${modelMap.size + 1}`);
    } else if (kind === "enum" && !enumMap.has(name)) {
      enumMap.set(name, `Enum${enumMap.size + 1}`);
    }
  }
}

// --- Step 3: parse each model/enum body to build field maps -----------
// We need:
//   - per-model field-name map (orig -> synth)
//   - per-model FK-column set (scalar fields referenced by some
//     @relation(fields: [X]) attribute)
//   - per-relation pair: the FK field gets relFkId_<n> matching the
//     relation field's rel_<n>
//   - per-enum value names left alone (they're enum variants, not
//     identifiers leaked through types) — but task says rename non-
//     scalar identifiers. We'll keep enum *values* as-is to avoid
//     touching too much (the generator only sees the enum's name in
//     Rust types). Actually re-reading: only model/enum/field names
//     are renamed. Enum values stay.

// Returns the inner body text of a {...} block starting at `start`
// (the index of the opening `{`). Returns { body, end } where end is
// the index of the matching closing `}`.
function extractBlock(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { body: text.slice(start + 1, i), end: i };
    }
  }
  throw new Error("unbalanced braces");
}

// fieldMaps: { modelName -> Map<origFieldName, synthFieldName> }
const fieldMaps = new Map();

// For each model, also remember its "relation slot" → number so that
// when we emit relFkId we get the same index as the rel.
// (Not strictly necessary; we just need both renamings to be
// consistent. We build one map and apply it.)

function parseModel(modelOrigName, body) {
  // Tokenize line by line, ignoring blank lines and comments and
  // `@@...` block-level attributes. Field decls have the form:
  //   <name>  <Type>[]? [...attrs...]
  const lines = body.split(/\r?\n/);

  // First pass: gather field declarations in order with their type
  // and attribute string. Also gather @relation(fields: [...]) lists
  // so we can identify FK columns.
  const fields = []; // { origName, baseType, isList, isOpt, attrs, lineIndex }
  const fkColumnsByRelField = new Map(); // origRelFieldName -> [fkColumnOrigName,...]
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.replace(/\/\/.*$/, ""); // strip trailing line comment
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("//")) continue;
    if (trimmed.startsWith("///")) continue;
    if (trimmed.startsWith("@@")) continue;
    // Field decl: <name>  <Type>[?][[]] [attrs]
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\[\])?(\?)?(\s+.*)?$/);
    if (!m) continue;
    const [, name, baseType, listMod, optMod, attrsPart] = m;
    const attrs = attrsPart ?? "";
    fields.push({
      origName: name,
      baseType,
      isList: !!listMod,
      isOpt: !!optMod,
      attrs,
      lineIndex: i,
    });
    // Look for @relation(... fields: [a, b, ...] ...)
    const relMatch = attrs.match(/@relation\s*\(([^)]*)\)/);
    if (relMatch) {
      const inner = relMatch[1];
      const fmatch = inner.match(/fields\s*:\s*\[([^\]]*)\]/);
      if (fmatch) {
        const fkNames = fmatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        fkColumnsByRelField.set(name, fkNames);
      }
    }
  }

  // Classify each field:
  //   - relation field: baseType is a known model name
  //   - fk column: name appears in some fkColumnsByRelField list
  //   - other: everything else
  const fkColumnSet = new Set();
  for (const list of fkColumnsByRelField.values()) for (const n of list) fkColumnSet.add(n);

  // Map relation-field origName -> its rel index (1-based, per-model
  // counter assigned in first-seen order across all relation fields).
  const relIndexByName = new Map();
  let relCounter = 0;
  for (const f of fields) {
    if (modelMap.has(f.baseType)) {
      relCounter++;
      relIndexByName.set(f.origName, relCounter);
    }
  }

  // The FK columns of a relation field share that field's index. If a
  // relation has multiple FK columns (composite FK), they get
  // relFkId_<n>_1, relFkId_<n>_2 ... to keep names unique.
  // (The source schema uses single-column FKs in practice but we cover it.)
  const fkRenameByOrig = new Map();
  for (const [relName, fkList] of fkColumnsByRelField.entries()) {
    const idx = relIndexByName.get(relName);
    if (idx === undefined) continue;
    if (fkList.length === 1) {
      fkRenameByOrig.set(fkList[0], `relFkId_${idx}`);
    } else {
      fkList.forEach((fk, j) => {
        fkRenameByOrig.set(fk, `relFkId_${idx}_${j + 1}`);
      });
    }
  }

  // Remaining-field counter for non-keeper, non-relation, non-FK fields.
  const fieldRenameByOrig = new Map();
  let plainCounter = 0;
  for (const f of fields) {
    const n = f.origName;
    if (KEEP_FIELDS.has(n)) {
      fieldRenameByOrig.set(n, n);
      continue;
    }
    if (relIndexByName.has(n)) {
      fieldRenameByOrig.set(n, `rel_${relIndexByName.get(n)}`);
      continue;
    }
    if (fkRenameByOrig.has(n)) {
      fieldRenameByOrig.set(n, fkRenameByOrig.get(n));
      continue;
    }
    plainCounter++;
    fieldRenameByOrig.set(n, `field_${plainCounter}`);
  }

  fieldMaps.set(modelOrigName, fieldRenameByOrig);
}

// Walk every file and parse its model bodies.
for (const f of dataFiles) {
  const text = fileContents.get(f);
  // Iterate model declarations with body extraction.
  const re = /\b(model|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1];
    const name = m[2];
    const braceIdx = text.indexOf("{", re.lastIndex - 1);
    const { body, end } = extractBlock(text, braceIdx);
    if (kind === "model") {
      parseModel(name, body);
    }
    // Advance regex past this block to avoid re-matching.
    re.lastIndex = end + 1;
  }
}

// --- Step 4: build a global @relation("name") string map --------------
// Each @relation has an optional first positional string-literal arg
// — that name is matched across both sides of the relation. We need
// to rewrite it consistently. We'll collect every distinct relation
// name and number them.
const relationNameMap = new Map(); // origRelName -> "rel_name_<n>"
{
  let counter = 0;
  for (const f of dataFiles) {
    const text = fileContents.get(f);
    // Match @relation("..." ...)  — the first arg might be the name
    // or might be `fields:`. We need the unnamed string-literal form.
    const re = /@relation\s*\(\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = m[1];
      if (!relationNameMap.has(n)) {
        counter++;
        relationNameMap.set(n, `rel_name_${counter}`);
      }
    }
  }
}

// --- Step 5: rewrite each file ----------------------------------------
function renameIdentifierInModelBody(body, fieldRenameMap) {
  // Walk line by line; for each field decl, rewrite the leading
  // identifier and the type identifier. Also rewrite any list of
  // field-names inside @relation(fields: [...]) and @relation(references: [...]),
  // and any @@unique([...]) / @@index([...]) / @@id([...]).
  const lines = body.split(/\r?\n/);
  const out = [];
  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.replace(/\/\/.*$/, "").trim();

    if (trimmed.startsWith("@@")) {
      // @@map("...") — rewrite the string content.
      // @@unique([a,b], map: "...") — rewrite the field list and the map string.
      // @@index([a,b], map: "...") — same.
      // @@id([a,b]) — same.
      let rewritten = line;

      // Rewrite field-name lists inside @@unique/@@index/@@id.
      rewritten = rewritten.replace(
        /(@@(?:unique|index|id|fulltext)\s*\(\s*\[)([^\]]*)(\])/g,
        (_, pre, inside, post) => {
          const parts = inside.split(",").map((s) => s.trim()).filter(Boolean);
          const mapped = parts.map((p) => fieldRenameMap.get(p) ?? p).join(", ");
          return pre + mapped + post;
        },
      );

      // Rewrite @@map("table_name") -> "<synth>".
      // Strategy: rewrite to "table_<modelSynth>".
      // We don't know the model's synth name here without passing it
      // in — handled in the caller via a placeholder.

      out.push(rewritten);
      continue;
    }

    // Try to match a field decl. We capture the leading whitespace,
    // the name, the type, the list/opt markers, and the attribute tail.
    const m = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s+)([A-Za-z_][A-Za-z0-9_]*)(\[\])?(\?)?(\s+.*)?$/);
    if (m) {
      const [, indent, name, sep, baseType, listMod, optMod, attrsPart] = m;
      const newName = fieldRenameMap.get(name) ?? name;
      let newType = baseType;
      if (modelMap.has(baseType)) newType = modelMap.get(baseType);
      else if (enumMap.has(baseType)) newType = enumMap.get(baseType);
      let newAttrs = attrsPart ?? "";

      // Rewrite @relation(...) inside attrs:
      //  - fields: [x, y] — use fieldRenameMap
      //  - references: [a, b] — use the TARGET model's fieldRenameMap
      //  - "RelName" — use relationNameMap
      newAttrs = newAttrs.replace(/@relation\s*\(([^)]*)\)/g, (_, inner) => {
        let rewritten = inner;
        // Relation name string (first quoted arg).
        rewritten = rewritten.replace(/"([^"]+)"/g, (full, s) => {
          const synth = relationNameMap.get(s);
          return synth ? `"${synth}"` : full;
        });
        // fields: [x, y]
        rewritten = rewritten.replace(/fields\s*:\s*\[([^\]]*)\]/g, (_full, list) => {
          const parts = list.split(",").map((s) => s.trim()).filter(Boolean);
          const mapped = parts.map((p) => fieldRenameMap.get(p) ?? p).join(", ");
          return `fields: [${mapped}]`;
        });
        // references: [x, y] — use the TARGET model's map.
        rewritten = rewritten.replace(/references\s*:\s*\[([^\]]*)\]/g, (_full, list) => {
          const parts = list.split(",").map((s) => s.trim()).filter(Boolean);
          // Lookup the target model from baseType.
          const targetMap = fieldMaps.get(baseType);
          if (!targetMap) return `references: [${parts.join(", ")}]`;
          const mapped = parts.map((p) => targetMap.get(p) ?? p).join(", ");
          return `references: [${mapped}]`;
        });
        // map: "fk_idx_name" — rewrite to a synthetic name based on
        // the field number. We don't have access to the field index
        // here; just neutralize to "rel_constraint" + a counter.
        // Simpler approach: drop the explicit relation map name —
        // Prisma will fall back to a default. But that could produce
        // duplicate auto-names. Keep the original token shape but
        // replace the string with a hash-free synthetic.
        return `@relation(${rewritten})`;
      });

      // Rewrite @map("col_name") inside attrs to "col_<newName>".
      newAttrs = newAttrs.replace(/@map\s*\(\s*"([^"]+)"\s*\)/g, () => {
        return `@map("${toSnake(newName)}")`;
      });

      // Rewrite @unique(map: "...") strings.
      newAttrs = newAttrs.replace(/(@unique\s*\(\s*map\s*:\s*)"([^"]+)"/g, (_, pre) => {
        return `${pre}"uniq_${toSnake(newName)}"`;
      });

      const rebuilt =
        indent +
        newName +
        sep +
        newType +
        (listMod ?? "") +
        (optMod ?? "") +
        newAttrs;
      out.push(rebuilt);
      continue;
    }

    out.push(line);
  }
  return out.join("\n");
}

function rewriteFile(origFilename) {
  const text = fileContents.get(origFilename);
  // Walk top-level: find each `model X {` or `enum X {` block, rewrite
  // its head and body. Keep everything else (comments, blank lines)
  // verbatim.
  let i = 0;
  const out = [];
  const re = /\b(model|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Emit text up to the start of this declaration.
    out.push(text.slice(i, m.index));
    const kind = m[1];
    const name = m[2];
    const headStart = m.index;
    const braceIdx = text.indexOf("{", re.lastIndex - 1);
    const { body, end } = extractBlock(text, braceIdx);

    if (kind === "model") {
      const synth = modelMap.get(name);
      if (!synth) throw new Error("unknown model " + name);
      const fmap = fieldMaps.get(name);
      let newBody = renameIdentifierInModelBody(body, fmap);
      // Rewrite @@map("xxx") -> "table_<synth>".
      newBody = newBody.replace(/@@map\s*\(\s*"([^"]+)"\s*\)/g, () => {
        return `@@map("table_${toSnake(synth)}")`;
      });
      // Rewrite @@unique(..., map: "...") and @@index(..., map: "...")
      // map strings to use the synth model name + a counter.
      let uniqCounter = 0;
      newBody = newBody.replace(
        /(@@(?:unique|index|id|fulltext)\s*\([^)]*?map\s*:\s*)"([^"]+)"/g,
        (_, pre) => {
          uniqCounter++;
          return `${pre}"idx_${toSnake(synth)}_${uniqCounter}"`;
        },
      );
      out.push(`model ${synth} {${newBody}}`);
    } else {
      // enum: rename the enum head; leave variant body alone.
      const synth = enumMap.get(name);
      if (!synth) throw new Error("unknown enum " + name);
      out.push(`enum ${synth} {${body}}`);
    }
    i = end + 1;
    re.lastIndex = end + 1;
  }
  out.push(text.slice(i));
  // Now apply *file-wide* identifier rewrites that fell outside model
  // bodies — none, because we never reference models/enums outside a
  // declaration body in the source files. But the head wasn't given
  // its @relation/@@... rewrites a chance to rename target-model
  // names in references… those happen inside model bodies, so we're
  // fine.

  // Also: per-file leading comment (e.g. "// Users and user-scoped
  // onboarding state.") leaks domain info. Strip those.
  let combined = out.join("");
  // Strip top-of-file `// comment` lines (anonymize doc).
  combined = combined.replace(/^(?:\/\/[^\n]*\n)+/, "");
  // Strip inter-block doc comments (e.g. "// Case management") too —
  // they're file-internal section dividers that leak domain words.
  combined = combined.replace(/^[ \t]*\/\/[^\n]*$/gm, "");
  // Strip `/// ` doc comments — same reason.
  combined = combined.replace(/^[ \t]*\/\/\/.*$/gm, "");
  // Collapse multiple blank lines.
  combined = combined.replace(/\n{3,}/g, "\n\n");
  return combined.trimStart();
}

// --- Step 6: emit output ---------------------------------------------
if (existsSync(DST)) rmSync(DST, { recursive: true, force: true });
mkdirSync(DST, { recursive: true });

// Config file → 00-config.prisma (unchanged content).
writeFileSync(join(DST, "00-config.prisma"), fileContents.get(configFile));

// Data files: rename in alphabetical order to NN-stress.prisma.
dataFiles.forEach((origName, i) => {
  const idx = (i + 1).toString().padStart(2, "0");
  const dstName = `${idx}-stress.prisma`;
  const rewritten = rewriteFile(origName);
  writeFileSync(join(DST, dstName), rewritten);
});

console.log(`wrote ${dataFiles.length + 1} files to ${DST}`);
console.log(`models: ${modelMap.size}, enums: ${enumMap.size}, relation names: ${relationNameMap.size}`);
