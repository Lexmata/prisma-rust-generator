import type { ModelIR, FieldIR } from "../../../ir/types.js";
import { toSnakeCase } from "../../../ir/names.js";
import type { Backend } from "./backend.js";
import { bindFromBorrow } from "./bind-ref.js";
import { quoteIdent } from "./quote-ident.js";
import type { ModuleResolver } from "../../type-ref.js";

/**
 * Build the comma-separated, backend-quoted column list for a `SELECT` against
 * the model's database table. Order matches `m.scalarFields` so a `FromRow`
 * impl that reads by name stays correct regardless of column ordering.
 */
function colsSelect(m: ModelIR, backend: Backend): string {
  return m.scalarFields.map((f) => quoteIdent(backend, f.dbName)).join(", ");
}

/**
 * Locate the model's single `@id` scalar field. Returns `null` for composite
 * primary keys (which the v1 emitter doesn't support yet) and for models
 * lacking a primary key entirely (shouldn't happen in well-formed schemas).
 */
function singleIdField(m: ModelIR): FieldIR | null {
  if (m.idFields.length !== 1) return null;
  const idPrismaName = m.idFields[0]!;
  return m.scalarFields.find((f) => f.prismaName === idPrismaName) ?? null;
}

function pushWhereCall(
  backend: Backend,
  module: string,
  modelSnake: string,
): string {
  return `crate::engine::${backend.dirName}::${module}::push_${modelSnake}_where`;
}

/**
 * Emit `find_unique`, `find_first`, and the `find_many` builder for the model.
 *
 * The three operations are bundled because they share column-list construction
 * and module-path resolution. They're hung off the model struct as inherent
 * impl blocks so callers write `User::find_unique(&pool, &input)` without
 * needing the engine modules in scope.
 *
 * Composite-`@id` models emit a `todo!()` body for `find_unique` — running
 * that path panics at runtime rather than producing incorrect SQL silently.
 * Callers with composite uniques should use `find_first` against a
 * `WhereInput` for now.
 */
export function emitFinds(
  m: ModelIR,
  backend: Backend,
  moduleOf?: ModuleResolver,
): string {
  const cols = colsSelect(m, backend);
  const modelSnake = toSnakeCase(m.name);
  const modulePath = moduleOf ? moduleOf(m.name) : m.module;
  const modelPath = `crate::${modulePath}::${m.name}`;
  const whereInputPath = `crate::${modulePath}::${m.name}WhereInput`;
  const whereUniquePath = `crate::${modulePath}::${m.name}WhereUniqueInput`;
  const orderByPath = `crate::${modulePath}::${m.name}OrderByWithRelationInput`;
  const builderName = `${m.name}FindManyBuilder`;
  const pushWhere = pushWhereCall(backend, modulePath, modelSnake);
  const tableQ = quoteIdent(backend, m.dbName);

  const findUniqueBody: string[] = [];
  const idField = singleIdField(m);
  if (idField === null) {
    findUniqueBody.push(
      `        // Composite primary keys are deferred to v2 of the sqlx-postgres engine.`,
      `        // Use \`find_first\` against a \`WhereInput\` instead for now.`,
      `        let _ = (executor, w);`,
      `        todo!("composite unique not yet supported")`,
    );
  } else {
    const idCol = quoteIdent(backend, idField.dbName);
    findUniqueBody.push(
      `        let cols = ${JSON.stringify(cols)};`,
      `        let mut qb = sqlx::QueryBuilder::new(format!(`,
      `            r#"SELECT {} FROM ${tableQ} WHERE "#,`,
      `            cols,`,
      `        ));`,
      `        // For v1, support only the @id field. Composite uniques are out of scope.`,
      `        // The WhereUniqueInput has Option<T> per @id/@unique field; we pick the`,
      `        // first Some(). Multi-Some inputs cover composite uniques — TODO Task v2.`,
      `        if let Some(value) = &w.${idField.rustName} {`,
      `            qb.push(${JSON.stringify(`${idCol} = `)});`,
      `            qb.push_bind(${bindFromBorrow(idField, "value")});`,
      `        } else {`,
      `            return Ok(None);`,
      `        }`,
      `        qb.build_query_as::<Self>().fetch_optional(executor).await`,
    );
  }

  const findUniqueImpl: string[] = [
    `impl ${modelPath} {`,
    `    pub async fn find_unique<'e, E>(`,
    `        executor: E,`,
    `        w: &${whereUniquePath},`,
    `    ) -> sqlx::Result<Option<Self>>`,
    `    where`,
    `        E: sqlx::Executor<'e, Database = ${backend.dbType}>,`,
    `    {`,
    ...findUniqueBody,
    `    }`,
    `}`,
  ];

  const findFirstImpl: string[] = [
    `impl ${modelPath} {`,
    `    pub async fn find_first<'e, E>(`,
    `        executor: E,`,
    `        w: &${whereInputPath},`,
    `    ) -> sqlx::Result<Option<Self>>`,
    `    where`,
    `        E: sqlx::Executor<'e, Database = ${backend.dbType}>,`,
    `    {`,
    `        let mut qb = sqlx::QueryBuilder::new(`,
    `            r#"SELECT ${cols} FROM ${tableQ} WHERE "#,`,
    `        );`,
    `        if !${pushWhere}(&mut qb, w) {`,
    `            qb.push("TRUE");`,
    `        }`,
    `        qb.push(" LIMIT 1");`,
    `        qb.build_query_as::<Self>().fetch_optional(executor).await`,
    `    }`,
    `}`,
  ];

  // ORDER BY walk: one per-scalar `if let Some(o)` block. Relations are
  // ignored for v1 (sorting through a relation requires a JOIN we don't emit
  // yet); we bind them to `_` to keep the unused-field lint quiet.
  const orderByBlocks: string[] = [];
  for (const f of m.scalarFields) {
    const colQ = quoteIdent(backend, f.dbName);
    orderByBlocks.push(
      `                if let Some(o) = ob.${f.rustName} {`,
      `                    if !first { qb.push(", "); }`,
      `                    first = false;`,
      `                    qb.push(${JSON.stringify(`${colQ} `)});`,
      `                    qb.push(crate::engine::${backend.dirName}::filters::sort_order_sql(o));`,
      `                }`,
    );
  }
  for (const r of m.relations) {
    orderByBlocks.push(
      `                // TODO(prisma-rust-generator): sorting by relation \`${r.prismaName}\` not yet supported.`,
      `                let _ = &ob.${r.rustName};`,
    );
  }

  const builder: string[] = [
    `pub struct ${builderName}<'a, E> {`,
    `    executor: E,`,
    `    where_input: &'a ${whereInputPath},`,
    `    order_by: Vec<${orderByPath}>,`,
    `    take: Option<i64>,`,
    `    skip: Option<i64>,`,
    `}`,
    ``,
    `impl<'a, E> ${builderName}<'a, E> {`,
    `    pub fn order_by(`,
    `        mut self,`,
    `        order_by: &[${orderByPath}],`,
    `    ) -> Self {`,
    `        self.order_by = order_by.to_vec();`,
    `        self`,
    `    }`,
    ``,
    `    pub fn take(mut self, n: i64) -> Self {`,
    `        self.take = Some(n);`,
    `        self`,
    `    }`,
    ``,
    `    pub fn skip(mut self, n: i64) -> Self {`,
    `        self.skip = Some(n);`,
    `        self`,
    `    }`,
    ``,
    `    pub async fn exec<'e>(self) -> sqlx::Result<Vec<${modelPath}>>`,
    `    where`,
    `        E: sqlx::Executor<'e, Database = ${backend.dbType}>,`,
    `    {`,
    `        let mut qb = sqlx::QueryBuilder::new(`,
    `            r#"SELECT ${cols} FROM ${tableQ} WHERE "#,`,
    `        );`,
    `        if !${pushWhere}(&mut qb, self.where_input) {`,
    `            qb.push("TRUE");`,
    `        }`,
    `        if !self.order_by.is_empty() {`,
    `            qb.push(" ORDER BY ");`,
    `            let mut first = true;`,
    `            for ob in &self.order_by {`,
    ...orderByBlocks,
    `            }`,
    `        }`,
    `        if let Some(n) = self.take {`,
    `            qb.push(" LIMIT ");`,
    `            qb.push_bind(n);`,
    `        }`,
    `        if let Some(n) = self.skip {`,
    `            qb.push(" OFFSET ");`,
    `            qb.push_bind(n);`,
    `        }`,
    `        qb.build_query_as::<${modelPath}>().fetch_all(self.executor).await`,
    `    }`,
    `}`,
    ``,
    `impl ${modelPath} {`,
    `    pub fn find_many<'a, E>(`,
    `        executor: E,`,
    `        w: &'a ${whereInputPath},`,
    `    ) -> ${builderName}<'a, E> {`,
    `        ${builderName} {`,
    `            executor,`,
    `            where_input: w,`,
    `            order_by: Vec::new(),`,
    `            take: None,`,
    `            skip: None,`,
    `        }`,
    `    }`,
    `}`,
  ];

  return [
    ...findUniqueImpl,
    "",
    ...findFirstImpl,
    "",
    ...builder,
    "",
  ].join("\n");
}
