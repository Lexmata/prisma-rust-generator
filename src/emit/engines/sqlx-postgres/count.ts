import type { ModelIR } from "../../../ir/types.js";
import { toSnakeCase } from "../../../ir/names.js";
import type { ModuleResolver } from "../../type-ref.js";

/**
 * Emit a `count` inherent method on the model struct that takes an optional
 * `WhereInput`. When the input is `None` (or evaluates to an empty predicate
 * group), the query falls back to `WHERE TRUE` so the SQL stays valid.
 *
 * The result is `i64` because Postgres `COUNT(*)` returns `bigint`.
 */
export function emitCount(m: ModelIR, moduleOf?: ModuleResolver): string {
  const modelSnake = toSnakeCase(m.name);
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const whereInputPath = `crate::${modulePath}::${m.name}WhereInput`;
  const pushWhere = `crate::engine::sqlx_postgres::${modulePath}::push_${modelSnake}_where`;

  const lines: string[] = [
    `impl ${modelPath} {`,
    `    pub async fn count<'e, E>(`,
    `        executor: E,`,
    `        w: Option<&${whereInputPath}>,`,
    `    ) -> sqlx::Result<i64>`,
    `    where`,
    `        E: sqlx::Executor<'e, Database = sqlx::Postgres>,`,
    `    {`,
    `        let mut qb = sqlx::QueryBuilder::new(`,
    `            r#"SELECT COUNT(*) FROM "${m.dbName}" WHERE "#,`,
    `        );`,
    `        if let Some(w) = w {`,
    `            if !${pushWhere}(&mut qb, w) {`,
    `                qb.push("TRUE");`,
    `            }`,
    `        } else {`,
    `            qb.push("TRUE");`,
    `        }`,
    `        let row = qb.build_query_as::<(i64,)>().fetch_one(executor).await?;`,
    `        Ok(row.0)`,
    `    }`,
    `}`,
    ``,
  ];

  return lines.join("\n");
}
