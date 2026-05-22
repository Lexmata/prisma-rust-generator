import type { Backend } from "../backend.js";

export const POSTGRES: Backend = {
  engine: "sqlx-postgres",
  dirName: "sqlx_postgres",
  dbType: "sqlx::Postgres",
  rowType: "sqlx::postgres::PgRow",
  identQuote: '"',
  arrayIn: "ANY",
  caseInsensitiveLike: "ILIKE",
  castToDouble: (expr) => `${expr}::double precision`,
  castToBigInt: (expr) => `${expr}::bigint`,
  enumStorage: "native",
  scalarFamilies: new Set([
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
  ]),
  writeStrategy: "returning",
  insertedIdStrategy: () => "unsupported",
};
