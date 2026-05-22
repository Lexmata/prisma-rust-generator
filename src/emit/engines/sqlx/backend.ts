// Per-backend knobs for the shared sqlx emitter. Each backend supplies
// the syntactic divergence points between Postgres and SQLite (and
// future MySQL). See docs/superpowers/specs/2026-05-21-engine-sqlx-sqlite.md
// section 2 for the full design.

import type { DefaultKind } from "../../../ir/types.js";

export interface Backend {
  // Engine variant key — matches cfg.engine for this backend.
  readonly engine: "sqlx-postgres" | "sqlx-sqlite" | "sqlx-mysql" | "sqlx-any";

  // Generated output directory name under `engine/`. Always snake_case
  // (Rust module convention). `sqlx_postgres` / `sqlx_sqlite` /
  // `sqlx_mysql` / `sqlx_any`.
  readonly dirName: string;

  // Rust path of the sqlx database type used in trait bounds:
  //   E: sqlx::Executor<'_, Database = <dbType>>
  //   sqlx::QueryBuilder<'_, <dbType>>
  readonly dbType: string;

  // Rust path of the row type used in FromRow impls.
  readonly rowType: string;

  // Identifier-quote character. Postgres + SQLite accept `"`; future
  // MySQL will be backtick.
  readonly identQuote: '"' | "`";

  // Array-binding strategy for `r#in` / `not_in` branches in the WHERE
  // translator.
  //   "ANY"     — Postgres: bind the whole Vec via `= ANY($1)`.
  //   "IN_LIST" — SQLite: emit one placeholder per element via `IN (?, ?, ?)`.
  readonly arrayIn: "ANY" | "IN_LIST";

  // Case-insensitive LIKE strategy.
  //   "ILIKE"      — Postgres: emit ILIKE directly.
  //   "LOWER_LIKE" — SQLite: emit `LOWER(col) LIKE LOWER(?)`.
  readonly caseInsensitiveLike: "ILIKE" | "LOWER_LIKE";

  // Aggregation cast helpers. Postgres uses `::double precision`;
  // SQLite uses `CAST(x AS REAL)`.
  readonly castToDouble: (expr: string) => string;
  readonly castToBigInt: (expr: string) => string;

  // Prisma enum storage strategy.
  //   "native" — Postgres: emit `#[derive(sqlx::Type)]` targeting the
  //              database enum type.
  //   "text"   — SQLite: emit explicit `Type` / `Decode` / `Encode`
  //              impls that round-trip through &str / String using the
  //              enum's source variant name.
  readonly enumStorage: "native" | "text";

  // Scalar filter families this backend supports. sqlx's per-database
  // type impls vary — SQLite lacks `rust_decimal::Decimal` /
  // `bigdecimal::BigDecimal` impls, for example. Families omitted here
  // are skipped by `filter-pushers.ts` (no pusher emitted) and by
  // `aggregate.ts` (no Avg/Sum result fields). A schema that uses an
  // unsupported family on this backend will still compile, but the
  // engine-side filter/aggregate surface for that family is absent.
  // Postgres supports all of: uuid, string, int, bigint, float,
  // decimal, datetime, bool, bytes, json (plus enums via native).
  // SQLite supports all of those except decimal.
  readonly scalarFamilies: ReadonlySet<string>;

  // Write-result strategy. Postgres + SQLite use RETURNING to fetch
  // the affected row in one round-trip; MySQL has no portable
  // RETURNING so writes emit an INSERT/UPDATE/DELETE followed by a
  // find_unique fetch.
  //   "returning" — append `RETURNING <cols>` to INSERT/UPDATE/DELETE
  //   "requery"   — issue a follow-up SELECT via find_unique
  readonly writeStrategy: "returning" | "requery";

  // How to discover a freshly-inserted row's id when writeStrategy is
  // "requery". Called per @id field at emit time. Backends that never
  // hit this path (Postgres, SQLite — returning short-circuits)
  // return "unsupported" uniformly.
  //   "last-insert-id"   — call sqlx::Executor::last_insert_id().
  //   "client-generated" — generate the id client-side BEFORE the
  //                        INSERT and inject it into the column list.
  //   "unsupported"      — emit todo!() and document the limitation.
  insertedIdStrategy(
    defaultKind: Extract<DefaultKind, "autoincrement" | "uuid" | "cuid">,
  ): "last-insert-id" | "client-generated" | "unsupported";
}
