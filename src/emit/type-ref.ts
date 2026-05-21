import type { FieldIR, RelationIR, RustTypeRef } from "../ir/types.js";

export type ModuleResolver = (typeName: string) => string;

export function renderScalarFieldType(f: FieldIR, moduleOf: ModuleResolver): string {
  const inner = renderTypeRef(f.type, moduleOf);
  let t = inner;
  if (f.list) t = `Vec<${t}>`;
  if (f.optional) t = `Option<${t}>`;
  return t;
}

export function renderTypeRef(r: RustTypeRef, moduleOf: ModuleResolver): string {
  switch (r.kind) {
    case "scalar": {
      return r.rust;
    }
    case "enumRef": {
      const mod = moduleOf(r.enumName) || r.module;
      return mod ? `crate::${mod}::${r.enumName}` : `crate::${r.enumName}`;
    }
    case "modelRef": {
      const mod = moduleOf(r.modelName) || r.module;
      return mod ? `crate::${mod}::${r.modelName}` : `crate::${r.modelName}`;
    }
  }
}

export function renderRelationFieldType(r: RelationIR, moduleOf: ModuleResolver): string {
  const mod = moduleOf(r.toModel);
  const path = mod ? `crate::${mod}::${r.toModel}` : `crate::${r.toModel}`;
  if (r.cardinality === "one") return `Option<Box<${path}>>`;
  return `Vec<${path}>`;
}
