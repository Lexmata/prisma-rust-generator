# Using the generated types with a raw PostgreSQL driver

The generator emits ORM-agnostic types — structs, filter ASTs, and input
shapes. This guide walks through wiring them up to a raw PostgreSQL Rust
driver (`tokio-postgres`), including the part that gets the most
attention from consumers: **translating `*WhereInput` to a parameterized
SQL `WHERE` clause**.

The patterns translate one-to-one to the sync `postgres` crate. For
connection pooling in production, swap a single connection for
`deadpool-postgres` or `bb8-postgres` — the row/insert/filter code in
this guide does not change.

## Setup

Assuming the generator is configured with `output = "../rust-out/src"`
and you're consuming the crate as `rust_out`:

```toml
# Cargo.toml of your application
[dependencies]
rust_out = { path = "../rust-out" }

tokio = { version = "1", features = ["full"] }
tokio-postgres = { version = "0.7", features = ["with-uuid-1", "with-chrono-0_4", "with-serde_json-1"] }
uuid = { version = "1", features = ["serde"] }
chrono = { version = "0.4", features = ["serde"] }
serde_json = "1"
rust_decimal = { version = "1", features = ["serde", "db-tokio-postgres"] }
```

The `with-*` features on `tokio-postgres` provide the `FromSql`/`ToSql`
impls that let `row.get(...)` and `query(..., &[...])` accept the same
crate types the generator emits (`uuid::Uuid`, `chrono::DateTime<Utc>`,
`serde_json::Value`). Without them the binding calls will not compile.

## Connecting

```rust
use tokio_postgres::{Client, NoTls};

async fn connect() -> Result<Client, tokio_postgres::Error> {
    let (client, connection) = tokio_postgres::connect(
        "host=localhost user=app dbname=app",
        NoTls,
    ).await?;
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("connection error: {e}");
        }
    });
    Ok(client)
}
```

For the rest of this guide assume `client: &Client` is available.

## Reading rows into model structs

The generated model struct contains both scalar columns and relation
fields. Relations aren't columns — populate them with empty defaults
when loading a row, and fill them with a separate query if needed.

```rust
use rust_out::users::User;
use tokio_postgres::Row;

fn user_from_row(row: &Row) -> User {
    User {
        id: row.get("id"),
        email: row.get("email"),
        firm_id: row.get("firm_id"),
        // Relations: empty by default; hydrate separately if needed.
        firm: None,
        posts: Vec::new(),
    }
}

async fn find_user_by_email(
    client: &tokio_postgres::Client,
    email: &str,
) -> Result<Option<User>, tokio_postgres::Error> {
    let row = client
        .query_opt(
            "SELECT id, email, firm_id FROM \"User\" WHERE email = $1",
            &[&email],
        )
        .await?;
    Ok(row.as_ref().map(user_from_row))
}
```

If your schema uses `@@map` to remap table names, use the mapped name in
the SQL — the generator doesn't track that, since it's emitting Rust
shape only.

## Inserting from `UncheckedCreateInput`

`*CreateInput` carries nested-relation creates (`Option<Box<...>>` of
nested types). For raw SQL inserts you want `*UncheckedCreateInput` —
it's the scalar-only form with FK columns instead of nested relation
inputs.

```rust
use rust_out::users::UserUncheckedCreateInput;

async fn insert_user(
    client: &tokio_postgres::Client,
    input: UserUncheckedCreateInput,
) -> Result<uuid::Uuid, tokio_postgres::Error> {
    let row = client
        .query_one(
            r#"INSERT INTO "User" (email, firm_id)
               VALUES ($1, $2)
               RETURNING id"#,
            &[&input.email, &input.firm_id],
        )
        .await?;
    Ok(row.get("id"))
}
```

Fields with `@default(...)` are omitted from the generated input struct,
so you can rely on the database (`gen_random_uuid()`, `DEFAULT`, etc.)
to populate them.

## Updating with `*UpdateInput`'s field-update operations

Update inputs wrap each scalar in a `*FieldUpdateOperationsInput`:

```rust
pub struct StringFieldUpdateOperationsInput {
    pub set: Option<String>,
}

pub struct IntFieldUpdateOperationsInput {
    pub set: Option<i32>,
    pub increment: Option<i32>,
    pub decrement: Option<i32>,
    pub multiply: Option<i32>,
    pub divide: Option<i32>,
}
```

A raw-SQL update walks the input, collects the fields that are `Some`,
and builds a `SET clause = $n` list:

```rust
use rust_out::users::UserUncheckedUpdateInput;
use tokio_postgres::types::ToSql;

async fn update_user(
    client: &tokio_postgres::Client,
    id: uuid::Uuid,
    input: UserUncheckedUpdateInput,
) -> Result<u64, tokio_postgres::Error> {
    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn ToSql + Sync + Send>> = Vec::new();

    if let Some(op) = input.email {
        if let Some(value) = op.set {
            params.push(Box::new(value));
            sets.push(format!("email = ${}", params.len()));
        }
    }
    if let Some(op) = input.firm_id {
        if let Some(value) = op.set {
            params.push(Box::new(value));
            sets.push(format!("firm_id = ${}", params.len()));
        }
    }

    if sets.is_empty() {
        return Ok(0);
    }

    params.push(Box::new(id));
    let sql = format!(
        r#"UPDATE "User" SET {} WHERE id = ${}"#,
        sets.join(", "),
        params.len(),
    );
    let param_refs: Vec<&(dyn ToSql + Sync)> =
        params.iter().map(|b| &**b as &(dyn ToSql + Sync)).collect();
    client.execute(&sql, &param_refs).await
}
```

For numeric fields, branch on `increment`/`decrement`/`multiply`/`divide`
the same way and emit `col = col + $n` etc.

## Translating `*WhereInput` to a SQL `WHERE` clause

This is the part the generator can't do for you. The shape below is a
minimal translator covering the most common filter variants. Extending
it to the rest (`startsWith`, `endsWith`, `mode`, etc.) is mechanical —
add the variant to the match.

### Filter AST recap

A typical scalar filter has this shape (from `crate::shared::filters`):

```rust
pub struct StringFilter {
    pub equals: Option<String>,
    pub r#in: Option<Vec<String>>,
    pub not_in: Option<Vec<String>>,
    pub lt: Option<String>,
    pub lte: Option<String>,
    pub gt: Option<String>,
    pub gte: Option<String>,
    pub contains: Option<String>,
    pub starts_with: Option<String>,
    pub ends_with: Option<String>,
    pub mode: Option<crate::shared::filters::QueryMode>,
    pub not: Option<Box<StringFilter>>,
}
```

`UserWhereInput` carries one of these per scalar field, plus `and`,
`or`, `not` for boolean composition.

### Translator builder

Accumulate SQL fragments and bound parameters together. Postgres uses
positional placeholders (`$1`, `$2`, …), so the builder also tracks the
next index.

```rust
use tokio_postgres::types::ToSql;

pub struct WhereBuilder {
    pub sql: String,
    pub params: Vec<Box<dyn ToSql + Sync + Send>>,
}

impl WhereBuilder {
    pub fn new() -> Self {
        Self { sql: String::new(), params: Vec::new() }
    }

    fn bind<T: ToSql + Sync + Send + 'static>(&mut self, value: T) -> String {
        self.params.push(Box::new(value));
        format!("${}", self.params.len())
    }

    /// Borrow params as the slice tokio-postgres wants for query().
    pub fn param_refs(&self) -> Vec<&(dyn ToSql + Sync)> {
        self.params.iter().map(|b| &**b as &(dyn ToSql + Sync)).collect()
    }
}
```

### Top-level translator for one model

```rust
use rust_out::users::UserWhereInput;
use rust_out::shared::filters::{StringFilter, UuidFilter};

pub fn translate_user_where(
    w: &UserWhereInput,
    b: &mut WhereBuilder,
) -> Option<String> {
    let mut clauses: Vec<String> = Vec::new();

    if let Some(f) = &w.id {
        if let Some(c) = translate_uuid_filter("id", f, b) {
            clauses.push(c);
        }
    }
    if let Some(f) = &w.email {
        if let Some(c) = translate_string_filter("email", f, b) {
            clauses.push(c);
        }
    }
    if let Some(f) = &w.firm_id {
        if let Some(c) = translate_uuid_filter("firm_id", f, b) {
            clauses.push(c);
        }
    }

    // Boolean composition: AND/OR/NOT recurse into the same translator.
    if let Some(group) = &w.and {
        let parts: Vec<String> = group
            .iter()
            .filter_map(|sub| translate_user_where(sub, b))
            .collect();
        if !parts.is_empty() {
            clauses.push(format!("({})", parts.join(" AND ")));
        }
    }
    if let Some(group) = &w.or {
        let parts: Vec<String> = group
            .iter()
            .filter_map(|sub| translate_user_where(sub, b))
            .collect();
        if !parts.is_empty() {
            clauses.push(format!("({})", parts.join(" OR ")));
        }
    }
    if let Some(group) = &w.not {
        let parts: Vec<String> = group
            .iter()
            .filter_map(|sub| translate_user_where(sub, b))
            .collect();
        if !parts.is_empty() {
            clauses.push(format!("NOT ({})", parts.join(" AND ")));
        }
    }

    if clauses.is_empty() {
        None
    } else {
        Some(clauses.join(" AND "))
    }
}
```

### Per-scalar filter translators

The pattern is identical across types — equality, `IN`, range,
optional negation. `StringFilter` adds `LIKE` variants; numeric and
datetime filters do not.

```rust
fn translate_uuid_filter(
    col: &str,
    f: &UuidFilter,
    b: &mut WhereBuilder,
) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();

    if let Some(value) = &f.equals {
        let p = b.bind(*value);
        parts.push(format!("{col} = {p}"));
    }
    if let Some(values) = &f.r#in {
        if values.is_empty() {
            // Postgres rejects `IN ()` — translate to a guaranteed-false.
            parts.push("FALSE".to_string());
        } else {
            let p = b.bind(values.clone());
            parts.push(format!("{col} = ANY({p})"));
        }
    }
    if let Some(values) = &f.not_in {
        if !values.is_empty() {
            let p = b.bind(values.clone());
            parts.push(format!("{col} <> ALL({p})"));
        }
    }
    if let Some(inner) = &f.not {
        if let Some(sub) = translate_uuid_filter(col, inner, b) {
            parts.push(format!("NOT ({sub})"));
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" AND "))
    }
}

fn translate_string_filter(
    col: &str,
    f: &StringFilter,
    b: &mut WhereBuilder,
) -> Option<String> {
    use rust_out::shared::filters::QueryMode;
    let mut parts: Vec<String> = Vec::new();
    let case_insensitive = matches!(f.mode, Some(QueryMode::Insensitive));
    let like_op = if case_insensitive { "ILIKE" } else { "LIKE" };
    let eq_clause = |col: &str, p: &str| {
        if case_insensitive {
            format!("LOWER({col}) = LOWER({p})")
        } else {
            format!("{col} = {p}")
        }
    };

    if let Some(value) = &f.equals {
        let p = b.bind(value.clone());
        parts.push(eq_clause(col, &p));
    }
    if let Some(values) = &f.r#in {
        if values.is_empty() {
            parts.push("FALSE".to_string());
        } else {
            let p = b.bind(values.clone());
            parts.push(format!("{col} = ANY({p})"));
        }
    }
    if let Some(value) = &f.lt {
        let p = b.bind(value.clone());
        parts.push(format!("{col} < {p}"));
    }
    if let Some(value) = &f.lte {
        let p = b.bind(value.clone());
        parts.push(format!("{col} <= {p}"));
    }
    if let Some(value) = &f.gt {
        let p = b.bind(value.clone());
        parts.push(format!("{col} > {p}"));
    }
    if let Some(value) = &f.gte {
        let p = b.bind(value.clone());
        parts.push(format!("{col} >= {p}"));
    }
    if let Some(value) = &f.contains {
        let p = b.bind(format!("%{value}%"));
        parts.push(format!("{col} {like_op} {p}"));
    }
    if let Some(value) = &f.starts_with {
        let p = b.bind(format!("{value}%"));
        parts.push(format!("{col} {like_op} {p}"));
    }
    if let Some(value) = &f.ends_with {
        let p = b.bind(format!("%{value}"));
        parts.push(format!("{col} {like_op} {p}"));
    }
    if let Some(inner) = &f.not {
        if let Some(sub) = translate_string_filter(col, inner, b) {
            parts.push(format!("NOT ({sub})"));
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" AND "))
    }
}
```

Numeric filters (`IntFilter`, `BigIntFilter`, `FloatFilter`,
`DecimalFilter`, `DateTimeFilter`) have the same shape as
`UuidFilter` plus `lt`/`lte`/`gt`/`gte`. The translator is a copy of
`translate_string_filter` minus the `LIKE` branches.

Nullable variants (`StringNullableFilter`, `IntNullableFilter`, …) add
an `is_null` flag. Translate it as `{col} IS NULL`.

### Relation filters

`*RelationFilter` (to-one) and `*ListRelationFilter` (to-many) compose
back into `*WhereInput`. Translating these usually means emitting a
correlated subquery or an `EXISTS` clause:

```rust
// to-one: `Some(<sub>)` becomes a join-like EXISTS on the FK
if let Some(rel) = &w.firm {
    if let Some(sub) = &rel.is {
        let mut inner = WhereBuilder::new();
        // … reuse this builder's params, or wire a shared one through …
        if let Some(clause) = translate_firm_where(sub, b) {
            clauses.push(format!(
                r#"EXISTS (SELECT 1 FROM "Firm" f WHERE f.id = "User".firm_id AND ({clause}))"#,
            ));
        }
    }
}
```

`ListRelationFilter::every`/`some`/`none` translate to the
corresponding `EXISTS`/`NOT EXISTS`/quantified `ALL` patterns. Joining
gets fiddly if multiple relation filters reference the same target
table — alias the subqueries explicitly.

### Putting it together

```rust
let mut builder = WhereBuilder::new();
let where_input = UserWhereInput {
    email: Some(StringFilter {
        contains: Some("acme.com".to_string()),
        mode: Some(QueryMode::Insensitive),
        ..Default::default()
    }),
    ..Default::default()
};

let clause = translate_user_where(&where_input, &mut builder)
    .unwrap_or_else(|| "TRUE".to_string());
let sql = format!(
    "SELECT id, email, firm_id FROM \"User\" WHERE {clause} ORDER BY email"
);

let rows = client.query(&sql, &builder.param_refs()).await?;
let users: Vec<User> = rows.iter().map(user_from_row).collect();
```

## What this guide deliberately does not cover

- **`Select`/`Include` projection**: raw SQL doesn't have a uniform way
  to encode a column subset. The generated `*Select`/`*Include` types
  are most useful when you're routing the same input shape through a
  GraphQL or REST layer; the SQL side just `SELECT`s what it needs.
- **`OrderBy` translation**: trivial — walk the `*OrderByWithRelationInput`
  fields, collect `(column, direction)` pairs, emit `ORDER BY ...`.
  Nulls handling matches the `SortOrder::AscNullsFirst` etc. variants.
- **Nested input writes**: `*CreateNested*`/`*UpdateNested*` etc. are
  designed to drive multi-statement transactions; raw SQL implements
  them with explicit `BEGIN`/`COMMIT` and FK round-trips. The structure
  follows the input shape, but the transactional choreography is yours
  to design.
- **Aggregations**: the `*AggregateInput` types describe shape; the SQL
  translation is `SELECT COUNT(*)`, `AVG(col)`, etc., on top of the same
  `WHERE` translator above.
