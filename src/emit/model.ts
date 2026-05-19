import { RustWriter } from "./rust-writer.js";
import { renderRelationFieldType, renderScalarFieldType, type ModuleResolver } from "./type-ref.js";
import type { ModelIR } from "../ir/types.js";

export interface ModelEmitOptions {
  serde: boolean;
  vis: "pub" | "pub(crate)";
  eqEligible: boolean;
  moduleOf: ModuleResolver;
  extraDerives: readonly string[];
}

export function emitModel(m: ModelIR, opts: ModelEmitOptions): string {
  const w = new RustWriter();
  if (m.docs.length > 0) w.docComments(m.docs);

  const derives = ["Debug", "Clone", "PartialEq"];
  if (opts.eqEligible) derives.push("Eq");
  if (opts.serde) derives.push("Serialize", "Deserialize");
  for (const d of opts.extraDerives) {
    if (!derives.includes(d) && safeDerive(d, opts.eqEligible)) derives.push(d);
  }
  w.deriveLine(derives);

  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, m.name);

  for (const f of m.scalarFields) {
    if (f.docs.length > 0) w.docComments(f.docs);
    if (f.serdeRenameOverride && opts.serde) {
      w.line(`#[serde(rename = "${f.serdeRenameOverride}")]`);
    }
    w.field(`pub ${f.rustName}`, renderScalarFieldType(f, opts.moduleOf));
  }

  for (const r of m.relations) {
    if (r.docs.length > 0) w.docComments(r.docs);
    if (opts.serde) {
      const skip = r.cardinality === "one" ? "Option::is_none" : "Vec::is_empty";
      w.line(`#[serde(default, skip_serializing_if = "${skip}")]`);
    }
    w.field(`pub ${r.rustName}`, renderRelationFieldType(r, opts.moduleOf));
  }

  w.close();
  return w.toString();
}

function safeDerive(name: string, eqEligible: boolean): boolean {
  if ((name === "Hash" || name === "Eq") && !eqEligible) return false;
  return true;
}
