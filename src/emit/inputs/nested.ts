import { RustWriter } from "../rust-writer.js";
import type { FieldIR, ModelIR, RelationIR } from "../../ir/types.js";
import { renderScalarFieldType, type ModuleResolver } from "../type-ref.js";
import { toPascalCase } from "../../ir/names.js";
import { filterFamilyForRustType } from "../filters/model.js";

export interface NestedOpts {
  serde: boolean;
  vis: "pub" | "pub(crate)";
  moduleOf: ModuleResolver;
}

interface Ctx {
  source: ModelIR;
  target: ModelIR;
  relation: RelationIR;
  // prefix: source model's module path — used for types emitted from source's
  // perspective (per-relation types like CreateWithout, UpdateWithout, etc.).
  prefix: string;
  // targetPrefix: target model's module path — used for "global" types that
  // are emitted once per target model regardless of the source: WhereInput,
  // WhereUniqueInput, ScalarWhereInput, UpdateManyMutationInput.
  targetPrefix: string;
  // relSuffix: `{Source}{PascalCase(relation.prismaName)}` — the disambiguator
  // appended to nested-input names so multiple relations from the same source
  // to the same target (e.g. CaseTask.creator/assignee both pointing at User)
  // produce unique types. Computed once per relation; emitters reference it
  // 5-12 times so caching avoids re-running toPascalCase on every field.
  relSuffix: string;
  opts: NestedOpts;
}

export function emitNestedInputsForModel(
  m: ModelIR,
  allModels: ReadonlyMap<string, ModelIR>,
  opts: NestedOpts,
): string {
  const w = new RustWriter();
  const mod = opts.moduleOf(m.name);
  const prefix = mod ? `crate::${mod}::` : `crate::`;
  for (const r of m.relations) {
    const target = allModels.get(r.toModel);
    if (!target) continue;
    const targetMod = opts.moduleOf(target.name);
    const targetPrefix = targetMod ? `crate::${targetMod}::` : `crate::`;
    const relSuffix = `${m.name}${toPascalCase(r.prismaName)}`;
    const ctx: Ctx = { source: m, target, relation: r, prefix, targetPrefix, relSuffix, opts };
    emitRelationVariants(w, ctx);
  }
  return w.toString();
}

function emitRelationVariants(w: RustWriter, ctx: Ctx): void {
  emitCreateWithout(w, ctx, false);
  emitCreateWithout(w, ctx, true);
  emitCreateOrConnectWithout(w, ctx);
  emitUpdateWithout(w, ctx, false);
  emitUpdateWithout(w, ctx, true);

  if (ctx.relation.cardinality === "one") {
    emitCreateNestedOne(w, ctx);
    emitUpsertWithout(w, ctx);
    if (ctx.relation.required) {
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
  }
}

function openInput(
  w: RustWriter,
  opts: NestedOpts,
  name: string,
  withDefault = true,
): void {
  const derives = ["Debug", "Clone"];
  if (withDefault) derives.push("Default");
  derives.push("PartialEq");
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, name);
}

// Relation fields in nested input types (here and in create.ts/update.ts top
// levels) are Boxed because the input graph is mutually recursive across many
// models — without Box the compiler's drop-check walk overflows even at the
// 1024 recursion_limit on densely connected schemas. The inner reference
// points to a nested type emitted from the target model's perspective, so it
// lives in the target's module.
function innerNestedCreateRef(
  ctx: Ctx,
  r: RelationIR,
): string {
  const innerWithout = `${ctx.target.name}${toPascalCase(r.prismaName)}`;
  const nested =
    r.cardinality === "one"
      ? `CreateNestedOneWithout${innerWithout}Input`
      : `CreateNestedManyWithout${innerWithout}Input`;
  return `Option<Box<${ctx.targetPrefix}${r.toModel}${nested}>>`;
}

function innerNestedUpdateRef(
  ctx: Ctx,
  r: RelationIR,
): string {
  const innerWithout = `${ctx.target.name}${toPascalCase(r.prismaName)}`;
  let suffix: string;
  if (r.cardinality === "one") {
    suffix = r.required
      ? `UpdateOneRequiredWithout${innerWithout}NestedInput`
      : `UpdateOneWithout${innerWithout}NestedInput`;
  } else {
    suffix = `UpdateManyWithout${innerWithout}NestedInput`;
  }
  return `Option<Box<${ctx.targetPrefix}${r.toModel}${suffix}>>`;
}

function emitCreateWithout(w: RustWriter, ctx: Ctx, unchecked: boolean): void {
  const name = `${ctx.relation.toModel}${unchecked ? "Unchecked" : ""}CreateWithout${ctx.relSuffix}Input`;
  openInput(w, ctx.opts, name, false);
  for (const f of ctx.target.scalarFields) {
    if (!unchecked && f.isFk) continue;
    if (f.hasDefault) continue;
    w.field(`pub ${f.rustName}`, scalarTypeForCreate(f));
  }
  for (const r of ctx.target.relations) {
    if (r.toModel === ctx.source.name) continue;
    if (unchecked) continue;
    w.field(`pub ${r.rustName}`, innerNestedCreateRef(ctx, r));
  }
  w.close();
  w.blank();
}

function emitCreateOrConnectWithout(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}CreateOrConnectWithout${ctx.relSuffix}Input`;
  openInput(w, ctx.opts, name, false);
  w.field(`pub r#where`, `Box<${ctx.targetPrefix}${ctx.relation.toModel}WhereUniqueInput>`);
  w.field(
    `pub create`,
    `Box<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.relSuffix}Input>`,
  );
  w.close();
  w.blank();
}

function emitCreateNestedOne(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}CreateNestedOneWithout${ctx.relSuffix}Input`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub create`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub connect_or_create`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateOrConnectWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub connect`,
    `Option<Box<${ctx.targetPrefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.close();
  w.blank();
}

function emitCreateNestedMany(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}CreateNestedManyWithout${ctx.relSuffix}Input`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub create`,
    `Option<crate::shared::filters::OneOrMany<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub connect_or_create`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}CreateOrConnectWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub create_many`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateMany${ctx.relSuffix}InputEnvelope>>`,
  );
  w.field(
    `pub connect`,
    `Option<crate::shared::filters::OneOrMany<${ctx.targetPrefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.close();
  w.blank();
}

function emitCreateManyEnvelope(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}CreateMany${ctx.relSuffix}InputEnvelope`;
  openInput(w, ctx.opts, name, true);
  w.field(
    `pub data`,
    `Vec<${ctx.prefix}${ctx.relation.toModel}CreateMany${ctx.relSuffix}Input>`,
  );
  w.field(`pub skip_duplicates`, `Option<bool>`);
  w.close();
  w.blank();
}

function emitCreateManyAInput(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}CreateMany${ctx.relSuffix}Input`;
  openInput(w, ctx.opts, name, false);
  for (const f of ctx.target.scalarFields) {
    if (f.hasDefault) continue;
    w.field(`pub ${f.rustName}`, scalarTypeForCreate(f));
  }
  w.close();
  w.blank();
}

function emitUpdateWithout(w: RustWriter, ctx: Ctx, unchecked: boolean): void {
  const name = `${ctx.relation.toModel}${unchecked ? "Unchecked" : ""}UpdateWithout${ctx.relSuffix}Input`;
  openInput(w, ctx.opts, name);
  for (const f of ctx.target.scalarFields) {
    if (!unchecked && f.isFk) continue;
    w.field(`pub ${f.rustName}`, opInputTypeForField(f));
  }
  for (const r of ctx.target.relations) {
    if (r.toModel === ctx.source.name) continue;
    if (unchecked) continue;
    w.field(`pub ${r.rustName}`, innerNestedUpdateRef(ctx, r));
  }
  w.close();
  w.blank();
}

function emitUpsertWithout(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}UpsertWithout${ctx.relSuffix}Input`;
  openInput(w, ctx.opts, name, false);
  w.field(
    `pub update`,
    `Box<${ctx.prefix}${ctx.relation.toModel}UpdateWithout${ctx.relSuffix}Input>`,
  );
  w.field(
    `pub create`,
    `Box<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.relSuffix}Input>`,
  );
  w.field(
    `pub r#where`,
    `Option<Box<${ctx.targetPrefix}${ctx.relation.toModel}WhereInput>>`,
  );
  w.close();
  w.blank();
}

function emitUpdateOneRequired(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}UpdateOneRequiredWithout${ctx.relSuffix}NestedInput`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub create`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub connect_or_create`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateOrConnectWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub upsert`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}UpsertWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub connect`,
    `Option<Box<${ctx.targetPrefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.field(
    `pub update`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}UpdateToOneWithWhereWithout${ctx.relSuffix}Input>>`,
  );
  w.close();
  w.blank();
}

function emitUpdateOneOptional(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}UpdateOneWithout${ctx.relSuffix}NestedInput`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub create`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub connect_or_create`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateOrConnectWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub upsert`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}UpsertWithout${ctx.relSuffix}Input>>`,
  );
  w.field(`pub disconnect`, `Option<bool>`);
  w.field(`pub delete`, `Option<bool>`);
  w.field(
    `pub connect`,
    `Option<Box<${ctx.targetPrefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.field(
    `pub update`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}UpdateToOneWithWhereWithout${ctx.relSuffix}Input>>`,
  );
  w.close();
  w.blank();
}

function emitUpdateToOneWithWhere(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}UpdateToOneWithWhereWithout${ctx.relSuffix}Input`;
  openInput(w, ctx.opts, name, false);
  w.field(
    `pub r#where`,
    `Option<Box<${ctx.targetPrefix}${ctx.relation.toModel}WhereInput>>`,
  );
  w.field(
    `pub data`,
    `Box<${ctx.prefix}${ctx.relation.toModel}UpdateWithout${ctx.relSuffix}Input>`,
  );
  w.close();
  w.blank();
}

function emitUpdateManyNested(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}UpdateManyWithout${ctx.relSuffix}NestedInput`;
  openInput(w, ctx.opts, name);
  w.field(
    `pub create`,
    `Option<crate::shared::filters::OneOrMany<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub connect_or_create`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}CreateOrConnectWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub upsert`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}UpsertWithWhereUniqueWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub create_many`,
    `Option<Box<${ctx.prefix}${ctx.relation.toModel}CreateMany${ctx.relSuffix}InputEnvelope>>`,
  );
  w.field(
    `pub set`,
    `Option<Vec<${ctx.targetPrefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.field(
    `pub disconnect`,
    `Option<Vec<${ctx.targetPrefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.field(
    `pub delete`,
    `Option<Vec<${ctx.targetPrefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.field(
    `pub connect`,
    `Option<Vec<${ctx.targetPrefix}${ctx.relation.toModel}WhereUniqueInput>>`,
  );
  w.field(
    `pub update`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}UpdateWithWhereUniqueWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub update_many`,
    `Option<Vec<${ctx.prefix}${ctx.relation.toModel}UpdateManyWithWhereWithout${ctx.relSuffix}Input>>`,
  );
  w.field(
    `pub delete_many`,
    `Option<Vec<${ctx.targetPrefix}${ctx.relation.toModel}ScalarWhereInput>>`,
  );
  w.close();
}

function emitUpdateWithWhereUnique(w: RustWriter, ctx: Ctx): void {
  const upsertName = `${ctx.relation.toModel}UpsertWithWhereUniqueWithout${ctx.relSuffix}Input`;
  openInput(w, ctx.opts, upsertName, false);
  w.field(
    `pub r#where`,
    `Box<${ctx.targetPrefix}${ctx.relation.toModel}WhereUniqueInput>`,
  );
  w.field(
    `pub update`,
    `Box<${ctx.prefix}${ctx.relation.toModel}UpdateWithout${ctx.relSuffix}Input>`,
  );
  w.field(
    `pub create`,
    `Box<${ctx.prefix}${ctx.relation.toModel}CreateWithout${ctx.relSuffix}Input>`,
  );
  w.close();
  w.blank();

  const name = `${ctx.relation.toModel}UpdateWithWhereUniqueWithout${ctx.relSuffix}Input`;
  openInput(w, ctx.opts, name, false);
  w.field(
    `pub r#where`,
    `Box<${ctx.targetPrefix}${ctx.relation.toModel}WhereUniqueInput>`,
  );
  w.field(
    `pub data`,
    `Box<${ctx.prefix}${ctx.relation.toModel}UpdateWithout${ctx.relSuffix}Input>`,
  );
  w.close();
  w.blank();
}

function emitUpdateManyWithWhere(w: RustWriter, ctx: Ctx): void {
  const name = `${ctx.relation.toModel}UpdateManyWithWhereWithout${ctx.relSuffix}Input`;
  openInput(w, ctx.opts, name, false);
  w.field(
    `pub r#where`,
    `Box<${ctx.targetPrefix}${ctx.relation.toModel}ScalarWhereInput>`,
  );
  w.field(
    `pub data`,
    `Box<${ctx.targetPrefix}${ctx.relation.toModel}UpdateManyMutationInput>`,
  );
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

function opInputTypeForField(f: FieldIR): string {
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

