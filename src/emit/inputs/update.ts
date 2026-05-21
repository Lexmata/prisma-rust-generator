import { RustWriter } from "../rust-writer.js";
import type { FieldIR, ModelIR, RelationIR } from "../../ir/types.js";
import { filterFamilyForRustType } from "../filters/model.js";
import type { ModuleResolver } from "../type-ref.js";
import { toPascalCase } from "../../ir/names.js";

export interface UpdateOpts {
  serde: boolean;
  vis: "pub" | "pub(crate)";
  moduleOf: ModuleResolver;
}

export function emitUpdateInputs(m: ModelIR, opts: UpdateOpts): string {
  const w = new RustWriter();
  emitChecked(w, m, opts);
  w.blank();
  emitUnchecked(w, m, opts);
  w.blank();
  emitUpdateMany(w, m, opts);
  w.blank();
  emitUncheckedUpdateMany(w, m, opts);
  return w.toString();
}

function emitChecked(w: RustWriter, m: ModelIR, opts: UpdateOpts): void {
  openInput(w, opts, `${m.name}UpdateInput`);
  for (const f of m.scalarFields) {
    if (f.isFk) continue;
    w.field(`pub ${f.rustName}`, opInputType(f, opts.moduleOf));
  }
  for (const r of m.relations) {
    w.field(`pub ${r.rustName}`, nestedUpdateRefForRelation(r, m, opts.moduleOf));
  }
  w.close();
}

function emitUnchecked(w: RustWriter, m: ModelIR, opts: UpdateOpts): void {
  openInput(w, opts, `${m.name}UncheckedUpdateInput`);
  for (const f of m.scalarFields) {
    w.field(`pub ${f.rustName}`, opInputType(f, opts.moduleOf));
  }
  w.close();
}

function emitUpdateMany(w: RustWriter, m: ModelIR, opts: UpdateOpts): void {
  openInput(w, opts, `${m.name}UpdateManyMutationInput`);
  for (const f of m.scalarFields) {
    if (f.isFk) continue;
    w.field(`pub ${f.rustName}`, opInputType(f, opts.moduleOf));
  }
  w.close();
}

function emitUncheckedUpdateMany(w: RustWriter, m: ModelIR, opts: UpdateOpts): void {
  openInput(w, opts, `${m.name}UncheckedUpdateManyInput`);
  for (const f of m.scalarFields) {
    w.field(`pub ${f.rustName}`, opInputType(f, opts.moduleOf));
  }
  w.close();
}

function opInputType(f: FieldIR, moduleOf?: ModuleResolver): string {
  if (f.type.kind === "scalar") {
    const family = filterFamilyForRustType(f.type.rust);
    const prefix = f.optional ? "Nullable" : "";
    return `Option<crate::shared::filters::${prefix}${family}FieldUpdateOperationsInput>`;
  }
  if (f.type.kind === "enumRef") {
    const resolved = moduleOf ? moduleOf(f.type.enumName) : f.type.module;
    const mod = resolved ? `crate::${resolved}::` : `crate::`;
    const prefix = f.optional ? "Nullable" : "";
    return `Option<${mod}${prefix}${f.type.enumName}FieldUpdateOperationsInput>`;
  }
  return "()";
}

function nestedUpdateRefForRelation(
  r: RelationIR,
  source: ModelIR,
  moduleOf: ModuleResolver,
): string {
  const mod = moduleOf(source.name);
  const prefix = mod ? `crate::${mod}::` : `crate::`;
  const without = `${source.name}${toPascalCase(r.prismaName)}`;
  let suffix: string;
  if (r.cardinality === "one") {
    suffix = r.required
      ? `UpdateOneRequiredWithout${without}NestedInput`
      : `UpdateOneWithout${without}NestedInput`;
  } else {
    suffix = `UpdateManyWithout${without}NestedInput`;
  }
  return `Option<Box<${prefix}${r.toModel}${suffix}>>`;
}

function openInput(w: RustWriter, opts: UpdateOpts, name: string): void {
  const derives = ["Debug", "Clone", "Default", "PartialEq"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, name);
}

