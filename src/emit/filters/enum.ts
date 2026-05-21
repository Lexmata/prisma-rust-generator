import { RustWriter } from "../rust-writer.js";

// `<EnumName>Filter` / `<EnumName>NullableFilter` mirror the scalar filter
// structs in shape: optional fields for each operator. See
// `src/emit/filters/scalar.ts` for the conventions on `r#in` and the
// `Default` derive.
export function emitEnumFilter(
  enumName: string,
  module: string,
  opts: { serde: boolean; vis: "pub" | "pub(crate)" },
): string {
  const w = new RustWriter();
  const fqn = module ? `crate::${module}::${enumName}` : `crate::${enumName}`;
  for (const nullable of [false, true]) {
    const name = nullable ? `${enumName}NullableFilter` : `${enumName}Filter`;
    // Eq/Hash dropped relative to the old enum form — Option fields prevent
    // a clean Eq when nested filters or future non-Eq operator payloads are
    // added, and consumers don't pattern-match on filter values any more.
    const derives = ["Debug", "Clone", "Default", "PartialEq"];
    if (opts.serde) derives.push("Serialize", "Deserialize");
    w.deriveLine(derives);
    if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
    w.openStruct(opts.vis, name);

    w.field(`pub equals`, `Option<${fqn}>`);
    if (opts.serde) w.line(`#[serde(rename = "in")]`);
    w.field(`pub r#in`, `Option<Vec<${fqn}>>`);
    w.field(`pub not_in`, `Option<Vec<${fqn}>>`);
    if (nullable) {
      w.field(`pub is_null`, `Option<bool>`);
    }
    w.field(`pub not`, `Option<Box<${name}>>`);

    w.close();
    w.blank();
  }
  return w.toString();
}
