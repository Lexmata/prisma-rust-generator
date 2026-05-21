# prisma-rust-generator

A [Prisma](https://www.prisma.io/) generator that emits bare Rust types — model
structs, enums, filters, and the full Prisma input surface (`Where`,
`WhereUnique`, `OrderBy`, `Select`, `Include`, `Create*`, `Update*`,
nested-relation inputs, scalar field-update ops, aggregation inputs).

The generated code is **ORM-agnostic**. It's just data: structs, enums, and
filter ASTs. You translate filters to SQL with whichever Rust library you like
(sqlx, sea-query, raw SQL, etc.).

Concrete integration walkthroughs — connecting, reading rows into model
structs, writing from `UncheckedCreateInput`, translating the filter AST
to the target's native query shape:

- [sqlx](https://github.com/Lexmata/prisma-rust-generator/blob/main/docs/sqlx.md)
  — the comprehensive guide; Postgres, MySQL, SQLite via `QueryBuilder`
  with compile-checked queries for fixed shapes
- [raw Postgres (tokio-postgres)](https://github.com/Lexmata/prisma-rust-generator/blob/main/docs/raw-postgres.md)
- [raw MySQL / MariaDB (mysql_async)](https://github.com/Lexmata/prisma-rust-generator/blob/main/docs/raw-mysql.md)
- [raw SQLite (rusqlite)](https://github.com/Lexmata/prisma-rust-generator/blob/main/docs/raw-sqlite.md)
- [raw MongoDB (mongodb)](https://github.com/Lexmata/prisma-rust-generator/blob/main/docs/raw-mongodb.md)

## Install

```bash
pnpm add -D prisma @lexmata/prisma-rust-generator
```

## Use

In your `schema.prisma`:

```prisma
generator rust {
  provider = "node ./node_modules/@lexmata/prisma-rust-generator/dist/index.js"
  output   = "../rust-out/src"
}
```

Then `pnpm prisma generate`.

## Generated shape

For a schema like:

```prisma
model User {
  id     String @id @db.Uuid
  email  String @unique
  firm   Firm   @relation(fields: [firmId], references: [id])
  firmId String @db.Uuid
  posts  Post[]
}
```

You get (in `users.rs`):

```rust
pub struct User {
    pub id: uuid::Uuid,
    pub email: String,
    pub firm_id: uuid::Uuid,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub firm: Option<Box<crate::firms::Firm>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub posts: Vec<crate::posts::Post>,
}

pub struct UserWhereInput {
    pub id: Option<crate::shared::filters::UuidFilter>,
    pub email: Option<crate::shared::filters::StringFilter>,
    pub firm_id: Option<crate::shared::filters::UuidFilter>,
    pub firm: Option<crate::firms::FirmRelationFilter>,
    pub posts: Option<crate::posts::PostListRelationFilter>,
    #[serde(rename = "AND")] pub and: Option<Vec<UserWhereInput>>,
    #[serde(rename = "OR")]  pub or:  Option<Vec<UserWhereInput>>,
    #[serde(rename = "NOT")] pub not: Option<Vec<UserWhereInput>>,
}

pub struct UserCreateInput { /* scalars + nested-relation creates */ }
pub struct UserUpdateInput { /* scalars wrapped in *FieldUpdateOperationsInput */ }
// ...plus WhereUniqueInput, OrderByWithRelationInput, Select, Include,
// UncheckedCreate*, UncheckedUpdate*, CreateMany*, UpdateMany*, and the
// full set of nested-relation inputs (CreateNestedOne/Many, UpdateNested,
// Upsert, CreateOrConnect, UpdateWithWhereUnique, ScalarWhere, etc.)
```

## Options

```prisma
generator rust {
  provider = "node ./node_modules/@lexmata/prisma-rust-generator/dist/index.js"
  output   = "./src"

  outputLayout     = "per-file"        // "per-file" | "per-model" | "single"
  moduleName       = ""                 // emit mod.rs instead of lib.rs when set
  moduleVisibility = "pub"              // "pub" | "pub(crate)"
  dateTimeCrate    = "chrono"           // "chrono" | "time"
  decimalCrate     = "rust_decimal"     // "rust_decimal" | "bigdecimal"
  uuidFromDbUuid   = "true"             // String @db.Uuid → uuid::Uuid
  bytesCrate       = "std"              // "std" | "bytes"
  jsonCrate        = "serde_json"       // "serde_json" | "string"
  serde            = "true"             // emit Serialize/Deserialize derives
  engine           = ""                  // "" | "sqlx-postgres" | "sqlx-sqlite" — see "Engine"
  edition          = "2021"             // "2021" | "2024" (passed to rustfmt)
  runRustfmt       = "true"
  requireRustfmt   = "true"
  rustfmtBinary    = "rustfmt"
  concurrency      = "8"                // worker pool size
  rustfmtShardSize = "16"
}
```

## Engine (pre-generated integration layer)

Set `engine = "sqlx-postgres"` or `engine = "sqlx-sqlite"` to add a
parallel `engine/<backend>/` subtree to the generated output. Each
model gains inherent methods that implement the full CRUD +
aggregation surface on top of `sqlx`'s `QueryBuilder`:

```rust
use rust_out::users::{User, UserWhereInput, UserWhereUniqueInput,
    UserUncheckedCreateInput, UserUncheckedUpdateInput, UserAggregateInput};

let users: Vec<User> = User::find_many(&pool, &where_input)
    .order_by(&[...])
    .take(50)
    .exec()
    .await?;

let one: Option<User> = User::find_unique(&pool, &where_unique).await?;
User::create(&pool, create_input).await?;
User::update(&pool, &where_unique, update_input).await?;
User::delete(&pool, &where_unique).await?;
let n: i64 = User::count(&pool, Some(&where_input)).await?;
let agg = User::aggregate(&pool, &agg_input).await?;
```

Methods are reachable directly on the model struct — no need to
`use rust_out::engine::*`. Every method takes
`E: sqlx::Executor<'e, Database = <Postgres or Sqlite>>`, so the same
surface works against the backend's pool, connection, and transaction
handles.

The engine field is opt-in; default-unset preserves the ORM-agnostic
output bit-for-bit. Supported with `outputLayout = "per-file"`
(default) or `"per-model"`; combining with `outputLayout = "single"`
raises a config validation error.

### Required `Cargo.toml` deps

`engine = "sqlx-postgres"`:

```toml
sqlx = { version = "0.8", default-features = false, features = [
  "runtime-tokio", "postgres",
  "uuid", "chrono", "json", "rust_decimal",
  "macros",
] }
```

`engine = "sqlx-sqlite"`:

```toml
sqlx = { version = "0.8", default-features = false, features = [
  "runtime-tokio", "sqlite",
  "uuid", "chrono", "json", "rust_decimal",
  "macros",
] }
```

### SQLite specifics

- **No native enums.** Prisma's SQLite connector rejects `enum`
  declarations entirely (P1012). Use a `String` field instead and
  validate at the application layer.
- **No native UUID / Decimal / Timestamptz columns.** UUIDs and
  datetimes round-trip as TEXT via the corresponding sqlx feature
  flags. `Decimal` has no `sqlx::Type<Sqlite>` impl in sqlx 0.8 — the
  engine still emits the model struct field, but skips the engine-side
  filter pusher and Avg/Sum aggregate result for Decimal columns on
  sqlite. Application-side filtering on Decimal columns still works
  via raw sqlx; the engine just doesn't help.
- **`IN_LIST` instead of `= ANY(...)`** — SQLite has no array
  binding, so `r#in` / `not_in` branches emit
  `IN (?, ?, ?)` with one placeholder per element.
- **`LOWER(col) LIKE LOWER(?)` instead of `ILIKE`** — SQLite has no
  ILIKE; `QueryMode::Insensitive` flows through `LOWER()` wrapping for
  unicode-aware case-insensitive matching.

The five integration guides ([sqlx](docs/sqlx.md),
[raw-postgres](docs/raw-postgres.md), etc.) remain useful as
reference — they document the same translation strategy the engine
emitter applies, plus per-target dialect notes.

## Skipping generation

Wire a `skip` field on the generator block to bypass Rust emission
without removing the generator from `schema.prisma`. Useful in CI when
the generated code is already committed, or when running `prisma
generate` purely to refresh the JS client.

```prisma
generator rust {
  provider = "node ./node_modules/@lexmata/prisma-rust-generator/dist/index.js"
  output   = "./src"
  skip     = env("PRISMA_RUST_GENERATOR_SKIP")
}
```

Then in CI / your shell:

```bash
PRISMA_RUST_GENERATOR_SKIP=1 pnpm prisma generate
```

Prisma resolves `env()` before invoking the generator, so the value of
the chosen env var lands as the `skip` config value. The env var name
is up to you — pick whatever fits your conventions.

Truthy values that trigger skip: `1`, `true`, `yes`, `on`, or any other
non-empty string. Falsy values that do NOT skip: empty string, `0`,
`false`, `no`, `off` (case-insensitive). Unset env var → Prisma passes
`undefined`, which also does not skip.

You can also hard-code `skip = "true"` for a permanent opt-out, but
that's rarely what you want.

## Guarantees

Generated output passes:

- `cargo fmt --check`
- `cargo clippy -- -D warnings` (on the default lint groups: correctness +
  suspicious + style + complexity + perf)

Pedantic / nursery / restriction lint groups are **not** supported targets —
add `#![allow(...)]` on your side if you enable them.

## Required Rust crates

For the default config, add to your consumer `Cargo.toml`:

```toml
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["serde"] }
chrono = { version = "0.4", features = ["serde"] }
rust_decimal = { version = "1", features = ["serde"] }
```

Swap crates as your `*Crate` options dictate (`time` instead of `chrono`,
`bigdecimal` instead of `rust_decimal`, etc.).

## Type mapping

| Prisma | Native | `chrono` default | `time` default |
|---|---|---|---|
| `String` | — | `String` | `String` |
| `String` | `@db.Uuid` | `uuid::Uuid` | `uuid::Uuid` |
| `Int` | — | `i32` | `i32` |
| `Int` | `@db.SmallInt` | `i16` | `i16` |
| `Int` | `@db.Oid` | `u32` | `u32` |
| `BigInt` | — | `i64` | `i64` |
| `Float` | — | `f64` | `f64` |
| `Float` | `@db.Real` | `f32` | `f32` |
| `Decimal` | — | `rust_decimal::Decimal` | `rust_decimal::Decimal` |
| `Boolean` | — | `bool` | `bool` |
| `DateTime` | — / `@db.Timestamptz` | `chrono::DateTime<chrono::Utc>` | `time::OffsetDateTime` |
| `DateTime` | `@db.Timestamp` | `chrono::NaiveDateTime` | `time::PrimitiveDateTime` |
| `DateTime` | `@db.Date` | `chrono::NaiveDate` | `time::Date` |
| `DateTime` | `@db.Time` | `chrono::NaiveTime` | `time::Time` |
| `Json` | — | `serde_json::Value` | `serde_json::Value` |
| `Bytes` | — | `Vec<u8>` | `Vec<u8>` |

Modifiers compose: `T?` → `Option<T>`, `T[]` → `Vec<T>`.

## Schema support

Verified end-to-end against the full 80-model lexmata-models schema (17
.prisma files, hundreds of relations including multi-relations through the
same model pair) plus focused fixtures covering scalar mapping, enums,
relations, Rust keyword field names, and the time-crate option matrix.

If your schema uses the `prismaSchemaFolder` preview feature with custom
generators inline, strip the input you pass to the DMMF parser to just
`datasource` + `model`/`enum` blocks; preview-feature config blocks are
not part of the data model.

## Status

Pre-1.0 — the emission format may change between minor versions. Once the
generator hits 1.0, any change to generated source is a major-version bump
with a migration note in `CHANGELOG.md`.

## License

MIT
