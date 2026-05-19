import { RustWriter } from "../rust-writer.js";

export interface SharedFilterOpts {
  serde: boolean;
  vis: "pub" | "pub(crate)";
}

interface FilterSpec {
  family: string;
  ty: string;
  ops: readonly string[];
  hasMode?: boolean;
}

const SPECS: readonly FilterSpec[] = [
  { family: "String", ty: "String", ops: ["Lt", "Lte", "Gt", "Gte", "Contains", "StartsWith", "EndsWith"], hasMode: true },
  { family: "Int", ty: "i32", ops: ["Lt", "Lte", "Gt", "Gte"] },
  { family: "BigInt", ty: "i64", ops: ["Lt", "Lte", "Gt", "Gte"] },
  { family: "Float", ty: "f64", ops: ["Lt", "Lte", "Gt", "Gte"] },
  { family: "Decimal", ty: "rust_decimal::Decimal", ops: ["Lt", "Lte", "Gt", "Gte"] },
  { family: "DateTime", ty: "chrono::DateTime<chrono::Utc>", ops: ["Lt", "Lte", "Gt", "Gte"] },
  { family: "Uuid", ty: "uuid::Uuid", ops: [], hasMode: true },
  { family: "Bytes", ty: "Vec<u8>", ops: [] },
  { family: "Bool", ty: "bool", ops: [] },
  { family: "Json", ty: "serde_json::Value", ops: [] },
];

export function emitSharedScalarFilters(opts: SharedFilterOpts): string {
  const w = new RustWriter();
  for (const s of SPECS) {
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
