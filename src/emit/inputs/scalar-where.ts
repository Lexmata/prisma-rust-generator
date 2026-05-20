import { RustWriter } from "../rust-writer.js";
import type { FieldIR, ModelIR } from "../../ir/types.js";
import { filterFamilyForRustType } from "../filters/model.js";

export interface ScalarWhereOpts {
  serde: boolean;
  vis: "pub" | "pub(crate)";
}

// Emits `{Model}ScalarWhereInput` — a per-target-model type, NOT per-relation.
// Referenced from nested update-many inputs (`UpdateManyWithWhereWithout*Input`)
// via the target model's module path. Emitting it per-relation would produce
// duplicate definitions in the same file when several relations target the
// same model.
export function emitModelScalarWhereInput(
  m: ModelIR,
  opts: ScalarWhereOpts,
): string {
  const w = new RustWriter();
  const name = `${m.name}ScalarWhereInput`;
  const derives = ["Debug", "Clone", "Default", "PartialEq"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, name);
  for (const f of m.scalarFields) {
    const filter = scalarFilterRefFor(f);
    w.field(`pub ${f.rustName}`, `Option<${filter}>`);
  }
  if (opts.serde) w.line(`#[serde(rename = "AND")]`);
  w.field(`pub and`, `Option<Vec<${name}>>`);
  if (opts.serde) w.line(`#[serde(rename = "OR")]`);
  w.field(`pub or`, `Option<Vec<${name}>>`);
  if (opts.serde) w.line(`#[serde(rename = "NOT")]`);
  w.field(`pub not`, `Option<Vec<${name}>>`);
  w.close();
  w.blank();
  return w.toString();
}

function scalarFilterRefFor(f: FieldIR): string {
  if (f.type.kind === "scalar") {
    const family = filterFamilyForRustType(f.type.rust);
    const suffix = f.optional ? "NullableFilter" : "Filter";
    return `crate::shared::filters::${family}${suffix}`;
  }
  if (f.type.kind === "enumRef") {
    const mod = f.type.module ? `crate::${f.type.module}::` : `crate::`;
    const suffix = f.optional ? "NullableFilter" : "Filter";
    return `${mod}${f.type.enumName}${suffix}`;
  }
  return "()";
}
