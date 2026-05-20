# Using the generated types with the raw MongoDB driver

The generator emits ORM-agnostic types — structs, filter ASTs, and input
shapes. This guide walks through wiring them up to the official Rust
MongoDB driver (`mongodb`), including the part that matters most:
**translating `*WhereInput` to a BSON filter document**.

If you came from [docs/raw-postgres.md](./raw-postgres.md), the same
filter AST is being translated; only the target language changes. The
output here is a `bson::Document` instead of a SQL string plus
positional parameters.

## Prisma + Mongo prerequisites

Prisma's Mongo connector requires that ID fields look like this in
`schema.prisma`:

```prisma
model User {
  id    String @id @default(auto()) @map("_id") @db.ObjectId
  email String @unique
  firmId String @db.ObjectId
  firm  Firm   @relation(fields: [firmId], references: [id])
}
```

`@map("_id")` makes the generator emit a `#[serde(rename = "_id")]`
attribute, so the serialized Rust struct round-trips cleanly through
the driver. Without it, the driver writes a separate `id` field and
Mongo synthesizes its own `_id` — a silent footgun.

## Setup

```toml
# Cargo.toml of your application
[dependencies]
rust_out = { path = "../rust-out" }

tokio = { version = "1", features = ["full"] }
mongodb = "3"
bson = { version = "2", features = ["chrono-0_4", "uuid-1", "serde_with-3"] }
serde = { version = "1", features = ["derive"] }
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["serde"] }
serde_json = "1"
```

`bson`'s `chrono-0_4` and `uuid-1` features bridge the generator's
default types (`chrono::DateTime<Utc>`, `uuid::Uuid`) into BSON. Without
them the driver can still round-trip — it falls back to wrapped BSON
extended-JSON shapes — but you lose native types on the wire.

## Connecting

```rust
use mongodb::{Client, Collection};

async fn connect() -> mongodb::error::Result<Client> {
    Client::with_uri_str("mongodb://localhost:27017").await
}
```

For the rest of this guide assume:

```rust
let users: Collection<rust_out::users::User> = client.database("app").collection("User");
```

`Collection<T>` is typed: `find_one`, `find`, `insert_one`, `update_one`
all transparently serde-serialize on the way in and deserialize on the
way out. That's why the generator's `#[derive(Serialize, Deserialize)]`
on every struct is load-bearing — set `serde = "false"` in the
generator config and this entire integration path closes.

## Reading documents into model structs

Because the driver handles deserialization, this is a one-liner:

```rust
use mongodb::bson::doc;
use rust_out::users::User;

async fn find_user_by_email(
    users: &Collection<User>,
    email: &str,
) -> mongodb::error::Result<Option<User>> {
    users.find_one(doc! { "email": email }).await
}
```

Relation fields land as `None` / `Vec::new()` because the documents
in Mongo don't contain them. Populate them via separate queries (or
an `$lookup` aggregation; see the "out of scope" notes at the bottom).

## Inserting from `UncheckedCreateInput`

`*CreateInput` carries nested-relation creates as `Option<Box<...>>`
shapes; `*UncheckedCreateInput` is the scalar-only variant with FK
columns instead of nested inputs. For raw Mongo writes, prefer the
unchecked form.

```rust
use rust_out::users::{User, UserUncheckedCreateInput};
use mongodb::bson::oid::ObjectId;

async fn insert_user(
    users: &Collection<User>,
    input: UserUncheckedCreateInput,
) -> mongodb::error::Result<ObjectId> {
    // Build a domain object directly. The generator skips fields with
    // @default in the create input, so the database supplies them on
    // insert. For ObjectId-style ids you can ask the driver to
    // generate one, or omit the field and let Mongo do it.
    let user = User {
        id: ObjectId::new().to_hex(),
        email: input.email,
        firm_id: input.firm_id,
        firm: None,
        posts: Vec::new(),
    };
    let result = users.insert_one(&user).await?;
    Ok(result.inserted_id.as_object_id().unwrap_or_default())
}
```

If you don't want to round-trip through the full model struct (because
relation fields are noise), construct an inline `Document` instead with
`bson::to_document(&input)?`. The unchecked-input type serializes to a
document containing exactly the FK and scalar fields — usually what you
want for a write.

## Updating with `*UpdateInput`'s field-update operations

The shape:

```rust
pub struct IntFieldUpdateOperationsInput {
    pub set: Option<i32>,
    pub increment: Option<i32>,
    pub decrement: Option<i32>,
    pub multiply: Option<i32>,
    pub divide: Option<i32>,
}
```

maps to Mongo's update operators:

| Op           | Mongo                                                 |
|--------------|-------------------------------------------------------|
| `set`        | `$set: { col: value }`                                |
| `increment`  | `$inc: { col: value }`                                |
| `decrement`  | `$inc: { col: -value }`                               |
| `multiply`   | `$mul: { col: value }`                                |
| `divide`     | none — see note below                                 |

Mongo has no `$div`. Either pre-compute on the client (turn `divide: 4`
into `multiply: 0.25` for floats), or use a pipeline update with
`$set: { col: { $divide: ["$col", value] } }`. The straightforward
operator-doc form below skips `divide`.

```rust
use mongodb::bson::{doc, Document};
use rust_out::users::UserUncheckedUpdateInput;

fn translate_user_update(
    input: UserUncheckedUpdateInput,
) -> Option<Document> {
    let mut set = Document::new();
    let mut inc = Document::new();
    let mut mul = Document::new();

    if let Some(op) = input.email {
        if let Some(value) = op.set {
            set.insert("email", value);
        }
    }
    if let Some(op) = input.login_count {
        if let Some(value) = op.set { set.insert("login_count", value); }
        if let Some(value) = op.increment { inc.insert("login_count", value); }
        if let Some(value) = op.decrement { inc.insert("login_count", -value); }
        if let Some(value) = op.multiply { mul.insert("login_count", value); }
    }

    let mut update = Document::new();
    if !set.is_empty() { update.insert("$set", set); }
    if !inc.is_empty() { update.insert("$inc", inc); }
    if !mul.is_empty() { update.insert("$mul", mul); }
    if update.is_empty() { None } else { Some(update) }
}

// usage:
// if let Some(update) = translate_user_update(input) {
//     users.update_one(doc! { "_id": id }, update).await?;
// }
```

## Translating `*WhereInput` to a BSON filter

The translator walks the AST and emits a `bson::Document`. Composition
operators map to Mongo's:

| Input field | Mongo top-level operator |
|-------------|--------------------------|
| `and`       | `$and: [...]`            |
| `or`        | `$or: [...]`             |
| `not`       | `$nor: [...]`            |

Per-field filters become `{ field: { $op: value, ... } }`. The output
of the per-scalar translators below is the **value-side document**
(`{ $eq: "...", $in: [...] }`); the top-level translator nests it under
the field name.

### Top-level translator for one model

```rust
use mongodb::bson::{doc, Bson, Document};
use rust_out::users::UserWhereInput;
use rust_out::shared::filters::{StringFilter, UuidFilter};

pub fn translate_user_where(w: &UserWhereInput) -> Document {
    let mut out = Document::new();

    if let Some(f) = &w.id {
        if let Some(d) = translate_uuid_filter(f) {
            out.insert("_id", d);
        }
    }
    if let Some(f) = &w.email {
        if let Some(d) = translate_string_filter(f) {
            out.insert("email", d);
        }
    }
    if let Some(f) = &w.firm_id {
        if let Some(d) = translate_uuid_filter(f) {
            out.insert("firmId", d);
        }
    }

    if let Some(group) = &w.and {
        let parts: Vec<Document> = group.iter().map(translate_user_where).collect();
        if !parts.is_empty() {
            out.insert("$and", parts);
        }
    }
    if let Some(group) = &w.or {
        let parts: Vec<Document> = group.iter().map(translate_user_where).collect();
        if !parts.is_empty() {
            out.insert("$or", parts);
        }
    }
    if let Some(group) = &w.not {
        let parts: Vec<Document> = group.iter().map(translate_user_where).collect();
        if !parts.is_empty() {
            out.insert("$nor", parts);
        }
    }

    out
}
```

Note the column names match what Mongo stores (`_id` for the id field
when `@map("_id")` was set, `firmId` for camelCase mapped fields). The
generator emits the snake-cased Rust field name on the struct plus a
serde rename to the Prisma name; the **filter target is the Mongo
field name**, which usually matches the Prisma name unless you've
overridden it with `@map`. Keep both ends consistent with your schema.

### Per-scalar filter translators

```rust
fn translate_uuid_filter(f: &UuidFilter) -> Option<Document> {
    let mut d = Document::new();

    if let Some(value) = &f.equals {
        d.insert("$eq", value.to_string());
    }
    if let Some(values) = &f.r#in {
        let bson_values: Vec<Bson> = values.iter().map(|v| Bson::String(v.to_string())).collect();
        d.insert("$in", bson_values);
    }
    if let Some(values) = &f.not_in {
        let bson_values: Vec<Bson> = values.iter().map(|v| Bson::String(v.to_string())).collect();
        d.insert("$nin", bson_values);
    }
    if let Some(inner) = &f.not {
        if let Some(sub) = translate_uuid_filter(inner) {
            d.insert("$not", sub);
        }
    }

    if d.is_empty() { None } else { Some(d) }
}

fn translate_string_filter(f: &StringFilter) -> Option<Document> {
    use rust_out::shared::filters::QueryMode;
    let mut d = Document::new();
    let opts = if matches!(f.mode, Some(QueryMode::Insensitive)) { "i" } else { "" };

    if let Some(value) = &f.equals {
        d.insert("$eq", value.clone());
    }
    if let Some(values) = &f.r#in {
        d.insert("$in", values.clone());
    }
    if let Some(values) = &f.not_in {
        d.insert("$nin", values.clone());
    }
    if let Some(value) = &f.lt  { d.insert("$lt",  value.clone()); }
    if let Some(value) = &f.lte { d.insert("$lte", value.clone()); }
    if let Some(value) = &f.gt  { d.insert("$gt",  value.clone()); }
    if let Some(value) = &f.gte { d.insert("$gte", value.clone()); }

    if let Some(value) = &f.contains {
        d.insert("$regex", regex::escape(value));
        if !opts.is_empty() { d.insert("$options", opts); }
    }
    if let Some(value) = &f.starts_with {
        d.insert("$regex", format!("^{}", regex::escape(value)));
        if !opts.is_empty() { d.insert("$options", opts); }
    }
    if let Some(value) = &f.ends_with {
        d.insert("$regex", format!("{}$", regex::escape(value)));
        if !opts.is_empty() { d.insert("$options", opts); }
    }

    if let Some(inner) = &f.not {
        if let Some(sub) = translate_string_filter(inner) {
            d.insert("$not", sub);
        }
    }

    if d.is_empty() { None } else { Some(d) }
}
```

`regex::escape` (from the `regex` crate) is critical — `contains`,
`startsWith`, and `endsWith` accept arbitrary user input, and any
unescaped regex metacharacter (`.`, `(`, `[`, `*`, `\`) becomes an
injection vector or a query that scans far more documents than
intended. Treat `String#contains` translation the same way you'd treat
SQL parameter binding.

Numeric and datetime filters (`IntFilter`, `BigIntFilter`,
`FloatFilter`, `DecimalFilter`, `DateTimeFilter`) follow the
`translate_uuid_filter` shape plus `lt`/`lte`/`gt`/`gte`. The nullable
variants add an `is_null` flag: translate it to
`{ $eq: Bson::Null }` (matches null and missing) or `{ $type: 10 }`
(matches only documents where the field exists with BSON `Null`).

### Relation filters

`*RelationFilter` (to-one) and `*ListRelationFilter` (to-many) compose
back into `*WhereInput`. For a referenced-id model (the Mongo
connector's required shape), translate a to-one `is:` filter against
the FK column directly:

```rust
// User.firm is { is: FirmWhereInput }; Mongo stores `firmId` on User.
if let Some(rel) = &w.firm {
    if let Some(sub) = &rel.is {
        let firm_filter = translate_firm_where(sub);
        // Resolve to a set of ids in one round-trip, then $in on the FK.
        let ids: Vec<String> = db
            .collection::<bson::Document>("Firm")
            .find(firm_filter).await?
            .map(|doc| doc.ok()
                .and_then(|d| d.get("_id").and_then(|v| v.as_str().map(String::from))))
            .filter_map(|x| std::future::ready(x))
            .collect()
            .await;
        out.insert("firmId", doc! { "$in": ids });
    }
}
```

Joining inside a single query needs `$lookup` aggregation, which moves
out of the `find` API and into `aggregate`. For most use cases the
two-step "resolve to ids, then `$in`" pattern is simpler and faster.

`ListRelationFilter`'s `every`/`some`/`none` translate the same way,
with `$in`/`$nin` and additional logic to model "every embedded
document matches" vs "some embedded document matches".

### Putting it together

```rust
use mongodb::bson::doc;
use rust_out::shared::filters::{QueryMode, StringFilter};
use rust_out::users::UserWhereInput;

let where_input = UserWhereInput {
    email: Some(StringFilter {
        contains: Some("acme.com".to_string()),
        mode: Some(QueryMode::Insensitive),
        ..Default::default()
    }),
    ..Default::default()
};

let filter = translate_user_where(&where_input);
let cursor = users.find(filter).sort(doc! { "email": 1 }).await?;
let results: Vec<User> = cursor.try_collect().await?;
```

## What this guide deliberately does not cover

- **`Select` / `Include` projection**: Mongo supports projection via a
  `find(...).projection(doc! { ... })` modifier, but mapping the
  generated `*Select` shape to projection docs is mechanical and
  rarely worth the indirection on the read path. Most consumers just
  fetch the full document and filter columns client-side.
- **`OrderBy` translation**: walk `*OrderByWithRelationInput` and
  build `{ field: 1 | -1 }`. `SortOrder::Asc => 1`, `Desc => -1`.
  Null-handling variants (`AscNullsFirst`, `DescNullsLast`, etc.)
  require a `$sort` pipeline stage with `$collation` or computed
  sort keys; the simple driver `.sort()` modifier can't express them.
- **Nested input writes** (`*CreateNested*`, `*UpdateNested*`): designed
  to drive transactional cascades. Mongo's multi-document transactions
  apply, but the choreography mirrors Prisma's TS implementation more
  closely than its SQL one. Out of scope for this guide.
- **Aggregations**: `*AggregateInput` translates to a `$group` stage
  plus accumulators (`$sum`, `$avg`, `$min`, `$max`). The `WHERE`
  translator above feeds the preceding `$match` stage unchanged.
