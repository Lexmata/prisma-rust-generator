import { describe, it, expect } from "vitest";
import { computeEqEligibility } from "../../src/ir/eq-eligibility.js";
import type { FieldIR, ModelIR, RelationIR } from "../../src/ir/types.js";

const stringField = (n: string): FieldIR => ({
  prismaName: n,
  rustName: n,
  dbName: n,
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
        dbName: "A",
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
        dbName: "A",
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
        dbName: "A",
        scalarFields: [stringField("id")],
        relations: [relation("b", "A", "B")],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
      {
        name: "B",
        module: "x",
        dbName: "B",
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

  it("handles a self-referential model without false propagation", () => {
    // A → A. The BFS must not re-enqueue A when processing its own
    // ineligibility, and an A with all-Eq scalars must stay Eq.
    const m: ModelIR[] = [
      {
        name: "A",
        module: "x",
        dbName: "A",
        scalarFields: [stringField("id")],
        relations: [relation("parent", "A", "A")],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
    ];
    const r = computeEqEligibility(m, []);
    expect(r.get("A")).toBe(true);
  });

  it("does not poison disconnected components", () => {
    // A → B (both Eq) and C → D (D ineligible). C must turn ineligible
    // but A and B stay Eq — the BFS must respect graph reachability.
    const m: ModelIR[] = [
      {
        name: "A",
        module: "x",
        dbName: "A",
        scalarFields: [stringField("id")],
        relations: [relation("b", "A", "B")],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
      {
        name: "B",
        module: "x",
        dbName: "B",
        scalarFields: [stringField("id")],
        relations: [],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
      {
        name: "C",
        module: "x",
        dbName: "C",
        scalarFields: [stringField("id")],
        relations: [relation("d", "C", "D")],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
      {
        name: "D",
        module: "x",
        dbName: "D",
        scalarFields: [stringField("id"), f64Field("v")],
        relations: [],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
    ];
    const r = computeEqEligibility(m, []);
    expect(r.get("A")).toBe(true);
    expect(r.get("B")).toBe(true);
    expect(r.get("C")).toBe(false);
    expect(r.get("D")).toBe(false);
  });

  it("propagates across multi-step chains in a single BFS pass", () => {
    // A → B → C → D, with D ineligible by its scalars. All four end up
    // ineligible. The old fix-point needed M iterations; the new BFS
    // does it in one.
    const m: ModelIR[] = [
      {
        name: "A",
        module: "x",
        dbName: "A",
        scalarFields: [stringField("id")],
        relations: [relation("b", "A", "B")],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
      {
        name: "B",
        module: "x",
        dbName: "B",
        scalarFields: [stringField("id")],
        relations: [relation("c", "B", "C")],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
      {
        name: "C",
        module: "x",
        dbName: "C",
        scalarFields: [stringField("id")],
        relations: [relation("d", "C", "D")],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
      {
        name: "D",
        module: "x",
        dbName: "D",
        scalarFields: [stringField("id"), f64Field("v")],
        relations: [],
        idFields: ["id"],
        uniqueGroups: [],
        docs: [],
      },
    ];
    const r = computeEqEligibility(m, []);
    expect(r.get("A")).toBe(false);
    expect(r.get("B")).toBe(false);
    expect(r.get("C")).toBe(false);
    expect(r.get("D")).toBe(false);
  });
});
