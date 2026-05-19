import { RustWriter } from "../rust-writer.js";
import type { GeneratorConfig } from "../../types.js";

interface OpSpec {
  family: string;
  ty: string;
  numeric: boolean;
}

function buildSpecs(cfg: GeneratorConfig): readonly OpSpec[] {
  const datetime =
    cfg.dateTimeCrate === "time" ? "time::OffsetDateTime" : "chrono::DateTime<chrono::Utc>";
  const decimal =
    cfg.decimalCrate === "bigdecimal" ? "bigdecimal::BigDecimal" : "rust_decimal::Decimal";
  const bytes = cfg.bytesCrate === "bytes" ? "bytes::Bytes" : "Vec<u8>";
  const json = cfg.jsonCrate === "string" ? "String" : "serde_json::Value";
  return [
    { family: "String", ty: "String", numeric: false },
    { family: "Int", ty: "i32", numeric: true },
    { family: "BigInt", ty: "i64", numeric: true },
    { family: "Float", ty: "f64", numeric: true },
    { family: "Decimal", ty: decimal, numeric: true },
    { family: "Bool", ty: "bool", numeric: false },
    { family: "DateTime", ty: datetime, numeric: false },
    { family: "Uuid", ty: "uuid::Uuid", numeric: false },
    { family: "Bytes", ty: bytes, numeric: false },
    { family: "Json", ty: json, numeric: false },
  ];
}

export function emitFieldUpdateOps(opts: {
  serde: boolean;
  vis: "pub" | "pub(crate)";
  cfg: GeneratorConfig;
}): string {
  const w = new RustWriter();
  const specs = buildSpecs(opts.cfg);
  for (const s of specs) {
    emitStruct(w, s, false, opts);
    emitStruct(w, s, true, opts);
    w.blank();
  }
  for (const s of specs) {
    emitListStruct(w, s, opts);
    w.blank();
  }
  return w.toString();
}

function emitStruct(
  w: RustWriter,
  s: OpSpec,
  nullable: boolean,
  opts: { serde: boolean; vis: string },
): void {
  const name = `${nullable ? "Nullable" : ""}${s.family}FieldUpdateOperationsInput`;
  const ty = nullable ? `Option<${s.ty}>` : s.ty;
  const derives = ["Debug", "Clone", "Default", "PartialEq"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, name);
  w.field(`pub set`, `Option<${ty}>`);
  if (s.numeric) {
    for (const op of ["increment", "decrement", "multiply", "divide"]) {
      w.field(`pub ${op}`, `Option<${s.ty}>`);
    }
  }
  w.close();
}

function emitListStruct(
  w: RustWriter,
  s: OpSpec,
  opts: { serde: boolean; vis: string },
): void {
  const name = `${s.family}ListFieldUpdateOperationsInput`;
  const derives = ["Debug", "Clone", "Default", "PartialEq"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, name);
  w.field(`pub set`, `Option<Vec<${s.ty}>>`);
  w.field(`pub push`, `Option<crate::shared::filters::OneOrMany<${s.ty}>>`);
  w.close();
}
