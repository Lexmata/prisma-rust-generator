# prisma-rust-generator

A [Prisma](https://www.prisma.io/) generator that emits bare Rust types — model
structs, enums, filters, and the full Prisma input surface (`Where`,
`WhereUnique`, `OrderBy`, `Select`, `Include`, `Create*`, `Update*`,
nested-relation inputs, scalar field-update ops, aggregation inputs).

The generated code is **ORM-agnostic**. It's just data: structs, enums, and
filter ASTs. You translate filters to SQL with whichever Rust library you like
(sqlx, sea-query, raw SQL, etc.).

## Install

```bash
pnpm add -D prisma prisma-rust-generator
```

## Use

In your `schema.prisma`:

```prisma
generator rust {
  provider = "node ./node_modules/prisma-rust-generator/dist/index.js"
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
  provider = "node ./node_modules/prisma-rust-generator/dist/index.js"
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
  edition          = "2021"             // "2021" | "2024" (passed to rustfmt)
  runRustfmt       = "true"
  requireRustfmt   = "true"
  rustfmtBinary    = "rustfmt"
  concurrency      = "8"                // worker pool size
  rustfmtShardSize = "16"
}
```

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

## Known limitations (v0)

The generator is verified end-to-end against five fixtures (`01-scalars`,
`02-enums`, `03-relations`, `05-keywords`, `12-time-crate`) covering the
Tier 1-4 input surface, multi-relation disambiguation, Rust keyword field
names, and the time-crate option matrix.

Edge cases that v0 does **not** yet handle on real-world schemas:

- `@relation("name")` aliased relations where two models have multiple
  relations to each other through differently-named pairs
- Some self-referential relation shapes where the back-relation name needs
  to be discovered through DMMF's `relationName` field
- Schemas with `prismaSchemaFolder` preview-feature configs that include
  custom generators (the input schema must be stripped to just `datasource`
  + `model`/`enum` blocks)

The 80-model `lexmata-models` schema currently fails to compile with these
edge cases. The fixture (`test/fixtures/08-lexmata/`) is checked in and the
corresponding test is skipped pending follow-up work.

## Status

Pre-1.0 — the emission format may change between minor versions. Once the
generator hits 1.0, any change to generated source is a major-version bump
with a migration note in `CHANGELOG.md`.

## License

MIT
