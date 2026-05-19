import { RustWriter } from "../rust-writer.js";
import type { ModelIR } from "../../ir/types.js";
import { renderScalarFieldType } from "../type-ref.js";

export function emitWhereUniqueInput(
  m: ModelIR,
  opts: { serde: boolean; vis: "pub" | "pub(crate)" },
): string {
  const w = new RustWriter();
  const derives = ["Debug", "Clone", "Default", "PartialEq"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, `${m.name}WhereUniqueInput`);

  const uniqueFieldNames = new Set<string>();
  for (const g of m.uniqueGroups) for (const f of g.fields) uniqueFieldNames.add(f);

  const emitted = new Set<string>();
  for (const f of m.scalarFields) {
    if (!uniqueFieldNames.has(f.prismaName)) continue;
    if (emitted.has(f.rustName)) continue;
    emitted.add(f.rustName);
    const t = renderScalarFieldType(
      { ...f, optional: false, list: false },
      () => "",
    );
    w.field(`pub ${f.rustName}`, `Option<${t}>`);
  }
  w.close();
  return w.toString();
}
