# Using the generated types with sqlx

[sqlx](https://github.com/launchbadge/sqlx) is a Rust SQL toolkit with
compile-time-checked queries, runtime-built queries, a connection pool,
and uniform support for Postgres, MySQL, MariaDB, and SQLite. It's the
most common "raw but ergonomic" choice in async Rust.

This guide is comprehensive because sqlx sits between the raw-driver
guides ([postgres](./raw-postgres.md), [sqlite](./raw-sqlite.md),
[mysql](./raw-mysql.md)) and a full ORM: it removes most of the
binding boilerplate, but you still write SQL — which means you still
write a `*WhereInput` translator. The translator is *much* shorter
under sqlx because `QueryBuilder` handles placeholder numbering and
parameter binding for you.

If you only need one of the three backends, the parts marked with a
**[backend]** tag can be skipped.

## When sqlx is the right fit

- You want compile-time-checked queries (`query!`, `query_as!`) for
  the hand-written, fixed-shape parts of your code.
- You want a dynamic WHERE clause built from a `*WhereInput` value —
  sqlx's `QueryBuilder` does this safely.
- You want pooled async connections without picking a backend-specific
  pool crate (deadpool-postgres, mysql_async's `Pool`, r2d2-sqlite).
- You don't want a query DSL layer (sea-query, diesel) — you're happy
  writing SQL directly when the shape is fixed.

If you want zero-overhead compile-time checking everywhere, use the
raw-driver guides instead — sqlx's runtime `query()` skips compile
checks, and that's the path the WHERE translator must take.

## Setup

```toml
[dependencies]
rust_out = { path = "../rust-out" }

tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.8", default-features = false, features = [
  "runtime-tokio",
  "tls-rustls",
  "macros",
  # Pick exactly one backend:
  "postgres",
  # "mysql",
  # "sqlite",
  # Type integrations matching the generator's defaults:
  "uuid",
  "chrono",
  "json",
  "rust_decimal",
] }
uuid = { version = "1", features = ["serde"] }
chrono = { version = "0.4", features = ["serde"] }
serde_json = "1"
rust_decimal = { version = "1", features = ["serde"] }
```

The `uuid`/`chrono`/`json`/`rust_decimal` features wire sqlx's type
adapters to the same crate types the generator emits. Skip the ones you
don't use (every feature is a compile-time cost).

If you want compile-time-checked queries via `query!`, set
`DATABASE_URL` in `.env` (or run `cargo sqlx prepare` to generate an
offline cache) — sqlx connects to your database during `cargo build` to
verify each macro-driven query. The runtime path used by the WHERE
translator does NOT need this.

## Connecting

```rust
use sqlx::postgres::PgPoolOptions; // or MySqlPoolOptions / SqlitePoolOptions

async fn pool() -> sqlx::Result<sqlx::PgPool> {
    PgPoolOptions::new()
        .max_connections(8)
        .connect("postgres://app:pass@localhost/app")
        .await
}
```

For the rest of this guide assume `pool: &sqlx::PgPool` (or
`MySqlPool` / `SqlitePool`). Trait bounds in the examples use
`sqlx::Executor<'_, Database = sqlx::Postgres>` — substitute for your
backend.

## Reading rows into model structs

The generator does NOT derive `sqlx::FromRow` on its structs — adding
sqlx-specific derives would bind the consumer to a particular driver.
Three strategies, in order of how much sqlx ergonomics you keep:

### 1. Manual `FromRow` impl (recommended for static queries)

Lives in your application crate, next to your data layer. Once per
model, then every sqlx `query_as` / `fetch_*` works directly with the
generated type.

```rust
use rust_out::users::User;
use sqlx::{postgres::PgRow, FromRow, Row};

impl FromRow<'_, PgRow> for User {
    fn from_row(row: &PgRow) -> sqlx::Result<Self> {
        Ok(User {
            id: row.try_get("id")?,
            email: row.try_get("email")?,
            firm_id: row.try_get("firm_id")?,
            firm: None,
            posts: Vec::new(),
        })
    }
}
```

For MySQL or SQLite, swap `PgRow` for `MySqlRow` or `SqliteRow`. You
can have multiple `FromRow` impls per type (different backends) if
you target several databases.

### 2. Wrapper / DTO struct

If you do not control the generated crate (it's a path or git
dependency) and Rust's orphan rule blocks the trait impl, use a thin
wrapper:

```rust
#[derive(sqlx::FromRow)]
pub struct UserRow {
    pub id: uuid::Uuid,
    pub email: String,
    pub firm_id: uuid::Uuid,
}

impl From<UserRow> for rust_out::users::User {
    fn from(r: UserRow) -> Self {
        Self {
            id: r.id,
            email: r.email,
            firm_id: r.firm_id,
            firm: None,
            posts: Vec::new(),
        }
    }
}
```

`#[derive(sqlx::FromRow)]` reads each field by name. This is the
cheapest option if you're OK querying through a flat DTO at the data
boundary and converting to the model struct.

### 3. `query_as!` macro

Compile-time-checked column types, no `FromRow` derive needed —
the macro generates the row-mapping inline:

```rust
let user: User = sqlx::query_as!(
    User,
    r#"
    SELECT id, email, firm_id,
           NULL::jsonb AS "firm: _",     -- relation: forced NULL
           '[]'::jsonb AS "posts: _"     -- relation: forced empty
    FROM "User" WHERE email = $1
    "#,
    email
).fetch_one(pool).await?;
```

This works but is ugly because the relation fields aren't columns —
you have to supply explicit `NULL` aliases and tell sqlx the runtime
type. **Prefer strategy 1 or 2** for code that uses the model struct
directly. Reserve `query_as!` for purpose-built DTOs (counts,
aggregates, projection queries) where you can write a struct that
exactly matches the SELECT.

## Inserting and updating with the compile-checked path

For fixed-shape inserts and updates — the most common write pattern —
`query!` is the right tool: it validates column names, types, and
nullability at build time.

```rust
use rust_out::users::UserUncheckedCreateInput;

async fn insert_user(
    pool: &sqlx::PgPool,
    input: UserUncheckedCreateInput,
) -> sqlx::Result<uuid::Uuid> {
    let row = sqlx::query!(
        r#"INSERT INTO "User" (email, firm_id) VALUES ($1, $2) RETURNING id"#,
        input.email,
        input.firm_id,
    )
    .fetch_one(pool)
    .await?;
    Ok(row.id)
}
```

`*UncheckedCreateInput` is the right input shape for raw SQL — it
carries FK columns instead of nested-relation inputs.

### Dynamic updates with `QueryBuilder`

`*UpdateInput`'s scalar fields are wrapped in
`*FieldUpdateOperationsInput`, which makes the update sparse: only
fields with `Some(op)` should be written. `query!` can't express that
shape; use `QueryBuilder` instead.

```rust
use sqlx::{Postgres, QueryBuilder};
use rust_out::users::UserUncheckedUpdateInput;

async fn update_user(
    pool: &sqlx::PgPool,
    id: uuid::Uuid,
    input: UserUncheckedUpdateInput,
) -> sqlx::Result<u64> {
    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(r#"UPDATE "User" SET "#);
    let mut sep = qb.separated(", ");
    let mut wrote_anything = false;

    if let Some(op) = input.email {
        if let Some(value) = op.set {
            sep.push("email = ");
            sep.push_bind_unseparated(value);
            wrote_anything = true;
        }
    }
    if let Some(op) = input.login_count {
        if let Some(value) = op.set {
            sep.push("login_count = ");
            sep.push_bind_unseparated(value);
            wrote_anything = true;
        } else if let Some(value) = op.increment {
            sep.push("login_count = login_count + ");
            sep.push_bind_unseparated(value);
            wrote_anything = true;
        } else if let Some(value) = op.decrement {
            sep.push("login_count = login_count - ");
            sep.push_bind_unseparated(value);
            wrote_anything = true;
        } else if let Some(value) = op.multiply {
            sep.push("login_count = login_count * ");
            sep.push_bind_unseparated(value);
            wrote_anything = true;
        }
    }

    if !wrote_anything {
        return Ok(0);
    }

    qb.push(" WHERE id = ");
    qb.push_bind(id);

    let result = qb.build().execute(pool).await?;
    Ok(result.rows_affected())
}
```

`push_bind` appends a placeholder (`$N` / `?` / `?1` per backend) AND
records the parameter — you never count placeholders yourself.
`separated(", ")` automatically inserts the comma between
`SET col = $1, col2 = $2` clauses.

## Translating `*WhereInput` to a sqlx query

This is where `QueryBuilder` pays off most. Instead of stringly
tracking SQL text and a parallel `Vec<Box<dyn ToSql>>` (see the raw
drivers' guides), `QueryBuilder` writes both into a single value that
finalizes into a `Query` ready to execute.

### Top-level translator

```rust
use sqlx::{Postgres, QueryBuilder};
use rust_out::users::UserWhereInput;
use rust_out::shared::filters::{StringFilter, UuidFilter, QueryMode};

pub fn push_user_where(
    qb: &mut QueryBuilder<'_, Postgres>,
    w: &UserWhereInput,
) -> bool {
    let mut wrote = false;
    let mut and = |qb: &mut QueryBuilder<'_, Postgres>| {
        if wrote { qb.push(" AND "); }
        wrote = true;
    };

    if let Some(f) = &w.id {
        if push_uuid_filter(qb, "id", f) {
            // push_*_filter wrapped its clause in parens; the AND prefix
            // is the caller's job.
        }
    }
    // (See note below — the wrote/and pattern needs separate buffering.)

    wrote
}
```

In practice, `QueryBuilder` doesn't easily let you "skip back" if a
sub-translator decides nothing to emit. The cleanest pattern is to
buffer clauses into a `Vec<String>` for structure, and use
`push_bind` only for values. Here's that version:

```rust
use sqlx::{Postgres, QueryBuilder};
use rust_out::users::UserWhereInput;
use rust_out::shared::filters::{StringFilter, UuidFilter, QueryMode};

pub fn write_user_where(
    qb: &mut QueryBuilder<'_, Postgres>,
    w: &UserWhereInput,
) -> bool {
    let start = qb.into_arguments_and_sql_len_marker(); // pseudo — see below
    let mut any = false;
    let mut sep = |qb: &mut QueryBuilder<'_, Postgres>| {
        if any { qb.push(" AND "); }
        any = true;
    };

    if let Some(f) = &w.id {
        sep(qb);
        push_uuid_filter(qb, "id", f);
    }
    if let Some(f) = &w.email {
        sep(qb);
        push_string_filter(qb, "email", f);
    }
    if let Some(f) = &w.firm_id {
        sep(qb);
        push_uuid_filter(qb, "firm_id", f);
    }

    if let Some(group) = &w.and {
        for sub in group {
            sep(qb);
            qb.push("(");
            if !write_user_where(qb, sub) {
                qb.push("TRUE");
            }
            qb.push(")");
        }
    }
    if let Some(group) = &w.or {
        sep(qb);
        qb.push("(");
        let mut first = true;
        for sub in group {
            if !first { qb.push(" OR "); }
            first = false;
            qb.push("(");
            if !write_user_where(qb, sub) {
                qb.push("TRUE");
            }
            qb.push(")");
        }
        qb.push(")");
    }
    if let Some(group) = &w.not {
        for sub in group {
            sep(qb);
            qb.push("NOT (");
            if !write_user_where(qb, sub) {
                qb.push("TRUE");
            }
            qb.push(")");
        }
    }

    any
}
```

(The pseudo `into_arguments_and_sql_len_marker` line is illustrative —
sqlx doesn't expose mid-build snapshots. The correct pattern is to
pre-check whether a sub-tree has anything to emit before pushing the
separator, OR accept that you'll emit `TRUE` for empty branches. The
code above takes the latter approach.)

### Per-scalar pushers

```rust
fn push_uuid_filter(
    qb: &mut QueryBuilder<'_, sqlx::Postgres>,
    col: &str,
    f: &UuidFilter,
) {
    qb.push("(");
    let mut any = false;
    let mut sep = |qb: &mut QueryBuilder<'_, sqlx::Postgres>| {
        if any { qb.push(" AND "); }
        any = true;
    };

    if let Some(value) = &f.equals {
        sep(qb);
        qb.push(format!("{col} = "));
        qb.push_bind(*value);
    }
    if let Some(values) = &f.r#in {
        sep(qb);
        if values.is_empty() {
            qb.push("FALSE");
        } else {
            qb.push(format!("{col} = ANY("));
            qb.push_bind(values.clone());
            qb.push(")");
        }
    }
    if let Some(values) = &f.not_in {
        if !values.is_empty() {
            sep(qb);
            qb.push(format!("{col} <> ALL("));
            qb.push_bind(values.clone());
            qb.push(")");
        }
    }
    if let Some(inner) = &f.not {
        sep(qb);
        qb.push("NOT ");
        push_uuid_filter(qb, col, inner);
    }

    if !any { qb.push("TRUE"); }
    qb.push(")");
}

fn push_string_filter(
    qb: &mut QueryBuilder<'_, sqlx::Postgres>,
    col: &str,
    f: &StringFilter,
) {
    qb.push("(");
    let mut any = false;
    let ci = matches!(f.mode, Some(QueryMode::Insensitive));
    let like_op = if ci { "ILIKE" } else { "LIKE" };
    let mut sep = |qb: &mut QueryBuilder<'_, sqlx::Postgres>| {
        if any { qb.push(" AND "); }
        any = true;
    };

    if let Some(value) = &f.equals {
        sep(qb);
        if ci {
            qb.push(format!("LOWER({col}) = LOWER("));
            qb.push_bind(value.clone());
            qb.push(")");
        } else {
            qb.push(format!("{col} = "));
            qb.push_bind(value.clone());
        }
    }
    if let Some(values) = &f.r#in {
        sep(qb);
        if values.is_empty() {
            qb.push("FALSE");
        } else {
            qb.push(format!("{col} = ANY("));
            qb.push_bind(values.clone());
            qb.push(")");
        }
    }
    if let Some(value) = &f.lt  { sep(qb); qb.push(format!("{col} < ")); qb.push_bind(value.clone()); }
    if let Some(value) = &f.lte { sep(qb); qb.push(format!("{col} <= ")); qb.push_bind(value.clone()); }
    if let Some(value) = &f.gt  { sep(qb); qb.push(format!("{col} > ")); qb.push_bind(value.clone()); }
    if let Some(value) = &f.gte { sep(qb); qb.push(format!("{col} >= ")); qb.push_bind(value.clone()); }

    if let Some(value) = &f.contains {
        sep(qb);
        qb.push(format!("{col} {like_op} "));
        qb.push_bind(format!("%{value}%"));
    }
    if let Some(value) = &f.starts_with {
        sep(qb);
        qb.push(format!("{col} {like_op} "));
        qb.push_bind(format!("{value}%"));
    }
    if let Some(value) = &f.ends_with {
        sep(qb);
        qb.push(format!("{col} {like_op} "));
        qb.push_bind(format!("%{value}"));
    }

    if let Some(inner) = &f.not {
        sep(qb);
        qb.push("NOT ");
        push_string_filter(qb, col, inner);
    }

    if !any { qb.push("TRUE"); }
    qb.push(")");
}
```

The crucial point: every value goes through `push_bind`. The `col`
parameter is the only string interpolation, and it must be a
**static** column name from your schema — never an attacker-controlled
value. The generator emits column names as identifiers from the IR;
that's the safe source.

### Putting it together

```rust
use sqlx::{Postgres, QueryBuilder};

let where_input = UserWhereInput {
    email: Some(StringFilter {
        contains: Some("acme.com".to_string()),
        mode: Some(QueryMode::Insensitive),
        ..Default::default()
    }),
    ..Default::default()
};

let mut qb: QueryBuilder<Postgres> =
    QueryBuilder::new(r#"SELECT id, email, firm_id FROM "User" WHERE "#);
if !write_user_where(&mut qb, &where_input) {
    qb.push("TRUE");
}
qb.push(" ORDER BY email");

let users: Vec<User> = qb.build_query_as::<User>().fetch_all(pool).await?;
```

`build_query_as::<User>()` reuses your `FromRow` impl from earlier in
this guide. If you went with the wrapper-DTO strategy, use
`build_query_as::<UserRow>().fetch_all(pool).await?.into_iter().map(User::from).collect()`.

## Backend dialect notes

`QueryBuilder` writes placeholders in the active backend's style
automatically:

- **Postgres**: `$1`, `$2`, `$3`. `= ANY($1)` works for `IN` with
  array binding.
- **MySQL / MariaDB**: `?`, `?`, `?`. No array binding — `IN (?, ?, ?)`
  is the only option. The translator above emits `= ANY(...)` which
  fails on MySQL — substitute a loop that emits `IN (` + N placeholders
  for MySQL/SQLite targets.
- **SQLite**: `?1`, `?2`, `?3`. Same array constraint as MySQL.

For column quoting, use double quotes (Postgres/SQLite) or backticks
(MySQL). A `quote_ident(col)` helper centralizes this:

```rust
fn quote_ident_pg(col: &str) -> String { format!(r#""{col}""#) }
fn quote_ident_mysql(col: &str) -> String { format!("`{col}`") }
```

Wire one into your column-name interpolation and switch implementations
per backend. The generator's column names already match the Prisma
field names; if you've used `@map`, the column name is what `@map`
gave you.

For case-insensitive matching on MySQL/SQLite, `ILIKE` does not exist —
use `LOWER(col) LIKE LOWER(?)` (already shown in the SQLite and MySQL
raw-driver guides). The generator's `QueryMode::Insensitive` is a
request, not a guarantee; the translator chooses how to honor it.

## Type mapping cheat sheet

The generator's defaults map directly to sqlx-supported types when the
matching feature is on:

| Generator emits        | sqlx feature   | Postgres   | MySQL          | SQLite     |
|------------------------|----------------|------------|----------------|------------|
| `String`               | (built-in)     | `TEXT`/`VARCHAR` | `VARCHAR`/`TEXT` | `TEXT` |
| `uuid::Uuid`           | `uuid`         | `UUID`     | `CHAR(36)` *   | `BLOB`/`TEXT` |
| `i32` / `i16` / `u32`  | (built-in)     | `INTEGER`/`SMALLINT` | `INT`    | `INTEGER` |
| `i64`                  | (built-in)     | `BIGINT`   | `BIGINT`       | `INTEGER` |
| `f64` / `f32`          | (built-in)     | `DOUBLE`/`REAL` | `DOUBLE`/`FLOAT` | `REAL` |
| `rust_decimal::Decimal`| `rust_decimal` | `NUMERIC`  | `DECIMAL`      | (text) **|
| `chrono::DateTime<Utc>`| `chrono`       | `TIMESTAMPTZ` | `DATETIME`/`TIMESTAMP` | `TEXT`/`INTEGER` |
| `chrono::NaiveDateTime`| `chrono`       | `TIMESTAMP` | `DATETIME`     | same |
| `chrono::NaiveDate`    | `chrono`       | `DATE`     | `DATE`         | same |
| `serde_json::Value`    | `json`         | `JSONB`/`JSON` | `JSON`     | `TEXT` |
| `Vec<u8>`              | (built-in)     | `BYTEA`    | `BLOB`/`VARBINARY` | `BLOB` |
| `bool`                 | (built-in)     | `BOOLEAN`  | `TINYINT(1)`   | `INTEGER` |

\* MySQL has no native UUID type. Store as `CHAR(36)` and convert at the
   binding boundary (`Uuid::to_string()` on the way in,
   `Uuid::parse_str` on the way out), or as `BINARY(16)` for compactness.

\*\* SQLite has no native decimal type. Stored as TEXT or REAL — the
    `rust_decimal` feature handles the conversion if the column is
    TEXT, but precision is your problem if it's stored as REAL.

## Compile-time-checked queries: use them for hand-written SQL

`query!` and `query_as!` validate column names, parameter types, and
nullability against a live database (or a `sqlx-cli prepare` cache).
They are **wonderful for hand-written queries**:

- The fixed-shape inserts and updates above.
- Aggregation queries (`SELECT COUNT(*), SUM(...)`).
- Migration smoke-tests that read a single known column.

They are **not usable for the WHERE translator** because the SQL shape
is built at runtime. Don't try to wedge `query!` into the translator
path — `QueryBuilder` is the right tool.

To enable offline compile checks (so `cargo build` works without
`DATABASE_URL` in CI):

```bash
cargo install sqlx-cli --no-default-features --features postgres
cargo sqlx prepare    # writes .sqlx/query-*.json
git add .sqlx
```

Refresh the cache whenever you add or change a `query!`/`query_as!`
invocation.

## What this guide deliberately does not cover

- **`Select` / `Include`**: Express projection by writing the SELECT
  column list directly. The generator's `*Select` shape is more useful
  to a GraphQL or REST layer than to SQL.
- **`OrderBy`**: walk `*OrderByWithRelationInput`, push
  `col ASC` / `col DESC` (with `NULLS FIRST`/`LAST` on Postgres,
  computed `col IS NULL` keys on MySQL/SQLite) into the QueryBuilder.
- **Nested writes**: `*CreateNested*` / `*UpdateNested*` are
  transactional cascades. Wrap your write sequence in
  `pool.begin().await?` and execute each step against the transaction
  before committing. The structure mirrors the input shape; the
  choreography is yours.
- **Aggregations**: emit `SELECT COUNT(*), AVG(col), ...` with `query!`
  for known-shape aggregates, or use `QueryBuilder` plus the WHERE
  translator above for dynamic ones.
- **Migrations**: sqlx has `sqlx-cli migrate` for raw SQL migrations.
  The Prisma migrate workflow and sqlx migrations don't compose — pick
  one source of truth. Most teams using this generator already use
  `prisma migrate`; sqlx is only the runtime data path.
