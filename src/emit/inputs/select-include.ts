import { RustWriter } from "../rust-writer.js";
import type { ModelIR } from "../../ir/types.js";
import type { ModuleResolver } from "../type-ref.js";

interface SelectIncludeOpts {
  serde: boolean;
  vis: "pub" | "pub(crate)";
  moduleOf: ModuleResolver;
}

export function emitSelectInput(m: ModelIR, opts: SelectIncludeOpts): string {
  return emitProjection(m, opts, "Select", true);
}

export function emitIncludeInput(m: ModelIR, opts: SelectIncludeOpts): string {
  return emitProjection(m, opts, "Include", false);
}

function emitProjection(
  m: ModelIR,
  opts: SelectIncludeOpts,
  suffix: "Select" | "Include",
  includeScalars: boolean,
): string {
  const w = new RustWriter();
  const derives = ["Debug", "Clone", "Default", "PartialEq", "Eq", "Hash"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, `${m.name}${suffix}`);
  if (includeScalars) {
    for (const f of m.scalarFields) w.field(`pub ${f.rustName}`, `Option<bool>`);
  }
  for (const r of m.relations) {
    w.field(`pub ${r.rustName}`, `Option<bool>`);
  }
  w.close();
  return w.toString();
}
