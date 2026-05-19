import { RustWriter } from "./rust-writer.js";
import type { EnumIR } from "../ir/types.js";

export interface EnumEmitOptions {
  serde: boolean;
  vis: "pub" | "pub(crate)";
}

export function emitEnum(e: EnumIR, opts: EnumEmitOptions): string {
  const w = new RustWriter();
  if (e.docs.length > 0) w.docComments(e.docs);

  const derives = ["Debug", "Clone", "Copy", "PartialEq", "Eq", "Hash"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);

  w.openEnum(opts.vis, e.name);
  for (const v of e.variants) {
    if (v.docs.length > 0) w.docComments(v.docs);
    if (v.serdeRename && opts.serde) w.line(`#[serde(rename = "${v.serdeRename}")]`);
    w.variant(v.rustName);
  }
  w.close();
  w.blank();

  for (const nullable of [false, true]) {
    const name = `${nullable ? "Nullable" : ""}${e.name}FieldUpdateOperationsInput`;
    const opDerives = ["Debug", "Clone", "Default", "PartialEq"];
    if (opts.serde) opDerives.push("Serialize", "Deserialize");
    w.deriveLine(opDerives);
    if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
    w.openStruct(opts.vis, name);
    const setType = nullable ? `Option<Option<${e.name}>>` : `Option<${e.name}>`;
    w.field(`pub set`, setType);
    w.close();
    w.blank();
  }
  return w.toString();
}
