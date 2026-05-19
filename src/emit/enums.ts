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
  return w.toString();
}
