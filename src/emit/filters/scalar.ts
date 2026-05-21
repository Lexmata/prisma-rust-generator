import { RustWriter } from "../rust-writer.js";
import type { GeneratorConfig } from "../../types.js";

export interface SharedFilterOpts {
  serde: boolean;
  vis: "pub" | "pub(crate)";
  cfg: GeneratorConfig;
}

interface FilterSpec {
  family: string;
  ty: string;
  /** Ordering operators (lt/lte/gt/gte) apply. */
  orderable: boolean;
  /** Whether `contains`/`starts_with`/`ends_with` and `mode` apply. */
  stringOps: boolean;
  /** Whether `mode: Option<QueryMode>` is emitted even outside stringOps (Uuid). */
  hasMode: boolean;
}

function buildSpecs(cfg: GeneratorConfig): readonly FilterSpec[] {
  const datetime =
    cfg.dateTimeCrate === "time" ? "time::OffsetDateTime" : "chrono::DateTime<chrono::Utc>";
  const decimal =
    cfg.decimalCrate === "bigdecimal" ? "bigdecimal::BigDecimal" : "rust_decimal::Decimal";
  const bytes = cfg.bytesCrate === "bytes" ? "bytes::Bytes" : "Vec<u8>";
  const json = cfg.jsonCrate === "string" ? "String" : "serde_json::Value";
  return [
    { family: "String", ty: "String", orderable: true, stringOps: true, hasMode: true },
    { family: "Int", ty: "i32", orderable: true, stringOps: false, hasMode: false },
    { family: "BigInt", ty: "i64", orderable: true, stringOps: false, hasMode: false },
    { family: "Float", ty: "f64", orderable: true, stringOps: false, hasMode: false },
    { family: "Decimal", ty: decimal, orderable: true, stringOps: false, hasMode: false },
    { family: "DateTime", ty: datetime, orderable: true, stringOps: false, hasMode: false },
    { family: "Uuid", ty: "uuid::Uuid", orderable: false, stringOps: false, hasMode: true },
    { family: "Bytes", ty: bytes, orderable: false, stringOps: false, hasMode: false },
    { family: "Bool", ty: "bool", orderable: false, stringOps: false, hasMode: false },
    { family: "Json", ty: json, orderable: false, stringOps: false, hasMode: false },
  ];
}

export function emitSharedScalarFilters(opts: SharedFilterOpts): string {
  const w = new RustWriter();
  const specs = buildSpecs(opts.cfg);
  for (const s of specs) {
    emitOne(w, s, false, opts);
    emitOne(w, s, true, opts);
    w.blank();
  }
  return w.toString();
}

// `*Filter` / `*NullableFilter` are emitted as structs of optional fields
// (mirroring Prisma's TS client and the docs in docs/sqlx.md / docs/raw-*.md).
// The struct shape lets consumers combine multiple operators on one filter
// (e.g. `equals` + `not_in` + `not` in a single expression). `Default` is
// derived so a sparse filter can be written as
// `StringFilter { equals: Some(..), ..Default::default() }`.
function emitOne(w: RustWriter, s: FilterSpec, nullable: boolean, opts: SharedFilterOpts): void {
  const name = nullable ? `${s.family}NullableFilter` : `${s.family}Filter`;
  const derives = ["Debug", "Clone", "Default", "PartialEq"];
  if (opts.serde) derives.push("Serialize", "Deserialize");
  w.deriveLine(derives);
  if (opts.serde) w.line(`#[serde(rename_all = "camelCase")]`);
  w.openStruct(opts.vis, name);

  // Always present: equals, in, not_in, not.
  // `in` is a Rust keyword, so we use the raw identifier `r#in` and rename
  // the serde wire-name explicitly back to `"in"` — `rename_all = camelCase`
  // alone is not guaranteed to strip the `r#` prefix across serde versions.
  w.field(`pub equals`, `Option<${s.ty}>`);
  if (opts.serde) w.line(`#[serde(rename = "in")]`);
  w.field(`pub r#in`, `Option<Vec<${s.ty}>>`);
  w.field(`pub not_in`, `Option<Vec<${s.ty}>>`);
  if (nullable) {
    w.field(`pub is_null`, `Option<bool>`);
  }
  if (s.orderable) {
    w.field(`pub lt`, `Option<${s.ty}>`);
    w.field(`pub lte`, `Option<${s.ty}>`);
    w.field(`pub gt`, `Option<${s.ty}>`);
    w.field(`pub gte`, `Option<${s.ty}>`);
  }
  if (s.stringOps) {
    w.field(`pub contains`, `Option<${s.ty}>`);
    w.field(`pub starts_with`, `Option<${s.ty}>`);
    w.field(`pub ends_with`, `Option<${s.ty}>`);
  }
  if (s.hasMode) {
    w.field(`pub mode`, `Option<QueryMode>`);
  }
  w.field(`pub not`, `Option<Box<${name}>>`);

  w.close();
}
