import { RustWriter } from "../rust-writer.js";
import type { FieldIR, ModelIR, RelationIR } from "../../ir/types.js";
import { renderScalarFieldType, type ModuleResolver } from "../type-ref.js";
import { toPascalCase } from "../../ir/names.js";

export interface CreateOpts {
  serde: boolean;
  vis: "pub" | "pub(crate)";
  moduleOf: ModuleResolver;
}

export function emitCreateInputs(m: ModelIR, opts: CreateOpts): string {
  const w = new RustWriter();
  emitChecked(w, m, opts);
  w.blank();
  emitUnchecked(w, m, opts);
  w.blank();
  emitCreateMany(w, m, opts);
  return w.toString();
}

function emitChecked(w: RustWriter, m: ModelIR, opts: CreateOpts): void {
  openInput(w, opts, `${m.name}CreateInput`);
  for (const f of m.scalarFields) {
    if (f.isFk) continue;
    if (f.hasDefault) continue;
    w.field(`pub ${f.rustName}`, scalarTypeForCreate(f));
  }
  for (const r of m.relations) {
    w.field(`pub ${r.rustName}`, nestedCreateRefForRelation(r, m, opts.moduleOf, false));
  }
  w.close();
}

function emitUnchecked(w: RustWriter, m: ModelIR, opts: CreateOpts): void {
  openInput(w, opts, `${m.name}UncheckedCreateInput`);
  for (const f of m.scalarFields) {
    if (f.hasDefault) continue;
    w.field(`pub ${f.rustName}`, scalarTypeForCreate(f));
  }
  void opts;
  w.close();
}

function emitCreateMany(w: RustWriter, m: ModelIR, opts: CreateOpts): void {
  openInput(w, opts, `${m.name}CreateManyInput`);
  for (const f of m.scalarFields) {
    if (f.hasDefault) continue;
    w.field(`pub ${f.rustName}`, scalarTypeForCreate(f));
  }
  void opts;
  w.close();
}

function scalarTypeForCreate(f: FieldIR): string {
  const inner = renderScalarFieldType(
    { ...f, optional: false, list: false },
    () => "",
  );
  if (f.list) return `Option<Vec<${inner}>>`;
  if (f.optional) return `Option<${inner}>`;
  return inner;
}

function nestedCreateRefForRelation(
  r: RelationIR,
  source: ModelIR,
  moduleOf: ModuleResolver,
  required: boolean,
): string {
  const mod = moduleOf(source.name);
  const prefix = mod ? `crate::${mod}::` : `crate::`;
  const without = `${source.name}${toPascalCase(r.prismaName)}`;
  const suffix =
    r.cardinality === "one"
      ? `CreateNestedOneWithout${without}Input`
      : `CreateNestedManyWithout${without}Input`;
  const ty = `${prefix}${r.toModel}${suffix}`;
  void required;
  // Box the nested type to break drop-check cycles in deeply recursive
  // input graphs.
  return `Option<Box<${ty}>>`;
}

function openInput(w: RustWriter, opts: CreateOpts, name: string): void {
  // Create inputs commonly carry required scalar/enum fields with no natural
  // Default, so we drop Default here. Callers construct explicitly.
  const derives = ["Debug", "Clone", "PartialEq"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, name);
}
