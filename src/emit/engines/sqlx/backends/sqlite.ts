import type { Backend } from "../backend.js";

export const SQLITE: Backend = {
  engine: "sqlx-sqlite",
  dirName: "sqlx_sqlite",
  dbType: "sqlx::Sqlite",
  rowType: "sqlx::sqlite::SqliteRow",
  identQuote: '"',
  arrayIn: "IN_LIST",
  caseInsensitiveLike: "LOWER_LIKE",
  castToDouble: (expr) => `CAST(${expr} AS REAL)`,
  castToBigInt: (expr) => `CAST(${expr} AS INTEGER)`,
  enumStorage: "text",
  // sqlx 0.8 does not provide `sqlx::Type<Sqlite>` / `Encode` / `Decode`
  // for `rust_decimal::Decimal` or `bigdecimal::BigDecimal`. Schemas
  // with Decimal columns still compile (the IR / model struct still
  // carries the type), but the engine omits Decimal filter pushers and
  // Avg/Sum aggregate result fields to keep the generated crate
  // compiling.
  scalarFamilies: new Set([
    "uuid",
    "string",
    "int",
    "bigint",
    "float",
    "datetime",
    "bool",
    "bytes",
    "json",
  ]),
  writeStrategy: "returning",
  insertedIdStrategy: () => "unsupported",
};
