import type { Backend } from "./backend.js";

// Wrap a SQL identifier (column or table name) in the backend's quote
// character. Both Postgres and SQLite use `"`; MySQL would use
// backtick. The name itself is assumed already safe — it comes from
// the IR's dbName which is either Prisma's schema-validated name or
// an @map override (which Prisma also validates).
export function quoteIdent(backend: Backend, name: string): string {
  return `${backend.identQuote}${name}${backend.identQuote}`;
}
