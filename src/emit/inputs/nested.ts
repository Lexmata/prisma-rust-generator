import { RustWriter } from "../rust-writer.js";
import type { FieldIR, ModelIR, RelationIR } from "../../ir/types.js";
import { filterFamilyForRustType } from "../filters/model.js";
import { renderScalarFieldType, type ModuleResolver } from "../type-ref.js";

export interface NestedOpts {
  serde: boolean;
  vis: "pub" | "pub(crate)";
  moduleOf: ModuleResolver;
}

interface Ctx {
  source: ModelIR;
  target: ModelIR;
  relation: RelationIR;
  prefix: string;
  opts: NestedOpts;
}

export function emitNestedInputsForModel(
  m: ModelIR,
  allModels: ReadonlyMap<string, ModelIR>,
  opts: NestedOpts,
): string {
  const w = new RustWriter();
  // Emit nested inputs in source (host) model's module so paths resolve as
  // crate::<source-mod>::<TargetModel>CreateNestedOneWithout<Source>Input
  const mod = opts.moduleOf(m.name);
  const prefix = mod ? `crate::${mod}::` : `crate::`;
  for (const r of m.relations) {
    const target = allModels.get(r.toModel);
    if (!target) continue;
    const ctx: Ctx = { source: m, target, relation: r, prefix, opts };
    emitRelationVariants(w, ctx);
  }
  return w.toString();
}

function emitRelationVariants(w: RustWriter, ctx: Ctx): void {
  const { relation, target, source, opts } = ctx;
  const sourceName = source.name;
  const t = target.name;

  emitCreateWithout(w, ctx, false);
  emitCreateWithout(w, ctx, true);
  emitCreateOrConnectWithout(w, ctx);
  emitUpdateWithout(w, ctx, false);
  emitUpdateWithout(w, ctx, true);

  if (relation.cardinality === "one") {
    emitCreateNestedOne(w, ctx);
    emitUpsertWithout(w, ctx);
    if (relation.required) {
      emitUpdateOneRequired(w, ctx);
    } else {
      emitUpdateOneOptional(w, ctx);
    }
    emitUpdateToOneWithWhere(w, ctx);
  } else {
    emitCreateNestedMany(w, ctx);
    emitCreateManyEnvelope(w, ctx);
    emitCreateManyAInput(w, ctx);
    emitUpdateManyNested(w, ctx);
    emitUpdateWithWhereUnique(w, ctx);
    emitUpdateManyWithWhere(w, ctx);
    emitScalarWhereInput(w, ctx);
  }
  void sourceName;
  void t;
  void opts;
}

function openInput(w: RustWriter, opts: NestedOpts, name: string): void {
  const derives = ["Debug", "Clone", "Default", "PartialEq"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, name);
}

function emitCreateWithout(w: RustWriter, ctx: Ctx, unchecked: boolean): void {
  const name = `${ctx.relation.toModel}${unchecked ? "Unchecked" : ""}CreateWithout${ctx.source.name}Input`;
  openInput(w, ctx.opts, name);
  for (const f of ctx.target.scalarFields) {
    if (!unchecked && f.isFk) continue;
    if (f.hasDefault) continue;
    w.field(`pub ${f.rustName}`, scalarTypeForCreate(f));
  }
  for (const r of ctx.target.relations) {
    if (r.toModel === ctx.source.name) continue;
    if (unchecked) continue;
    const targetMod = ctx.opts.moduleOf(ctx.target.name);
    const targetPrefix = targetMod ? `crate::${targetMod}::` : `crate::`;
    const nested =
      r.cardinality === "one"
        ? `CreateNestedOneWithout${ctx.target.name}Input`
        : `CreateNestedManyWithout${ctx.target.name}Input`;
    w.field(
      `pub ${r.rustName}`,
      `Option<${targetPrefix}${r.toModel}${nested}>`,
    );
  }
  w.close();
  w.blank();
}

function emitCreateOrConnectWithout(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}CreateOrConnectWithout${ctx.source.name}Input`;
  openInput(w, ctx.opts, name);
  w.field(`pub r#where`, `Box<${ctx.prefix}${ctx.relation.toModel}WhereUniqueInput>`);
  w.field(
    `pub create`,
    `Box<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.source.name}Input>`,
  );
  w.close();
  w.blank();
}

function emitCreateNestedOne(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}CreateNestedOneWithout${ctx.source.name}Input`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub create`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub connect_or_create`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateOrConnectWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub connect`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.close();
  w.blank();
}

function emitCreateNestedMany(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}CreateNestedManyWithout${ctx.source.name}Input`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub create`,
    `Option<crate::shared::filters::OneOrMany<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub connect_or_create`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}CreateOrConnectWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub create_many`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateMany${ctx.source.name}InputEnvelope>>`,
  );
  w.field(
    `pub connect`,
    `Option<crate::shared::filters::OneOrMany<${ctx.prefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.close();
  w.blank();
}

function emitCreateManyEnvelope(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}CreateMany${ctx.source.name}InputEnvelope`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub data`,
    `Vec<${ctx.prefix}${ctx.relation.toModel}CreateMany${ctx.source.name}Input>`,
  );
  w.field(`pub skip_duplicates`, `Option<bool>`);
  w.close();
  w.blank();
}

function emitCreateManyAInput(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}CreateMany${ctx.source.name}Input`;
  openInput(w, ctx.opts, name);
  for (const f of ctx.target.scalarFields) {
    if (f.hasDefault) continue;
    w.field(`pub ${f.rustName}`, scalarTypeForCreate(f));
  }
  w.close();
  w.blank();
}

function emitUpdateWithout(w: RustWriter, ctx: Ctx, unchecked: boolean): void {
  const name = `${ctx.relation.toModel}${unchecked ? "Unchecked" : ""}UpdateWithout${ctx.source.name}Input`;
  openInput(w, ctx.opts, name);
  for (const f of ctx.target.scalarFields) {
    if (!unchecked && f.isFk) continue;
    w.field(`pub ${f.rustName}`, opInputType(f));
  }
  for (const r of ctx.target.relations) {
    if (r.toModel === ctx.source.name) continue;
    if (unchecked) continue;
    const targetMod = ctx.opts.moduleOf(ctx.target.name);
    const targetPrefix = targetMod ? `crate::${targetMod}::` : `crate::`;
    let suffix: string;
    if (r.cardinality === "one") {
      suffix = r.required
        ? `UpdateOneRequiredWithout${ctx.target.name}NestedInput`
        : `UpdateOneWithout${ctx.target.name}NestedInput`;
    } else {
      suffix = `UpdateManyWithout${ctx.target.name}NestedInput`;
    }
    w.field(`pub ${r.rustName}`, `Option<${targetPrefix}${r.toModel}${suffix}>`);
  }
  w.close();
  w.blank();
}

function emitUpsertWithout(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}UpsertWithout${ctx.source.name}Input`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub update`,
    `Box<${ctx.prefix}${ctx.relation.toModel}UpdateWithout${ctx.source.name}Input>`,
  );
  w.field(
    `pub create`,
    `Box<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.source.name}Input>`,
  );
  w.field(
    `pub r#where`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}WhereInput>>`,
  );
  w.close();
  w.blank();
}

function emitUpdateOneRequired(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}UpdateOneRequiredWithout${ctx.source.name}NestedInput`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub create`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub connect_or_create`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateOrConnectWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub upsert`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}UpsertWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub connect`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.field(
    `pub update`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}UpdateToOneWithWhereWithout${ctx.source.name}Input>>`,
  );
  w.close();
  w.blank();
}

function emitUpdateOneOptional(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}UpdateOneWithout${ctx.source.name}NestedInput`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub create`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub connect_or_create`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateOrConnectWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub upsert`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}UpsertWithout${ctx.source.name}Input>>`,
  );
  w.field(`pub disconnect`, `Option<bool>`);
  w.field(`pub delete`, `Option<bool>`);
  w.field(
    `pub connect`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.field(
    `pub update`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}UpdateToOneWithWhereWithout${ctx.source.name}Input>>`,
  );
  w.close();
  w.blank();
}

function emitUpdateToOneWithWhere(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}UpdateToOneWithWhereWithout${ctx.source.name}Input`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub r#where`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}WhereInput>>`,
  );
  w.field(
    `pub data`,
    `Box<${ctx.prefix}${ctx.relation.toModel}UpdateWithout${ctx.source.name}Input>`,
  );
  w.close();
  w.blank();
}

function emitUpdateManyNested(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}UpdateManyWithout${ctx.source.name}NestedInput`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub create`,
    `Option<crate::shared::filters::OneOrMany<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub connect_or_create`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}CreateOrConnectWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub upsert`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}UpsertWithWhereUniqueWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub create_many`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateMany${ctx.source.name}InputEnvelope>>`,
  );
  w.field(
    `pub set`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.field(
    `pub disconnect`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.field(
    `pub delete`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.field(
    `pub connect`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.field(
    `pub update`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}UpdateWithWhereUniqueWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub update_many`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}UpdateManyWithWhereWithout${ctx.source.name}Input>>`,
  );
  w.field(
    `pub delete_many`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}ScalarWhereInput>>`,
  );
  // UpsertWithWhereUnique referenced above
  emitUpsertWithWhereUniqueSidecar(w, ctx);
  w.close();
}

function emitUpsertWithWhereUniqueSidecar(_w: RustWriter, _ctx: Ctx): void {
  // sidecar emitted separately below via emitUpsertWithWhereUnique; nothing to add inline
}

function emitUpdateWithWhereUnique(w: RustWriter, ctx: Ctx): void {
  const upsertName = `${ctx.relation.toModel}UpsertWithWhereUniqueWithout${ctx.source.name}Input`;
  openInput(w, ctx.opts, upsertName);
  w.field(
    `pub r#where`,
    `Box<${ctx.prefix}${ctx.relation.toModel}WhereUniqueInput>`,
  );
  w.field(
    `pub update`,
    `Box<${ctx.prefix}${ctx.relation.toModel}UpdateWithout${ctx.source.name}Input>`,
  );
  w.field(
    `pub create`,
    `Box<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.source.name}Input>`,
  );
  w.close();
  w.blank();

  const name = `${ctx.relation.toModel}UpdateWithWhereUniqueWithout${ctx.source.name}Input`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub r#where`,
    `Box<${ctx.prefix}${ctx.relation.toModel}WhereUniqueInput>`,
  );
  w.field(
    `pub data`,
    `Box<${ctx.prefix}${ctx.relation.toModel}UpdateWithout${ctx.source.name}Input>`,
  );
  w.close();
  w.blank();
}

function emitUpdateManyWithWhere(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}UpdateManyWithWhereWithout${ctx.source.name}Input`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub r#where`,
    `Box<${ctx.prefix}${ctx.relation.toModel}ScalarWhereInput>`,
  );
  w.field(
    `pub data`,
    `Box<${ctx.prefix}${ctx.relation.toModel}UpdateManyMutationInput>`,
  );
  w.close();
  w.blank();
}

function emitScalarWhereInput(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}ScalarWhereInput`;
  openInput(w, ctx.opts, name);
  for (const f of ctx.target.scalarFields) {
    const filter = scalarFilterRefFor(f);
    w.field(`pub ${f.rustName}`, `Option<${filter}>`);
  }
  if (ctx.opts.serde) w.line(`#[serde(rename = "AND")]`);
  w.field(`pub and`, `Option<Vec<${name}>>`);
  if (ctx.opts.serde) w.line(`#[serde(rename = "OR")]`);
  w.field(`pub or`, `Option<Vec<${name}>>`);
  if (ctx.opts.serde) w.line(`#[serde(rename = "NOT")]`);
  w.field(`pub not`, `Option<Vec<${name}>>`);
  w.close();
  w.blank();
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

function opInputType(f: FieldIR): string {
  if (f.type.kind === "scalar") {
    const family = filterFamilyForRustType(f.type.rust);
    const prefix = f.optional ? "Nullable" : "";
    return `Option<crate::shared::filters::${prefix}${family}FieldUpdateOperationsInput>`;
  }
  if (f.type.kind === "enumRef") {
    const mod = f.type.module ? `crate::${f.type.module}::` : `crate::`;
    const prefix = f.optional ? "Nullable" : "";
    return `Option<${mod}${prefix}${f.type.enumName}FieldUpdateOperationsInput>`;
  }
  return "()";
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
