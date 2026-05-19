import { RustWriter } from "../rust-writer.js";

export function emitEnumFilter(
  enumName: string,
  module: string,
  opts: { serde: boolean; vis: "pub" | "pub(crate)" },
): string {
  const w = new RustWriter();
  const fqn = module ? `crate::${module}::${enumName}` : `crate::${enumName}`;
  for (const nullable of [false, true]) {
    const name = nullable ? `${enumName}NullableFilter` : `${enumName}Filter`;
    const derives = ["Debug", "Clone", "PartialEq", "Eq", "Hash"];
    if (opts.serde) derives.push("Serialize", "Deserialize");
    w.deriveLine(derives);
    if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
    w.openEnum(opts.vis, name);
    w.variant(nullable ? `Equals(Option<${fqn}>)` : `Equals(${fqn})`);
    w.variant(`In(Vec<${fqn}>)`);
    w.variant(`NotIn(Vec<${fqn}>)`);
    if (nullable) w.variant(`IsNull(bool)`);
    w.variant(`Not(Box<${name}>)`);
    w.close();
    w.blank();
  }
  return w.toString();
}
