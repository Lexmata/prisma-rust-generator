import { RustWriter } from "../rust-writer.js";
import type { ModelIR } from "../../ir/types.js";
import { scalarFilterRefFor } from "../filters/model.js";
import type { ModuleResolver } from "../type-ref.js";

export interface ScalarWhereOpts {
  serde: boolean;
  vis: "pub" | "pub(crate)";
  moduleOf?: ModuleResolver;
}

// `{Model}ScalarWhereInput` is a per-target-model type, NOT per-relation. It is
// referenced from nested update-many inputs via the target model's module path;
// emitting it per-relation would produce duplicate definitions in the same file
// when several relations target the same model.
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
    w.field(`pub ${f.rustName}`, `Option<${scalarFilterRefFor(f, opts.moduleOf)}>`);
  }
  for (const [rust, prisma] of [
    ["and", "AND"],
    ["or", "OR"],
    ["not", "NOT"],
  ] as const) {
    if (opts.serde) w.line(`#[serde(rename = "${prisma}")]`);
    w.field(`pub ${rust}`, `Option<Vec<${name}>>`);
  }
  w.close();
  w.blank();
  return w.toString();
}
