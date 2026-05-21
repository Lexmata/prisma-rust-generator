import type { EngineEmitter } from "../index.js";
import { emitAggregate } from "./aggregate.js";
import type { Backend } from "./backend.js";
import { emitCount } from "./count.js";
import { emitSqlxEnumImpls } from "./enums.js";
import { emitFilterPushers } from "./filter-pushers.js";
import { emitFinds } from "./finds.js";
import { emitFromRow } from "./from-row.js";
import { emitWhereTranslator } from "./where-translator.js";
import { emitWrites } from "./writes.js";

/**
 * Build an `EngineEmitter` for the shared sqlx backend, closing over the
 * supplied `Backend` value. The dispatcher (`selectEngine` in
 * `src/emit/engines/index.ts`) instantiates this once per `cfg.engine` —
 * `emitSqlx(POSTGRES)` for `sqlx-postgres`, `emitSqlx(SQLITE)` for the
 * forthcoming SQLite engine — so every per-file emitter call below threads
 * the same backend value through.
 */
export function emitSqlx(backend: Backend): EngineEmitter {
  return {
    dirName: backend.dirName,
    emitForModel(m, allModels, ir, _cfg, opts): string {
      const moduleOf = opts?.moduleOf;
      // Enum sqlx-impl placement depends on the layout. Group enums whose
      // resolved module matches the current model's resolved module and emit
      // their `Type`/`Decode`/`Encode` impls once, attached to the first
      // model in that group. In per-file layout enums and models often share
      // a file (so this is where the impls land); in per-model layout enums
      // live in their own module — the per-model layout writes enum impls
      // out separately and this path emits an empty string.
      const thisModuleKey = moduleOf ? moduleOf(m.name) : m.module;
      const isFirstModelInModule =
        ir.models.find((other) => {
          const otherKey = moduleOf ? moduleOf(other.name) : other.module;
          return otherKey === thisModuleKey;
        }) === m;
      const enumImpls = isFirstModelInModule
        ? ir.enums
            .filter((e) => {
              const eKey = moduleOf ? moduleOf(e.name) : e.module;
              return eKey === thisModuleKey;
            })
            .map((e) => emitSqlxEnumImpls(e, backend, moduleOf))
            .join("\n")
        : "";
      return [
        enumImpls,
        emitFromRow(m, backend, moduleOf),
        emitWhereTranslator(m, allModels, backend, moduleOf),
        ``,
        emitFinds(m, backend, moduleOf),
        emitCount(m, backend, moduleOf),
        emitWrites(m, backend, moduleOf),
        emitAggregate(m, backend, moduleOf),
      ].join("\n");
    },
    emitShared(ir, cfg, opts): string {
      const pusherOpts: import("./filter-pushers.js").FilterPusherOpts = {
        serde: cfg.serde,
        decimalCrate: cfg.decimalCrate,
      };
      if (opts?.moduleOf) pusherOpts.moduleOf = opts.moduleOf;
      return [
        `// engine/${backend.dirName}/filters.rs`,
        ``,
        emitFilterPushers(ir, backend, pusherOpts),
      ].join("\n");
    },
  };
}
