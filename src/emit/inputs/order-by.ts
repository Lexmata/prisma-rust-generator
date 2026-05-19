import { RustWriter } from "../rust-writer.js";
import type { ModelIR } from "../../ir/types.js";
import type { ModuleResolver } from "../type-ref.js";

export function emitOrderByWithRelationInput(
  m: ModelIR,
  opts: { serde: boolean; vis: "pub" | "pub(crate)"; moduleOf: ModuleResolver },
): string {
  const w = new RustWriter();
  const derives = ["Debug", "Clone", "Default", "PartialEq"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, `${m.name}OrderByWithRelationInput`);
  for (const f of m.scalarFields) {
    w.field(`pub ${f.rustName}`, `Option<crate::shared::filters::SortOrder>`);
  }
  for (const r of m.relations) {
    const mod = opts.moduleOf(r.toModel);
    const prefix = mod ? `crate::${mod}::` : `crate::`;
    w.field(
      `pub ${r.rustName}`,
      `Option<Box<${prefix}${r.toModel}OrderByWithRelationInput>>`,
    );
  }
  w.close();
  return w.toString();
}
