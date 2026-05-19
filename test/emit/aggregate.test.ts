import { describe, it, expect } from "vitest";
import { emitAggregateInputs } from "../../src/emit/inputs/aggregate.js";
import type { ModelIR } from "../../src/ir/types.js";

const model: ModelIR = {
  name: "User",
  module: "users",
  scalarFields: [
    {
      prismaName: "id",
      rustName: "id",
      type: { kind: "scalar", rust: "String", eq: true, copy: false },
      optional: false,
      list: false,
      isFk: false,
      isId: true,
      isUnique: true,
      hasDefault: true,
      docs: [],
      serdeRenameOverride: null,
    },
    {
      prismaName: "score",
      rustName: "score",
      type: { kind: "scalar", rust: "i32", eq: true, copy: true },
      optional: false,
      list: false,
      isFk: false,
      isId: false,
      isUnique: false,
      hasDefault: false,
      docs: [],
      serdeRenameOverride: null,
    },
    {
      prismaName: "meta",
      rustName: "meta",
      type: { kind: "scalar", rust: "serde_json::Value", eq: false, copy: false },
      optional: false,
      list: false,
      isFk: false,
      isId: false,
      isUnique: false,
      hasDefault: false,
      docs: [],
      serdeRenameOverride: null,
    },
  ],
  relations: [],
  idFields: ["id"],
  uniqueGroups: [],
  docs: [],
};

describe("emitAggregateInputs", () => {
  it("emits Count with all scalar fields + _all rename", () => {
    const out = emitAggregateInputs(model, { serde: true, vis: "pub" });
    expect(out).toContain("pub struct UserCountAggregateInput {");
    expect(out).toContain("pub id: Option<bool>,");
    expect(out).toContain("pub score: Option<bool>,");
    expect(out).toContain("pub meta: Option<bool>,");
    expect(out).toContain(`#[serde(rename = "_all")]`);
    expect(out).toContain("pub aggregate_all: Option<bool>,");
  });
  it("emits Avg/Sum only for numeric scalars", () => {
    const out = emitAggregateInputs(model, { serde: true, vis: "pub" });
    expect(out).toContain("pub struct UserAvgAggregateInput {");
    expect(out).toContain("pub score: Option<bool>,");
    // id is String (non-numeric) — should not appear in Avg
    const avgBlock = out.split("pub struct UserAvgAggregateInput")[1]!.split("pub struct")[0]!;
    expect(avgBlock).not.toContain("pub id:");
    expect(avgBlock).not.toContain("pub meta:");
  });
  it("emits Min/Max for orderable scalars, excluding Json", () => {
    const out = emitAggregateInputs(model, { serde: true, vis: "pub" });
    const minBlock = out.split("pub struct UserMinAggregateInput")[1]!.split("pub struct")[0]!;
    expect(minBlock).toContain("pub id: Option<bool>,");
    expect(minBlock).toContain("pub score: Option<bool>,");
    expect(minBlock).not.toContain("pub meta:");
  });
  it("emits OrderByWithAggregationInput with _count/_avg/etc sub-inputs", () => {
    const out = emitAggregateInputs(model, { serde: true, vis: "pub" });
    expect(out).toContain("pub struct UserOrderByWithAggregationInput {");
    expect(out).toContain(`#[serde(rename = "_count")]`);
    expect(out).toContain("pub aggregate_count: Option<UserCountAggregateInput>,");
  });
});
