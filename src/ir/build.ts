import type { DMMF } from "@prisma/generator-helper";
import type { GeneratorConfig } from "../types.js";
import { mapPrismaScalar } from "./type-mapping.js";
import { rustFieldIdent, toPascalCase } from "./names.js";
import type {
  IR,
  ModelIR,
  EnumIR,
  FieldIR,
  RelationIR,
  RustTypeRef,
  UniqueGroup,
} from "./types.js";

export async function buildIR(
  dmmf: DMMF.Document,
  fileMap: ReadonlyMap<string, string>,
  cfg: GeneratorConfig,
): Promise<IR> {
  const enumByName = new Map<string, EnumIR>();
  for (const e of dmmf.datamodel.enums) {
    const module = fileMap.get(e.name) ?? "shared";
    enumByName.set(e.name, {
      name: e.name,
      module,
      variants: e.values.map((v) => ({
        prismaName: v.name,
        rustName: toPascalCase(v.name),
        serdeRename: v.name !== toPascalCase(v.name) ? v.name : null,
        docs: splitDocs(v.dbName ?? null),
      })),
      docs: splitDocs(e.documentation ?? null),
      eqEligible: true,
    });
  }

  const models: ModelIR[] = [];
  for (const m of dmmf.datamodel.models) {
    const module = fileMap.get(m.name) ?? "shared";
    const scalarFields: FieldIR[] = [];
    const relations: RelationIR[] = [];

    for (const f of m.fields) {
      if (f.kind === "scalar") {
        const native = extractNativeType(f);
        const t = mapPrismaScalar(f.type, native, cfg);
        scalarFields.push(makeField(f, t));
      } else if (f.kind === "enum") {
        const ref: RustTypeRef = {
          kind: "enumRef",
          enumName: f.type,
          module: enumByName.get(f.type)?.module ?? "shared",
        };
        scalarFields.push(makeField(f, ref));
      } else if (f.kind === "object") {
        // Relation field — recorded separately, not as a scalar field
        relations.push({
          prismaName: f.name,
          rustName: rustFieldIdent(f.name),
          fromModel: m.name,
          toModel: f.type,
          cardinality: f.isList ? "many" : "one",
          required: f.isRequired,
          fkFieldNames: f.relationFromFields ? [...f.relationFromFields] : [],
          backRelationName: null, // resolved later (cross-link pass / emit time)
          docs: splitDocs(f.documentation ?? null),
        });
      }
    }

    const uniqueGroups: UniqueGroup[] = [
      ...(m.primaryKey
        ? [{ name: m.primaryKey.name, fields: [...m.primaryKey.fields] }]
        : []),
      ...m.uniqueIndexes.map((u) => ({ name: u.name, fields: [...u.fields] })),
      ...scalarFields
        .filter((f) => f.isUnique)
        .map((f) => ({ name: null, fields: [f.prismaName] })),
    ];

    models.push({
      name: m.name,
      module,
      scalarFields,
      relations,
      idFields: m.primaryKey
        ? [...m.primaryKey.fields]
        : scalarFields.filter((f) => f.isId).map((f) => f.prismaName),
      uniqueGroups,
      docs: splitDocs(m.documentation ?? null),
    });
  }

  crossLinkRelations(models);

  return {
    models,
    enums: [...enumByName.values()],
    modelEqEligibility: new Map(), // populated in B6
    inputCycles: new Set(), // populated in B7
    schemaEdition: cfg.edition,
  };
}

function makeField(f: DMMF.Field, type: RustTypeRef): FieldIR {
  return {
    prismaName: f.name,
    rustName: rustFieldIdent(f.name),
    type,
    optional: !f.isRequired,
    list: f.isList,
    isFk: false, // overwritten by crossLinkRelations once relation pairs are known
    isId: f.isId,
    isUnique: f.isUnique,
    hasDefault: f.hasDefaultValue,
    docs: splitDocs(f.documentation ?? null),
    serdeRenameOverride: null,
  };
}

function extractNativeType(f: DMMF.Field): string | null {
  // DMMF encodes native types as `[name, args]` tuples on `nativeType`.
  // The published `DMMF.Field` interface in @prisma/generator-helper@5.22.0 does
  // not include this field explicitly, but it is present at runtime.
  const nt = (f as unknown as { nativeType?: [string, string[]] | null })
    .nativeType;
  return nt ? nt[0] : null;
}

function splitDocs(doc: string | null): readonly string[] {
  if (!doc) return [];
  return doc.split("\n").map((s) => s.trimEnd());
}

function crossLinkRelations(models: ModelIR[]): void {
  // Mark FK scalar fields with isFk=true based on each relation's fkFieldNames.
  // The fields array is declared readonly on ModelIR, so we rebuild it via a
  // narrow local cast.
  for (const m of models) {
    const fkNames = new Set<string>();
    for (const r of m.relations) for (const fk of r.fkFieldNames) fkNames.add(fk);
    (m as unknown as { scalarFields: FieldIR[] }).scalarFields =
      m.scalarFields.map((f) =>
        fkNames.has(f.prismaName) ? { ...f, isFk: true } : f,
      );
  }
  // Back-relation resolution: for each relation, find its inverse on the target
  // model by relationName. DMMF doesn't expose relationName uniformly across
  // versions; v1 leaves backRelationName null and discovers via
  // (fromModel, toModel, cardinality complement) at emit time when needed.
}
