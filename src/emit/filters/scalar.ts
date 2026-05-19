import { RustWriter } from "../rust-writer.js";
import type { GeneratorConfig } from "../../types.js";

export interface SharedFilterOpts {
  serde: boolean;
  vis: "pub" | "pub(crate)";
  cfg: GeneratorConfig;
}

interface FilterSpec {
  family: string;
  ty: string;
  ops: readonly string[];
  hasMode?: boolean;
}

function buildSpecs(cfg: GeneratorConfig): readonly FilterSpec[] {
  const datetime =
    cfg.dateTimeCrate === "time" ? "time::OffsetDateTime" : "chrono::DateTime<chrono::Utc>";
  const decimal =
    cfg.decimalCrate === "bigdecimal" ? "bigdecimal::BigDecimal" : "rust_decimal::Decimal";
  const bytes = cfg.bytesCrate === "bytes" ? "bytes::Bytes" : "Vec<u8>";
  const json = cfg.jsonCrate === "string" ? "String" : "serde_json::Value";
  return [
    {
      family: "String",
      ty: "String",
      ops: ["Lt", "Lte", "Gt", "Gte", "Contains", "StartsWith", "EndsWith"],
      hasMode: true,
    },
    { family: "Int", ty: "i32", ops: ["Lt", "Lte", "Gt", "Gte"] },
    { family: "BigInt", ty: "i64", ops: ["Lt", "Lte", "Gt", "Gte"] },
    { family: "Float", ty: "f64", ops: ["Lt", "Lte", "Gt", "Gte"] },
    { family: "Decimal", ty: decimal, ops: ["Lt", "Lte", "Gt", "Gte"] },
    { family: "DateTime", ty: datetime, ops: ["Lt", "Lte", "Gt", "Gte"] },
    { family: "Uuid", ty: "uuid::Uuid", ops: [], hasMode: true },
    { family: "Bytes", ty: bytes, ops: [] },
    { family: "Bool", ty: "bool", ops: [] },
    { family: "Json", ty: json, ops: [] },
  ];
}

export function emitSharedScalarFilters(opts: SharedFilterOpts): string {
  const w = new RustWriter();
  const specs = buildSpecs(opts.cfg);
  for (const s of specs) {
    emitOne(w, s, false, opts);
    emitOne(w, s, true, opts);
    w.blank();
  }
  return w.toString();
}

function emitOne(w: RustWriter, s: FilterSpec, nullable: boolean, opts: SharedFilterOpts): void {
  const name = nullable ? `${s.family}NullableFilter` : `${s.family}Filter`;
  const derives = ["Debug", "Clone", "PartialEq"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openEnum(opts.vis, name);
  w.variant(nullable ? `Equals(Option<${s.ty}>)` : `Equals(${s.ty})`);
  w.variant(`In(Vec<${s.ty}>)`);
  w.variant(`NotIn(Vec<${s.ty}>)`);
  if (nullable) w.variant(`IsNull(bool)`);
  for (const op of s.ops) w.variant(`${op}(${s.ty})`);
  w.variant(`Not(Box<${name}>)`);
  if (s.hasMode) w.variant(`Mode(QueryMode)`);
  w.close();
}
