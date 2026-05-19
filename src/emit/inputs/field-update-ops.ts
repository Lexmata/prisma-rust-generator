import { RustWriter } from "../rust-writer.js";

interface OpSpec {
  family: string;
  ty: string;
  numeric: boolean;
}

const SPECS: readonly OpSpec[] = [
  { family: "String", ty: "String", numeric: false },
  { family: "Int", ty: "i32", numeric: true },
  { family: "BigInt", ty: "i64", numeric: true },
  { family: "Float", ty: "f64", numeric: true },
  { family: "Decimal", ty: "rust_decimal::Decimal", numeric: true },
  { family: "Bool", ty: "bool", numeric: false },
  { family: "DateTime", ty: "chrono::DateTime<chrono::Utc>", numeric: false },
  { family: "Uuid", ty: "uuid::Uuid", numeric: false },
  { family: "Bytes", ty: "Vec<u8>", numeric: false },
  { family: "Json", ty: "serde_json::Value", numeric: false },
];

export function emitFieldUpdateOps(opts: {
  serde: boolean;
  vis: "pub" | "pub(crate)";
}): string {
  const w = new RustWriter();
  for (const s of SPECS) {
    emitStruct(w, s, false, opts);
    emitStruct(w, s, true, opts);
    w.blank();
  }
  for (const s of SPECS) {
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
