import { RustWriter } from "../rust-writer.js";

export function emitRelationFilters(
  modelName: string,
  module: string,
  opts: { serde: boolean; vis: "pub" | "pub(crate)" },
): string {
  const w = new RustWriter();
  const where = module
    ? `crate::${module}::${modelName}WhereInput`
    : `crate::${modelName}WhereInput`;
  const derives = ["Debug", "Clone", "Default", "PartialEq"];
  if (opts.serde) derives.push("Serialize", "Deserialize");

  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, `${modelName}RelationFilter`);
  w.field(`pub is`, `Option<Box<${where}>>`);
  w.field(`pub is_not`, `Option<Box<${where}>>`);
  w.close();
  w.blank();

  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, `${modelName}ListRelationFilter`);
  w.field(`pub some`, `Option<Box<${where}>>`);
  w.field(`pub every`, `Option<Box<${where}>>`);
  w.field(`pub none`, `Option<Box<${where}>>`);
  w.close();
  return w.toString();
}
