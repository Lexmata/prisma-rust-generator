import { RustWriter } from "../rust-writer.js";
import type { FieldIR, ModelIR, RelationIR } from "../../ir/types.js";
import type { ModuleResolver } from "../type-ref.js";

export interface WhereInputOpts {
  serde: boolean;
  vis: "pub" | "pub(crate)";
  moduleOf: ModuleResolver;
}

export function emitModelWhereInput(m: ModelIR, opts: WhereInputOpts): string {
  const w = new RustWriter();
  const derives = ["Debug", "Clone", "Default", "PartialEq"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, `${m.name}WhereInput`);

  for (const f of m.scalarFields) {
    w.field(`pub ${f.rustName}`, `Option<${scalarFilterRefFor(f)}>`);
  }
  for (const r of m.relations) {
    w.field(`pub ${r.rustName}`, `Option<${relationFilterFor(r, opts.moduleOf)}>`);
  }

  for (const [rust, prisma] of [
    ["and", "AND"],
    ["or", "OR"],
    ["not", "NOT"],
  ] as const) {
    if (opts.serde) w.line(`#[serde(rename = "${prisma}")]`);
    w.field(`pub ${rust}`, `Option<Vec<${m.name}WhereInput>>`);
  }
  w.close();
  return w.toString();
}

// Shared between WhereInput (this file) and ScalarWhereInput (scalar-where.ts).
// The two must stay in lock-step on filter naming, so they reference the same
// helper rather than duplicating the logic.
export function scalarFilterRefFor(f: FieldIR): string {
  if (f.type.kind === "enumRef") {
    const suffix = f.optional ? "NullableFilter" : "Filter";
    const mod = f.type.module ? `crate::${f.type.module}::` : `crate::`;
    return `${mod}${f.type.enumName}${suffix}`;
  }
  if (f.type.kind === "scalar") {
    return mapRustToFilterFamily(f.type.rust, f.optional);
  }
  return "()";
}

export function filterFamilyForRustType(rust: string): string {
  if (rust === "String") return "String";
  if (rust === "uuid::Uuid") return "Uuid";
  if (rust === "i32" || rust === "i16" || rust === "u32") return "Int";
  if (rust === "i64") return "BigInt";
  if (rust === "f32" || rust === "f64") return "Float";
  if (rust.startsWith("rust_decimal") || rust.startsWith("bigdecimal")) return "Decimal";
  if (rust === "bool") return "Bool";
  if (rust.startsWith("chrono::") || rust.startsWith("time::")) return "DateTime";
  if (rust === "serde_json::Value") return "Json";
  if (rust === "Vec<u8>" || rust === "bytes::Bytes") return "Bytes";
  return "String";
}

function mapRustToFilterFamily(rust: string, nullable: boolean): string {
  const suffix = nullable ? "NullableFilter" : "Filter";
  return `crate::shared::filters::${filterFamilyForRustType(rust)}${suffix}`;
}

function relationFilterFor(r: RelationIR, moduleOf: ModuleResolver): string {
  const mod = moduleOf(r.toModel);
  const prefix = mod ? `crate::${mod}::` : `crate::`;
  return r.cardinality === "one"
    ? `${prefix}${r.toModel}RelationFilter`
    : `${prefix}${r.toModel}ListRelationFilter`;
}
