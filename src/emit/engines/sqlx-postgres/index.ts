import type { EngineEmitter } from "../index.js";
import { emitAggregate } from "./aggregate.js";
import { emitCount } from "./count.js";
import { emitSqlxEnumImpls } from "./enums.js";
import { emitFilterPushers } from "./filter-pushers.js";
import { emitFinds } from "./finds.js";
import { emitFromRow } from "./from-row.js";
import { emitWhereTranslator } from "./where-translator.js";
import { emitWrites } from "./writes.js";

export const emitSqlxPostgres: EngineEmitter = {
  dirName: "sqlx_postgres",
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
          .map((e) => emitSqlxEnumImpls(e, moduleOf))
          .join("\n")
      : "";
    return [
      enumImpls,
      emitFromRow(m, moduleOf),
      emitWhereTranslator(m, allModels, moduleOf),
      ``,
      emitFinds(m, moduleOf),
      emitCount(m, moduleOf),
      emitWrites(m, moduleOf),
      emitAggregate(m, moduleOf),
    ].join("\n");
  },
  emitShared(ir, cfg, opts): string {
    const pusherOpts: import("./filter-pushers.js").FilterPusherOpts = {
      serde: cfg.serde,
      decimalCrate: cfg.decimalCrate,
    };
    if (opts?.moduleOf) pusherOpts.moduleOf = opts.moduleOf;
    return [
      `// engine/sqlx_postgres/filters.rs`,
      ``,
      emitFilterPushers(ir, pusherOpts),
    ].join("\n");
  },
};
