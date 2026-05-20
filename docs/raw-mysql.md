# Using the generated types with raw MySQL / MariaDB (`mysql_async`)

The patterns from [docs/raw-postgres.md](./raw-postgres.md) carry over;
this guide highlights the MySQL/MariaDB-specific differences. If you're
new to the AST → SQL translation, read the Postgres guide first — the
`*WhereInput` walking strategy is identical.

`mysql_async` is the canonical async Rust driver. The sync `mysql`
crate has the same query/binding shape. Both drivers speak the same
wire protocol against MySQL 5.7+, MySQL 8.x, and MariaDB.

## Setup

```toml
[dependencies]
rust_out = { path = "../rust-out" }

tokio = { version = "1", features = ["full"] }
mysql_async = { version = "0.34", features = ["default-rustls", "chrono", "bigdecimal"] }
uuid = { version = "1", features = ["serde"] }
chrono = { version = "0.4", features = ["serde"] }
serde_json = "1"
```

UUID handling: MySQL has no native UUID type. Store as `CHAR(36)`
(string form, human-readable, the Prisma default) or `BINARY(16)`
(compact). The generator emits `uuid::Uuid` either way; conversion is
on you at the read/write boundary. For `CHAR(36)`, bind `Uuid::to_string()`
on write and `Uuid::parse_str(row_string)` on read.

JSON handling: MySQL 5.7+ has a native `JSON` type. `mysql_async`
returns it as a String — pair with `serde_json::Value` via
`serde_json::from_str` after the read, and `serde_json::to_string`
before the bind.

## Connecting

```rust
use mysql_async::{Pool, prelude::*};

async fn pool() -> mysql_async::Result<Pool> {
    Ok(Pool::new("mysql://app:pass@localhost:3306/app"))
}
```

For the rest of this guide assume `conn: &mut mysql_async::Conn`
obtained from `pool.get_conn().await?`. The translator and binding
code are agnostic to the connection acquisition strategy.

## Reading rows into model structs

```rust
use rust_out::users::User;
use mysql_async::{Row, prelude::*};

fn user_from_row(mut row: Row) -> mysql_async::Result<User> {
    Ok(User {
        id: row.take("id").ok_or(mysql_async::Error::Other("id".into()))?,
        email: row.take("email").ok_or(mysql_async::Error::Other("email".into()))?,
        firm_id: row.take("firm_id").ok_or(mysql_async::Error::Other("firm_id".into()))?,
        firm: None,
        posts: Vec::new(),
    })
}

async fn find_user_by_email(
    conn: &mut mysql_async::Conn,
    email: &str,
) -> mysql_async::Result<Option<User>> {
    let row: Option<Row> = conn
        .exec_first("SELECT id, email, firm_id FROM `User` WHERE email = ?", (email,))
        .await?;
    row.map(user_from_row).transpose()
}
```

Identifier quoting uses **backticks** (`` `User` ``), not double
quotes. The default `ANSI_QUOTES` SQL mode is off; double quotes are
treated as string literals unless explicitly enabled, so a misplaced
`"User"` becomes a confusing query against the literal string "User".

## Inserting and updating

```rust
use rust_out::users::UserUncheckedCreateInput;

async fn insert_user(
    conn: &mut mysql_async::Conn,
    input: &UserUncheckedCreateInput,
) -> mysql_async::Result<u64> {
    conn.exec_drop(
        "INSERT INTO `User` (email, firm_id) VALUES (?, ?)",
        (&input.email, &input.firm_id),
    ).await?;
    Ok(conn.last_insert_id().unwrap_or(0))
}
```

`RETURNING` notes:

- **MariaDB 10.5+** supports `INSERT ... RETURNING col1, col2` and
  `DELETE ... RETURNING ...`. Use it when targeting MariaDB.
- **MySQL 8.x** does NOT support `RETURNING` in any form. Use
  `LAST_INSERT_ID()` for `AUTO_INCREMENT` columns or do a follow-up
  `SELECT` to retrieve synthesized defaults (UUIDs generated via
  `BEFORE INSERT` trigger, etc.).
- Mixing engines: if your code targets both, treat MySQL as the
  baseline and skip `RETURNING` entirely. The extra `SELECT` round-trip
  is the portable cost.

For updates, walk `*UpdateInput`'s field-update operations and build a
`SET col = ?` clause list (same as Postgres). Numeric increment is
`col = col + ?`, multiply is `col = col * ?`, etc. — plain SQL
expressions; MySQL/MariaDB have no dedicated update operators.

## Translating `*WhereInput` to a SQL `WHERE` clause

Same shape as the Postgres translator, with these adjustments:

- **Placeholders are positional `?`**: no `$1`/`$2`. The builder
  doesn't need to track an index; it just emits `?` and appends to
  the params vector in order.
- **`IN (?, ?, …)` instead of `= ANY(?)`**: same constraint as
  SQLite. Emit one placeholder per element.
- **No `ILIKE`**: case sensitivity depends on the column's
  **collation**. A `_ci` collation (the default for `utf8mb4_general_ci`,
  `utf8mb4_unicode_ci`, etc.) gives case-insensitive `LIKE`/`=`
  automatically. A `_bin` or `_cs` collation gives case-sensitive.
  When `QueryMode::Insensitive` is set explicitly, force it with
  `LOWER(col) LIKE LOWER(?)` so the result doesn't depend on column
  collation. When `QueryMode::Default`, leave the column as-is.
- **Identifier quoting**: wrap column and table names in backticks.

### Translator skeleton

```rust
use mysql_async::Value;

pub struct WhereBuilder {
    pub sql: String,
    pub params: Vec<Value>,
}

impl WhereBuilder {
    pub fn new() -> Self { Self { sql: String::new(), params: Vec::new() } }

    fn bind<T: Into<Value>>(&mut self, value: T) -> &'static str {
        self.params.push(value.into());
        "?"
    }
}
```

`mysql_async::Value` implements `From` for all primitive types, plus
the feature-gated `chrono::DateTime`, `bigdecimal::BigDecimal`, etc.,
which matches the generator's emitted types.

### Per-scalar translator (string example)

```rust
use rust_out::shared::filters::{StringFilter, QueryMode};

fn translate_string_filter(
    col: &str,
    f: &StringFilter,
    b: &mut WhereBuilder,
) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    let ci = matches!(f.mode, Some(QueryMode::Insensitive));
    // When QueryMode::Insensitive, force case-insensitivity regardless
    // of column collation by wrapping both sides in LOWER().
    let lhs = if ci { format!("LOWER(`{col}`)") } else { format!("`{col}`") };
    let rhs = |p: &str| if ci { format!("LOWER({p})") } else { p.to_string() };

    if let Some(value) = &f.equals {
        let p = b.bind(value.clone());
        parts.push(format!("{lhs} = {}", rhs(p)));
    }
    if let Some(values) = &f.r#in {
        if values.is_empty() {
            parts.push("FALSE".to_string());
        } else {
            let placeholders: Vec<String> =
                values.iter().map(|v| b.bind(v.clone()).to_string()).collect();
            parts.push(format!("`{col}` IN ({})", placeholders.join(", ")));
        }
    }
    if let Some(value) = &f.lt  { let p = b.bind(value.clone()); parts.push(format!("`{col}` < {p}")); }
    if let Some(value) = &f.lte { let p = b.bind(value.clone()); parts.push(format!("`{col}` <= {p}")); }
    if let Some(value) = &f.gt  { let p = b.bind(value.clone()); parts.push(format!("`{col}` > {p}")); }
    if let Some(value) = &f.gte { let p = b.bind(value.clone()); parts.push(format!("`{col}` >= {p}")); }

    if let Some(value) = &f.contains {
        let p = b.bind(format!("%{value}%"));
        parts.push(format!("{lhs} LIKE {}", rhs(p)));
    }
    if let Some(value) = &f.starts_with {
        let p = b.bind(format!("{value}%"));
        parts.push(format!("{lhs} LIKE {}", rhs(p)));
    }
    if let Some(value) = &f.ends_with {
        let p = b.bind(format!("%{value}"));
        parts.push(format!("{lhs} LIKE {}", rhs(p)));
    }

    if let Some(inner) = &f.not {
        if let Some(sub) = translate_string_filter(col, inner, b) {
            parts.push(format!("NOT ({sub})"));
        }
    }

    if parts.is_empty() { None } else { Some(parts.join(" AND ")) }
}
```

UUID, numeric, and datetime filters drop the `LIKE` branches and the
`QueryMode` handling — they're case-irrelevant by nature.

For UUID-as-`CHAR(36)`, bind `value.to_string()` rather than the raw
`Uuid`. For UUID-as-`BINARY(16)`, convert with `value.as_bytes()`. If
your schema mixes the two, settle the choice schema-wide before
writing the translator — switching halfway is painful.

### Putting it together

```rust
let mut builder = WhereBuilder::new();
let clause = translate_user_where(&where_input, &mut builder)
    .unwrap_or_else(|| "TRUE".to_string());
let sql = format!(
    "SELECT id, email, firm_id FROM `User` WHERE {clause} ORDER BY email"
);

let rows: Vec<Row> = conn.exec(sql, mysql_async::Params::Positional(builder.params)).await?;
let users: Vec<User> = rows.into_iter()
    .map(user_from_row)
    .collect::<mysql_async::Result<_>>()?;
```

## What this guide deliberately does not cover

Same exclusions as the Postgres guide: `Select`/`Include`, `OrderBy`,
nested writes, and aggregations. MySQL's `NULL` sort order differs
from Postgres (`NULL` sorts first in `ASC`, last in `DESC`); the
generator's `SortOrder::AscNullsFirst`/`DescNullsLast` variants match
the MySQL default and need no special handling. The opposite variants
(`AscNullsLast`/`DescNullsFirst`) need a computed column:
`ORDER BY col IS NULL, col ASC`.
