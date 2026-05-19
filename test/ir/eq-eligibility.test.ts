import { describe, it, expect } from "vitest";
import { computeEqEligibility } from "../../src/ir/eq-eligibility.js";
import type { FieldIR, ModelIR, RelationIR } from "../../src/ir/types.js";

const stringField = (n: string): FieldIR => ({
  prismaName: n,
  rustName: n,
  type: { kind: "scalar", rust: "String", eq: true, copy: false },
  optional: false,
  list: false,
  isFk: false,
  isId: false,
  isUnique: false,
  hasDefault: false,
  docs: [],
  serdeRenameOverride: null,
});

const f64Field = (n: string): FieldIR => ({
  ...stringField(n),
  type: { kind: "scalar", rust: "f64", eq: false, copy: true },
});

const relation = (
  rustName: string,
  fromModel: string,
  toModel: string,
): RelationIR => ({
  prismaName: rustName,
  rustName,
  fromModel,
  toModel,
  cardinality: "one",
  required: false,
  fkFieldNames: [],
  backRelationName: null,
  docs: [],
});

describe("computeEqEligibility", () => {
  it("marks a struct with all-Eq fields as Eq", () => {
    const m: ModelIR[] = [
      {
        name: "A",
        module: "x",
        scalarFields: [stringField("id")],
        relations: [],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
    ];
    const r = computeEqEligibility(m, []);
    expect(r.get("A")).toBe(true);
  });

  it("marks a struct containing f64 as not Eq", () => {
    const m: ModelIR[] = [
      {
        name: "A",
        module: "x",
        scalarFields: [stringField("id"), f64Field("score")],
        relations: [],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
    ];
    const r = computeEqEligibility(m, []);
    expect(r.get("A")).toBe(false);
  });

  it("propagates non-Eq through relations", () => {
    const m: ModelIR[] = [
      {
        name: "A",
        module: "x",
        scalarFields: [stringField("id")],
        relations: [relation("b", "A", "B")],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
      {
        name: "B",
        module: "x",
        scalarFields: [stringField("id"), f64Field("v")],
        relations: [],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
    ];
    const r = computeEqEligibility(m, []);
    expect(r.get("B")).toBe(false);
    expect(r.get("A")).toBe(false);
  });
});
