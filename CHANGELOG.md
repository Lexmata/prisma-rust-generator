# Changelog

Pre-1.0: the emission format may change between minor versions. Each
release section below lists user-visible changes to generated Rust
output along with a migration note. After 1.0, any change to generated
source will be a major-version bump.

## Unreleased

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
