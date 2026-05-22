import type { IR, ModelIR } from "../../ir/types.js";
import type { GeneratorConfig } from "../../types.js";
import type { ModuleResolver } from "../type-ref.js";
import type { Backend } from "./sqlx/backend.js";
import { POSTGRES, SQLITE, MYSQL, ANY } from "./sqlx/backends/index.js";
import { emitSqlx } from "./sqlx/index.js";

/**
 * Layout-supplied context the engine emitters need to resolve type paths.
 *
 * The schema modules can live at different paths depending on the output
 * layout (e.g. `crate::users::User` for per-file vs. `crate::models::user::User`
 * for per-model). The engine emitter is layout-agnostic — it takes a
 * `moduleOf` resolver and uses it for every `crate::<module>::<Type>` path
 * it constructs. When the layout doesn't supply one, the engine falls back
 * to `m.module` / `e.module` (the source-file stem), preserving the
 * per-file behaviour that the unit tests build IRs around.
 */
export interface EngineEmitOpts {
  moduleOf?: ModuleResolver;
}

export interface EngineEmitter {
  // Per-model code that lives in engine/<dirName>/<module>.rs (per-file)
  // or engine/<dirName>/models/<m>.rs (per-model).
  emitForModel(
    m: ModelIR,
    allModels: ReadonlyMap<string, ModelIR>,
    ir: IR,
    cfg: GeneratorConfig,
    opts?: EngineEmitOpts,
  ): string;
  // Shared code (filter pushers etc.) for engine/<dirName>/filters.rs.
  emitShared(ir: IR, cfg: GeneratorConfig, opts?: EngineEmitOpts): string;
  // The directory name under engine/ in the generated output tree.
  dirName: string;
}

export function selectEngine(cfg: GeneratorConfig): EngineEmitter | null {
  if (cfg.engine === null) return null;
  if (cfg.engine === "sqlx-postgres") return emitSqlx(POSTGRES);
  if (cfg.engine === "sqlx-sqlite") return emitSqlx(SQLITE);
  if (cfg.engine === "sqlx-mysql") return emitSqlx(MYSQL);
  if (cfg.engine === "sqlx-any") return emitSqlx(ANY);
  return null;
}

/**
 * Resolve the sqlx `Backend` value for the configured engine, or null when
 * no engine (or a non-sqlx engine) is selected. Used by layouts that need
 * to call into the engine's per-enum emitters directly without going
 * through the `EngineEmitter` surface — see `per-model.ts`.
 */
export function selectBackend(cfg: GeneratorConfig): Backend | null {
  if (cfg.engine === null) return null;
  if (cfg.engine === "sqlx-postgres") return POSTGRES;
  if (cfg.engine === "sqlx-sqlite") return SQLITE;
  if (cfg.engine === "sqlx-mysql") return MYSQL;
  if (cfg.engine === "sqlx-any") return ANY;
  return null;
}
