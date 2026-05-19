// src/ir/types.ts
export type Cardinality = "one" | "many";

export interface RustScalarKind {
  readonly kind: "scalar";
  readonly rust: string;            // e.g. "uuid::Uuid", "chrono::DateTime<chrono::Utc>"
  readonly eq: boolean;             // does this type derive Eq?
  readonly copy: boolean;           // does this type derive Copy?
}

export interface RustEnumRefKind {
  readonly kind: "enumRef";
  readonly enumName: string;        // unqualified, e.g. "CaseStatus"
  readonly module: string;          // source-file stem, e.g. "cases"
}

export interface RustModelRefKind {
  readonly kind: "modelRef";
  readonly modelName: string;
  readonly module: string;
}

export type RustTypeRef =
  | RustScalarKind
  | RustEnumRefKind
  | RustModelRefKind;

export interface FieldIR {
  readonly prismaName: string;      // original Prisma name (camelCase)
  readonly rustName: string;        // snake_case, with r# prefix if reserved
  readonly type: RustTypeRef;
  readonly optional: boolean;       // ? in Prisma
  readonly list: boolean;           // [] in Prisma
  readonly isFk: boolean;
  readonly isId: boolean;
  readonly isUnique: boolean;
  readonly hasDefault: boolean;
  readonly docs: readonly string[]; // one entry per line
  readonly serdeRenameOverride: string | null;
}

export interface RelationIR {
  readonly prismaName: string;      // virtual-field name
  readonly rustName: string;
  readonly fromModel: string;
  readonly toModel: string;
  readonly cardinality: Cardinality;
  readonly required: boolean;       // true means non-nullable
  readonly fkFieldNames: readonly string[]; // FK columns on `fromModel`
  readonly backRelationName: string | null; // the inverse field's name on `toModel`
  readonly docs: readonly string[];
}

export interface UniqueGroup {
  readonly name: string | null;     // @@unique name if set
  readonly fields: readonly string[]; // prisma field names
}

export interface ModelIR {
  readonly name: string;            // PascalCase, original Prisma name
  readonly module: string;          // source-file stem
  readonly scalarFields: readonly FieldIR[];
  readonly relations: readonly RelationIR[];
  readonly idFields: readonly string[];
  readonly uniqueGroups: readonly UniqueGroup[];
  readonly docs: readonly string[];
}

export interface EnumVariantIR {
  readonly prismaName: string;
  readonly rustName: string;        // PascalCase
  readonly serdeRename: string | null;
  readonly docs: readonly string[];
}

export interface EnumIR {
  readonly name: string;
  readonly module: string;
  readonly variants: readonly EnumVariantIR[];
  readonly docs: readonly string[];
  readonly eqEligible: true;        // enums are always Eq-eligible
}

export interface IR {
  readonly models: readonly ModelIR[];
  readonly enums: readonly EnumIR[];
  readonly modelEqEligibility: ReadonlyMap<string, boolean>;
  readonly inputCycles: ReadonlySet<string>; // input-type names that participate in cycles → need Box
  readonly schemaEdition: "2021" | "2024";
}
