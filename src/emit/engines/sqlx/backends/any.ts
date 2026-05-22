import type { Backend } from "../backend.js";

// `sqlx::Any` is sqlx's runtime-pluggable database backend. It accepts any
// of the per-database drivers at runtime (Postgres, MySQL, SQLite) but only
// provides `sqlx::Type` / `Encode` / `Decode` impls for the cross-driver
// intersection: bool, i16, i32, i64, f32, f64, String, Vec<u8>. There are
// no `Any` impls for `chrono::DateTime`, `uuid::Uuid`, `rust_decimal::Decimal`,
// or `serde_json::Value`, so schemas using those families still get the
// model struct field but no engine-side filter pushers or aggregate result
// surface for them.
export const ANY: Backend = {
  engine: "sqlx-any",
  dirName: "sqlx_any",
  dbType: "sqlx::Any",
  rowType: "sqlx::any::AnyRow",
  // `"` is the most portable: Postgres + SQLite accept it, and MySQL accepts
  // it when ANSI_QUOTES is set. `sqlx::Any` can't know at compile time which
  // driver is active, so we pick the widest-compatible quote.
  identQuote: '"',
  // `= ANY($1)` is Postgres-specific; expand to `IN (?, ?, ?)` for portability.
  arrayIn: "IN_LIST",
  // ILIKE is Postgres-only.
  caseInsensitiveLike: "LOWER_LIKE",
  // `CAST(x AS REAL)` is the most portable double cast (works on Postgres,
  // SQLite, and MySQL).
  castToDouble: (expr) => `CAST(${expr} AS REAL)`,
  // `INTEGER` is the safer choice across Any's three drivers — MySQL accepts
  // both INTEGER and BIGINT, SQLite uses INTEGER as its widest integer
  // affinity, and Postgres accepts INTEGER.
  castToBigInt: (expr) => `CAST(${expr} AS INTEGER)`,
  // No native enum on `Any`; round-trip through `String` like sqlite does.
  enumStorage: "text",
  // `Any` impls cover only the cross-driver intersection. uuid, datetime,
  // decimal, and json have no `sqlx::Type<Any>` impls in sqlx 0.8 — schemas
  // using those families still emit model code, but the engine omits the
  // corresponding filter pushers and Avg/Sum aggregate result fields to keep
  // the generated crate compiling.
  scalarFamilies: new Set(["string", "int", "bigint", "float", "bool", "bytes"]),
  // No portable RETURNING across Any's drivers.
  writeStrategy: "requery",
  insertedIdStrategy(defaultKind) {
    // `sqlx::any::AnyQueryResult` exposes `last_insert_id() -> Option<i64>`,
    // matching the MySQL backend's policy for autoincrement ids.
    if (defaultKind === "autoincrement") return "last-insert-id";
    if (defaultKind === "uuid" || defaultKind === "cuid") return "client-generated";
    return "unsupported";
  },
};
