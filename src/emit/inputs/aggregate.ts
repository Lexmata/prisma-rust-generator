import { RustWriter } from "../rust-writer.js";
import type { FieldIR, ModelIR } from "../../ir/types.js";

export interface AggregateOpts {
  serde: boolean;
  vis: "pub" | "pub(crate)";
}

const NUMERIC_RUSTS = new Set([
  "i16",
  "i32",
  "i64",
  "u32",
  "f32",
  "f64",
  "rust_decimal::Decimal",
  "bigdecimal::BigDecimal",
]);

const NON_ORDERABLE_RUSTS = new Set(["serde_json::Value"]);

export function emitAggregateInputs(m: ModelIR, opts: AggregateOpts): string {
  const w = new RustWriter();
  emitCount(w, m, opts);
  w.blank();
  emitNumericAggregate(w, m, opts, "Avg");
  w.blank();
  emitNumericAggregate(w, m, opts, "Sum");
  w.blank();
  emitOrderableAggregate(w, m, opts, "Min");
  w.blank();
  emitOrderableAggregate(w, m, opts, "Max");
  w.blank();
  emitOrderByWithAggregation(w, m, opts);
  return w.toString();
}

function openInput(w: RustWriter, opts: AggregateOpts, name: string): void {
  const derives = ["Debug", "Clone", "Default", "PartialEq", "Eq", "Hash"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, name);
}

function emitCount(w: RustWriter, m: ModelIR, opts: AggregateOpts): void {
  openInput(w, opts, `${m.name}CountAggregateInput`);
  for (const f of m.scalarFields) {
    w.field(`pub ${f.rustName}`, `Option<bool>`);
  }
  if (opts.serde) w.line(`#[serde(rename = "_all")]`);
  w.field(`pub aggregate_all`, `Option<bool>`);
  w.close();
}

function emitNumericAggregate(
  w: RustWriter,
  m: ModelIR,
  opts: AggregateOpts,
  kind: "Avg" | "Sum",
): void {
  openInput(w, opts, `${m.name}${kind}AggregateInput`);
  for (const f of m.scalarFields) {
    if (!isNumeric(f)) continue;
    w.field(`pub ${f.rustName}`, `Option<bool>`);
  }
  w.close();
}

function emitOrderableAggregate(
  w: RustWriter,
  m: ModelIR,
  opts: AggregateOpts,
  kind: "Min" | "Max",
): void {
  openInput(w, opts, `${m.name}${kind}AggregateInput`);
  for (const f of m.scalarFields) {
    if (!isOrderable(f)) continue;
    w.field(`pub ${f.rustName}`, `Option<bool>`);
  }
  w.close();
}

function emitOrderByWithAggregation(
  w: RustWriter,
  m: ModelIR,
  opts: AggregateOpts,
): void {
  openInput(w, opts, `${m.name}OrderByWithAggregationInput`);
  for (const f of m.scalarFields) {
    w.field(`pub ${f.rustName}`, `Option<crate::shared::filters::SortOrder>`);
  }
  if (opts.serde) w.line(`#[serde(rename = "_count")]`);
  w.field(`pub aggregate_count`, `Option<${m.name}CountAggregateInput>`);
  if (opts.serde) w.line(`#[serde(rename = "_avg")]`);
  w.field(`pub aggregate_avg`, `Option<${m.name}AvgAggregateInput>`);
  if (opts.serde) w.line(`#[serde(rename = "_sum")]`);
  w.field(`pub aggregate_sum`, `Option<${m.name}SumAggregateInput>`);
  if (opts.serde) w.line(`#[serde(rename = "_min")]`);
  w.field(`pub aggregate_min`, `Option<${m.name}MinAggregateInput>`);
  if (opts.serde) w.line(`#[serde(rename = "_max")]`);
  w.field(`pub aggregate_max`, `Option<${m.name}MaxAggregateInput>`);
  w.close();
}

function isNumeric(f: FieldIR): boolean {
  return f.type.kind === "scalar" && NUMERIC_RUSTS.has(f.type.rust);
}

function isOrderable(f: FieldIR): boolean {
  if (f.type.kind !== "scalar") return false;
  return !NON_ORDERABLE_RUSTS.has(f.type.rust) && f.type.rust !== "Vec<u8>";
}
