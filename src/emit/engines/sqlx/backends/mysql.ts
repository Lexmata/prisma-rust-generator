import type { Backend } from "../backend.js";

export const MYSQL: Backend = {
  engine: "sqlx-mysql",
  dirName: "sqlx_mysql",
  dbType: "sqlx::MySql",
  rowType: "sqlx::mysql::MySqlRow",
  identQuote: "`",
  arrayIn: "IN_LIST",
  caseInsensitiveLike: "LOWER_LIKE",
  castToDouble: (expr) => `CAST(${expr} AS DOUBLE)`,
  castToBigInt: (expr) => `CAST(${expr} AS SIGNED)`,
  enumStorage: "text",
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
  writeStrategy: "requery",
  insertedIdStrategy(defaultKind) {
    if (defaultKind === "autoincrement") return "last-insert-id";
    if (defaultKind === "uuid" || defaultKind === "cuid") return "client-generated";
    return "unsupported";
  },
};
