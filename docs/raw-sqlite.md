# Using the generated types with raw SQLite (`rusqlite`)

The patterns from [docs/raw-postgres.md](./raw-postgres.md) carry over;
this guide highlights the SQLite-specific differences. If you're new to
the AST → SQL translation, read the Postgres guide first — the
`*WhereInput` walking strategy is identical.

`rusqlite` is the canonical sync Rust SQLite driver. For async, wrap it
with `tokio-rusqlite` (which queues calls on a dedicated worker thread)
or `sqlx` with the `sqlite` feature. The query code in this guide does
not change between sync and async wrappers.

## Setup

```toml
[dependencies]
rust_out = { path = "../rust-out" }

rusqlite = { version = "0.32", features = ["bundled", "uuid", "chrono", "serde_json"] }
uuid = { version = "1", features = ["serde"] }
chrono = { version = "0.4", features = ["serde"] }
serde_json = "1"
```

The `uuid`, `chrono`, and `serde_json` features add the `FromSql`/`ToSql`
impls for the generator's default scalar types. SQLite stores UUIDs as
TEXT and DateTimes as TEXT (ISO-8601) or INTEGER (Unix epoch) — the
`chrono` and `uuid` features handle both directions transparently as
long as the column types match.

## Connecting

```rust
use rusqlite::Connection;

fn open() -> rusqlite::Result<Connection> {
    Connection::open("app.db")
}
```

For pooled / multi-threaded access, use `r2d2_sqlite::SqliteConnectionManager`
with `r2d2`. The translator and binding code below are agnostic to the
pool wrapper.

## Reading rows into model structs

```rust
use rust_out::users::User;
use rusqlite::Row;

fn user_from_row(row: &Row<'_>) -> rusqlite::Result<User> {
    Ok(User {
        id: row.get("id")?,
        email: row.get("email")?,
        firm_id: row.get("firm_id")?,
        firm: None,
        posts: Vec::new(),
    })
}

fn find_user_by_email(
    conn: &Connection,
    email: &str,
) -> rusqlite::Result<Option<User>> {
    conn.query_row(
        r#"SELECT id, email, firm_id FROM "User" WHERE email = ?1"#,
        [email],
        user_from_row,
    ).optional()
}
```

`Row::get(name)` looks up columns by name (with a small overhead) or by
positional index. Either is fine — name-based reads survive `SELECT *`
column-reordering and are worth the cycles for clarity.

## Inserting and updating

Insertion uses `UncheckedCreateInput` the same way as the Postgres guide.
The notable SQLite differences:

- Placeholders are `?1`, `?2`, `?3`… (or just `?` for positional). Mix
  styles at your own risk.
- `RETURNING` works on SQLite 3.35+ (March 2021). If you need to
  support older builds, use `Connection::last_insert_rowid()` for
  `INTEGER PRIMARY KEY` ids or do a follow-up `SELECT` for synthesized
  defaults (UUIDs, timestamps).

```rust
use rust_out::users::UserUncheckedCreateInput;

fn insert_user(
    conn: &Connection,
    input: &UserUncheckedCreateInput,
) -> rusqlite::Result<i64> {
    conn.execute(
        r#"INSERT INTO "User" (email, firm_id) VALUES (?1, ?2)"#,
        rusqlite::params![input.email, input.firm_id],
    )?;
    Ok(conn.last_insert_rowid())
}
```

For updates, walk `*UpdateInput`'s field-update operations and build a
`SET col = ?` clause list (same pattern as Postgres). SQLite does not
have separate numeric operator forms — `col = col + ?1` for increment,
`col = col * ?1` for multiply, etc., as plain SQL expressions.

## Translating `*WhereInput` to a SQL `WHERE` clause

The shape mirrors the Postgres translator. The differences:

- **Placeholders**: `?1`, `?2`, … instead of `$1`, `$2`. The builder
  tracks a counter and inserts the right marker.
- **`IN (?, ?, …)` instead of `= ANY(?)`**: SQLite does not have
  array parameters. The translator needs to emit one placeholder per
  list element and bind them individually.
- **`LIKE` is case-insensitive for ASCII**: SQLite's `LIKE` operator
  is case-insensitive by default for the ASCII range only. For
  unicode-aware case-insensitive matching, use
  `COLLATE NOCASE` on the column or rewrite to `LOWER(col) LIKE
  LOWER(?)`. Treat `QueryMode::Insensitive` as a request for the
  `LOWER(...)` form for correctness across locales.

### Translator skeleton

```rust
use rusqlite::types::ToSqlOutput;
use rusqlite::ToSql;

pub struct WhereBuilder {
    pub sql: String,
    pub params: Vec<Box<dyn ToSql>>,
}

impl WhereBuilder {
    pub fn new() -> Self { Self { sql: String::new(), params: Vec::new() } }

    fn bind<T: ToSql + 'static>(&mut self, value: T) -> String {
        self.params.push(Box::new(value));
        format!("?{}", self.params.len())
    }

    /// Borrow params as the slice rusqlite wants.
    pub fn param_refs(&self) -> Vec<&dyn ToSql> {
        self.params.iter().map(|b| &**b as &dyn ToSql).collect()
    }
}
```

### Top-level translator

Same structure as the Postgres guide — `clauses: Vec<String>`,
recurse into `and`/`or`/`not`, join with `" AND "`. The only thing
that changes is the per-scalar translator's emit.

### Per-scalar translator (string + uuid example)

```rust
use rust_out::shared::filters::{StringFilter, UuidFilter, QueryMode};

fn translate_string_filter(
    col: &str,
    f: &StringFilter,
    b: &mut WhereBuilder,
) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    let ci = matches!(f.mode, Some(QueryMode::Insensitive));
    // SQLite's LIKE is ASCII-only case-insensitive; for safety wrap both
    // sides in LOWER() when QueryMode::Insensitive is requested.
    let wrap = |c: &str| if ci { format!("LOWER({c})") } else { c.to_string() };

    if let Some(value) = &f.equals {
        let p = b.bind(value.clone());
        parts.push(format!("{} = {}", wrap(col), if ci { format!("LOWER({p})") } else { p }));
    }
    if let Some(values) = &f.r#in {
        if values.is_empty() {
            parts.push("0".to_string()); // SQLite uses 0/1 for false/true
        } else {
            let placeholders: Vec<String> = values.iter().map(|v| b.bind(v.clone())).collect();
            parts.push(format!("{col} IN ({})", placeholders.join(", ")));
        }
    }
    if let Some(value) = &f.lt  { let p = b.bind(value.clone()); parts.push(format!("{col} < {p}")); }
    if let Some(value) = &f.lte { let p = b.bind(value.clone()); parts.push(format!("{col} <= {p}")); }
    if let Some(value) = &f.gt  { let p = b.bind(value.clone()); parts.push(format!("{col} > {p}")); }
    if let Some(value) = &f.gte { let p = b.bind(value.clone()); parts.push(format!("{col} >= {p}")); }

    if let Some(value) = &f.contains {
        let p = b.bind(format!("%{value}%"));
        parts.push(format!("{} LIKE {}", wrap(col), if ci { format!("LOWER({p})") } else { p }));
    }
    if let Some(value) = &f.starts_with {
        let p = b.bind(format!("{value}%"));
        parts.push(format!("{} LIKE {}", wrap(col), if ci { format!("LOWER({p})") } else { p }));
    }
    if let Some(value) = &f.ends_with {
        let p = b.bind(format!("%{value}"));
        parts.push(format!("{} LIKE {}", wrap(col), if ci { format!("LOWER({p})") } else { p }));
    }

    if let Some(inner) = &f.not {
        if let Some(sub) = translate_string_filter(col, inner, b) {
            parts.push(format!("NOT ({sub})"));
        }
    }

    if parts.is_empty() { None } else { Some(parts.join(" AND ")) }
}
```

UUID and numeric filters are even simpler — drop the `LIKE` branches
and ignore `QueryMode`. Pattern is identical otherwise.

### Putting it together

```rust
let mut builder = WhereBuilder::new();
let clause = translate_user_where(&where_input, &mut builder)
    .unwrap_or_else(|| "1".to_string()); // SQLite: 1 = true
let sql = format!(
    r#"SELECT id, email, firm_id FROM "User" WHERE {clause} ORDER BY email"#
);

let mut stmt = conn.prepare(&sql)?;
let rows = stmt.query_map(
    rusqlite::params_from_iter(builder.param_refs()),
    user_from_row,
)?;
let users: Vec<User> = rows.collect::<rusqlite::Result<_>>()?;
```

`params_from_iter` consumes a homogeneous-`ToSql` iterator and matches
the SQL's positional `?n` placeholders by order.

## What this guide deliberately does not cover

Same exclusions as the Postgres guide: `Select`/`Include`,
`OrderBy`, nested writes, and aggregations. SQLite's syntax differs in
small ways (`COALESCE` for null-collation, no native `NULLS FIRST` —
emit a computed `IS NULL` sort key) but the translation strategy is
identical.
