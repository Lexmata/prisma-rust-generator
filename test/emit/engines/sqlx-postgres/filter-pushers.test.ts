import { describe, expect, it } from "vitest";
import { emitFilterPushers } from "../../../../src/emit/engines/sqlx-postgres/filter-pushers.js";
import type { EnumIR, IR } from "../../../../src/ir/types.js";

const SCALAR_FAMILIES = [
  "uuid",
  "string",
  "int",
  "bigint",
  "float",
  "decimal",
  "datetime",
  "bool",
  "bytes",
  "json",
] as const;

const ORDERABLE_FAMILIES: ReadonlySet<string> = new Set([
  "string",
  "int",
  "bigint",
  "float",
  "decimal",
  "datetime",
]);

const NON_ORDERABLE_FAMILIES = ["bool", "bytes", "json"] as const;

const roleEnum: EnumIR = {
  name: "Role",
  module: "auth",
  variants: [
    { prismaName: "Admin", rustName: "Admin", serdeRename: null, docs: [] },
    { prismaName: "Member", rustName: "Member", serdeRename: null, docs: [] },
  ],
  docs: [],
  eqEligible: true,
};

const emptyIr: IR = {
  models: [],
  enums: [],
  modelEqEligibility: new Map(),
  inputCycles: new Set(),
  schemaEdition: "2021",
};

const irWithRole: IR = {
  ...emptyIr,
  enums: [roleEnum],
};

describe("emitFilterPushers (sqlx-postgres)", () => {
  it("emits one push_<family>_filter for every scalar family", () => {
    const out = emitFilterPushers(emptyIr);
    for (const family of SCALAR_FAMILIES) {
      expect(out).toContain(`pub(crate) fn push_${family}_filter(`);
    }
  });

  it("emits one push_<family>_nullable_filter for every scalar family", () => {
    const out = emitFilterPushers(emptyIr);
    for (const family of SCALAR_FAMILIES) {
      expect(out).toContain(`pub(crate) fn push_${family}_nullable_filter(`);
    }
  });

  it("emits both LIKE and ILIKE paths in the string pusher", () => {
    const out = emitFilterPushers(emptyIr);
    // Pull out just the string pusher to scope our assertions.
    const start = out.indexOf("pub(crate) fn push_string_filter(");
    const end = out.indexOf("pub(crate) fn push_string_nullable_filter(");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = out.slice(start, end);
    expect(body).toContain('"ILIKE"');
    expect(body).toContain('"LIKE"');
    expect(body).toContain("QueryMode::Insensitive");
    expect(body).toContain("LOWER(");
  });

  it("does NOT emit lt/lte/gt/gte branches for non-orderable scalar families", () => {
    const out = emitFilterPushers(emptyIr);
    for (const family of NON_ORDERABLE_FAMILIES) {
      const start = out.indexOf(`pub(crate) fn push_${family}_filter(`);
      const end = out.indexOf(`pub(crate) fn push_${family}_nullable_filter(`);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const body = out.slice(start, end);
      expect(body).not.toContain("&f.lt");
      expect(body).not.toContain("&f.lte");
      expect(body).not.toContain("&f.gt");
      expect(body).not.toContain("&f.gte");
    }
  });

  it("emits lt/lte/gt/gte branches for orderable scalar families", () => {
    const out = emitFilterPushers(emptyIr);
    for (const family of SCALAR_FAMILIES) {
      if (!ORDERABLE_FAMILIES.has(family)) continue;
      const start = out.indexOf(`pub(crate) fn push_${family}_filter(`);
      const end = out.indexOf(`pub(crate) fn push_${family}_nullable_filter(`);
      const body = out.slice(start, end);
      expect(body).toContain("&f.lt");
      expect(body).toContain("&f.lte");
      expect(body).toContain("&f.gt");
      expect(body).toContain("&f.gte");
    }
  });

  it("emits a push_<snake_enum>_filter for each enum in the IR", () => {
    const out = emitFilterPushers(irWithRole);
    expect(out).toContain("pub(crate) fn push_role_filter(");
    // *Filter for enums lives in the per-module file where the enum is defined,
    // not in the shared filters module — qualify with the full crate path.
    expect(out).toContain("f: &crate::auth::RoleFilter");
  });

  it("emits a push_<snake_enum>_nullable_filter with an is_null branch", () => {
    const out = emitFilterPushers(irWithRole);
    expect(out).toContain("pub(crate) fn push_role_nullable_filter(");
    const start = out.indexOf("pub(crate) fn push_role_nullable_filter(");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = out.slice(start);
    expect(body).toContain("f.is_null");
    expect(body).toContain("IS NULL");
    expect(body).toContain("IS NOT NULL");
  });

  it("emits is_null handling in every nullable scalar pusher", () => {
    const out = emitFilterPushers(emptyIr);
    for (const family of SCALAR_FAMILIES) {
      const start = out.indexOf(`pub(crate) fn push_${family}_nullable_filter(`);
      expect(start).toBeGreaterThanOrEqual(0);
      // Slice to the next top-level fn declaration (or end of file).
      const next = out.indexOf("\npub(crate) fn ", start + 1);
      const body = next === -1 ? out.slice(start) : out.slice(start, next);
      expect(body).toContain("f.is_null");
      expect(body).toContain("IS NULL");
      expect(body).toContain("IS NOT NULL");
    }
  });

  it("uses = ANY($bind) for r#in and <> ALL($bind) for not_in", () => {
    const out = emitFilterPushers(emptyIr);
    expect(out).toContain('"{col} = ANY("');
    expect(out).toContain('"{col} <> ALL("');
  });

  it("emits a FALSE short-circuit for empty r#in lists", () => {
    const out = emitFilterPushers(emptyIr);
    expect(out).toContain('"FALSE"');
  });
});
