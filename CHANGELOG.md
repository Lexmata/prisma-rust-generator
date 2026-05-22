# Changelog

Pre-1.0: the emission format may change between minor versions. Each
release section below lists user-visible changes to generated Rust
output along with a migration note. After 1.0, any change to generated
source will be a major-version bump.

## Unreleased

### Fixed

- `defaultKindFor()` (in `src/ir/build.ts`) now strips the `(N)`
  version suffix Prisma 5.x emits for parameterized UUID/CUID
  defaults (e.g. `uuid(4)`, `uuid(7)`, `cuid(2)`) before matching
  against the known function names. Previously the bare `"uuid"` /
  `"cuid"` match missed the parameterized forms — the kind landed
  in `"other"`, which made the sqlx-mysql write path believe an
  `@id @default(uuid())` value was user-supplied and try to read
  `input.id` (which is absent from `*UncheckedCreateInput`). Postgres
  + SQLite are unaffected (they ignore `defaultKind`).

### Internal

- `FieldIR` gains `defaultKind: DefaultKind | null` populated from
  DMMF, exposing Prisma's `@default(uuid()|cuid()|autoincrement()|now()|…)`
  kind to the engine emitter. Postgres + SQLite ignore it; the
  sqlx-mysql variant uses it to pick the post-INSERT id-discovery
  strategy.
- `Backend` interface gains `writeStrategy: "returning" | "requery"`
  and an `insertedIdStrategy(defaultKind)` method. POSTGRES + SQLITE
  remain `"returning"` (no behavior change).
- `src/emit/engines/sqlx/writes.ts` now branches on
  `backend.writeStrategy`. The `"requery"` path emits
  create/update/delete bodies that take `A: sqlx::Acquire<'e, _>`
  (instead of `E: sqlx::Executor<'e, _>`) and follow the
  INSERT/UPDATE/DELETE with a `find_unique` over the same connection.
  Postgres + SQLite stay on the v0.3.0 `RETURNING` shape — no output
  diff for those backends.
- The sqlx-mysql `create()` body now elides the
  `..Default::default()` struct-update tail on the trailing
  `find_unique(&Self::WhereUniqueInput { id: Some(id), … })` when
  the WhereUniqueInput has exactly one field. Clippy's
  `needless_update` lint fires on the tail in that case, so the
  emitter only emits it for models with extra `@unique` / `@@unique`
  scalars.

## 0.3.0 — 2026-05-21

### Added

- **`engine = "sqlx-sqlite"`** as the second backend variant. Generated
  Rust uses `sqlx::Sqlite` type bounds, `sqlx::sqlite::SqliteRow` rows,
  `IN (?, ?, ?)` placeholders for array binding,
  `LOWER(col) LIKE LOWER(?)` for case-insensitive matching, and
  `CAST(... AS REAL)` / `CAST(... AS INTEGER)` aggregate casts.
  Supported on `outputLayout = "per-file"` (default) and `"per-model"`;
  combining with `"single"` raises a config validation error (same as
  `sqlx-postgres`).
  - **Decimal limitation.** sqlx 0.8 provides no
    `sqlx::Type<Sqlite>`/`Encode`/`Decode` for `rust_decimal::Decimal`
    or `bigdecimal::BigDecimal`. Decimal fields still appear in the
    model struct and `*WhereInput`, but the engine skips filter
    pushers and Avg/Sum aggregate result fields for them on sqlite.
  - **No enums.** Prisma's sqlite connector rejects `enum`
    declarations (P1012); use `String` columns and application-layer
    validation. The engine's `enumStorage = "text"` emission path
    (explicit `sqlx::Type`/`Decode`/`Encode` impls) is wired and
    unit-tested but unreachable until Prisma's sqlite support lands.

### Internal

- Refactored `src/emit/engines/sqlx-postgres/` into a shared
  `src/emit/engines/sqlx/` emitter family parameterized by a `Backend`
  value. The Postgres backend (under `backends/postgres.ts`) reproduces
  v0.2.0 output bit-for-bit. Future backends (e.g. `sqlx-mysql`) plug
  in as additional Backend impls without touching the shared emitter.
- `Backend` interface adds `scalarFamilies: ReadonlySet<string>`
  declaring which scalar filter families a backend supports. Drives
  conditional emission in `filter-pushers.ts` and `where-translator.ts`
  so backends like sqlite (no Decimal) can compile their generated
  crate without dragging in unsupported impls.

## 0.2.0 — 2026-05-21

### Added

- Optional `engine = "sqlx-postgres"` generator block field. When set,
  the per-file layout emits an additional `engine/sqlx_postgres/`
  subtree alongside the ORM-agnostic types: per-model `sqlx::FromRow`
  impls, `*WhereInput` → `QueryBuilder` translators (with EXISTS
  subqueries for relation filters and `and`/`or`/`not` recursion), one
  `push_<family>_filter` and `push_<family>_nullable_filter` per scalar
  family + Prisma enum, a `find_unique` / `find_first` / `find_many`
  builder family, `count`, `create` / `create_many` / `update` /
  `update_many` / `delete` / `delete_many`, and `aggregate` per model.
  Prisma enums also get `sqlx::Type` / `Decode` / `Encode` /
  `PgHasArrayType` impls so they can round-trip through Postgres enum
  columns. Supported on `outputLayout = "per-file"` (default) and
  `"per-model"`; combining with `outputLayout = "single"` raises a
  config validation error.
- `<M>AggregateInput` struct (and matching `<M>AggregateResult` in the
  engine module) — top-level bundle that pairs an optional `WhereInput`
  with the five `_count`/`_avg`/`_sum`/`_min`/`_max` selector inputs,
  consumed by the sqlx-postgres `aggregate` method. Count returns
  `Option<i64>` per scalar (plus `_all`); Avg/Sum flatten to
  `Option<f64>` (Postgres `AVG`/`SUM` are cast to `double precision`,
  trading Decimal precision for binding simplicity); Min/Max preserve
  the source column's Rust type wrapped in `Option<T>`.

### Fixed — generated output

- `*WhereUniqueInput` now always includes single-field `@id` columns.
  Previously only fields surfaced by DMMF's `uniqueIndexes`,
  `primaryKey` (composite `@@id`), or `@unique` were emitted, leaving
  models with a plain single-column `@id` and no `@unique` shipping an
  empty struct that couldn't address a row uniquely.
- `outputLayout = "per-model"` now resolves enum type paths through the
  layout's module resolver instead of the IR's source-file stem.
  Previously, generated code under per-model layout referenced enum
  filter and field-update types as `crate::<file_stem>::Role*` (where
  `<file_stem>` is the Prisma file name, e.g. `schema`), which never
  resolved because per-model puts enums under `crate::enums::<snake>`.
  Affected: `*WhereInput`, `*ScalarWhereInput`, `*UpdateInput`,
  `*UncheckedUpdateInput`, `*UpdateManyMutationInput`,
  `*UncheckedUpdateManyInput`, `*CreateInput`, `*UncheckedCreateInput`,
  `*CreateManyInput`, and the `*UpdateWithout*Input` nested variants.

### Breaking — generated output

- **`*Filter` / `*NullableFilter` types (per scalar family and per enum)
  switched from Rust enums to structs with optional fields.** The struct
  form lets consumers combine multiple operators on one filter (e.g.
  `equals` + `not_in` + `not` in a single expression) and matches
  Prisma's TS client conventions and the documentation in
  `docs/sqlx.md` / `docs/raw-*.md` (which previously documented the
  intended struct form, mismatched against the actual enum emission).
  - **Migration:** rewrite call sites that pattern-matched on filter
    variants. Before: `StringFilter::Equals("foo".to_string())`. After:
    `StringFilter { equals: Some("foo".to_string()), ..Default::default() }`.
  - `Default` is now derived on every `*Filter`/`*NullableFilter` to
    support the sparse-construction idiom above.
  - `Eq`/`Hash` are no longer derived on enum-target filter structs;
    they were artifacts of the old enum form.

## 0.1.2 — 2026-05-20

### Documentation

- `docs/sqlx.md`: comprehensive sqlx integration covering Postgres,
  MySQL/MariaDB, and SQLite — three `FromRow` strategies, fixed-shape
  compile-checked writes via `query!`, sparse updates with
  `QueryBuilder`, dynamic `*WhereInput` translation, dialect notes
  (placeholders, identifier quoting, case-insensitive matching), and a
  scalar-type-to-column-type cheat sheet.
- `docs/raw-postgres.md`: end-to-end guide for `tokio-postgres` —
  connecting, row → struct, writes from `UncheckedCreateInput`,
  sparse `UpdateInput` translation, and a worked `*WhereInput`
  translator emitting parameterized `WHERE` clauses.
- `docs/raw-mongodb.md`: MongoDB equivalent — driver setup with the
  `bson` feature flags that bridge the generator's default scalars,
  Mongo-specific `@map("_id")` notes, `*UpdateInput` → `$set/$inc/$mul`
  translation, and a `*WhereInput` → `bson::Document` translator.
- `docs/raw-sqlite.md`: `rusqlite` integration — `?n` placeholders,
  `IN (?, ?, ?)` patterns instead of `= ANY()`, and the LOWER-wrapping
  required for unicode-aware case-insensitive `LIKE`.
- `docs/raw-mysql.md`: `mysql_async` integration — backtick identifier
  quoting, positional `?` placeholders, `RETURNING`-support split
  between MariaDB 10.5+ and MySQL 8.x, collation-aware case sensitivity
  notes.

### Added

- `skip` field on the generator block in `schema.prisma`. Wire it
  through Prisma's `env()` function to gate Rust emission on an
  environment variable (the name is up to the consumer):
  ```prisma
  generator rust {
    ...
    skip = env("PRISMA_RUST_GENERATOR_SKIP")
  }
  ```
  When the resolved value is truthy (`1`, `true`, `yes`, `on`, or any
  non-empty string other than `0`/`false`/`no`/`off`, case-insensitive),
  the generator logs a notice on stderr and returns without emitting
  any Rust. Useful in CI flows that refresh the JS client without
  re-running Rust codegen.

## 0.1.1 — 2026-05-20

### Package name

- **npm package renamed**: `prisma-rust-generator` → `@lexmata/prisma-rust-generator`. The binary name, generator handler name, and `@generated by prisma-rust-generator` file marker are unchanged.
  - Migration in `schema.prisma`: update the `provider` path from `./node_modules/prisma-rust-generator/dist/index.js` to `./node_modules/@lexmata/prisma-rust-generator/dist/index.js`. Reinstall with `pnpm add -D @lexmata/prisma-rust-generator`.

## 0.1.0 — 2026-05-19

First tagged release. Sets the baseline emission shape that subsequent
0.x releases will iterate on. Notes below describe what the generated
Rust looks like as of this release; anyone who was tracking the
`develop` branch before this tag should diff their consumer code
against these points.

### Generated output

- **ORM-agnostic Rust types**: model structs, enums, scalar/enum/relation
  filters, and the full Prisma input surface — `Where`, `WhereUnique`,
  `OrderBy`, `Select`, `Include`, `Create*`, `Update*`, the nested
  relation inputs (`CreateNestedOne`/`Many`, `UpdateNested`, `Upsert`,
  `CreateOrConnect`, `UpdateWithWhereUnique`, `ScalarWhere`, etc.),
  per-scalar field-update operations, and aggregation inputs
  (`Count`/`Avg`/`Sum`/`Min`/`Max` + `OrderByWithAggregation`).
- **Three output layouts**: `per-file` (default — mirrors the source
  `.prisma` file structure), `per-model` (one file per model), and
  `single` (one big file).
- **Configurable crate mappings**: `chrono` ↔ `time` for `DateTime`,
  `rust_decimal` ↔ `bigdecimal` for `Decimal`, `std` ↔ `bytes` for
  `Bytes`, `serde_json` ↔ `string` for `Json`.
- **Output passes `cargo fmt --check`, `cargo clippy -- -D warnings`,
  and `cargo check`** on every fixture, including the 80-model
  lexmata stress fixture (17 .prisma files, hundreds of relations).

### Shape decisions worth knowing

- **Relation fields are `Option<Box<T>>`**, both at the top level of
  `*CreateInput` / `*UpdateInput` and inside nested `CreateWithout` /
  `UpdateWithout` bodies. Required for densely connected schemas:
  drop-check and serde-derive recursion overflow without the Box.
  Construction-side: wrap values in `Box::new(...)`.
- **`{Model}ScalarWhereInput` is emitted once per target model**, not
  per `(source, relation)` pair. References use the bare
  `{Model}ScalarWhereInput` name with no `Without*` infix.
- **Generated `lib.rs` (or `mod.rs`) carries
  `#![recursion_limit = "1024"]`** — required to compile densely
  connected schemas, harmless otherwise.

### Internal

- `computeEqEligibility` is an O(V+E) reverse-graph BFS over the
  relation graph.
- `scalarFilterRefFor` is the shared source of truth for filter-path
  resolution between `WhereInput` and `ScalarWhereInput` (exported from
  `src/emit/filters/model.ts`).
- `CRATE_RECURSION_LIMIT_ATTR` is the single source of truth for the
  crate recursion attribute (exported from `src/layout/header.ts`).
