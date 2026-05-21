import type { IR } from "../ir/types.js";
import type { GeneratorConfig } from "../types.js";
import { CRATE_RECURSION_LIMIT_ATTR, emitFileHeader } from "./header.js";
import { emitModel } from "../emit/model.js";
import { emitEnum } from "../emit/enums.js";
import { emitModelWhereInput } from "../emit/filters/model.js";
import { emitRelationFilters } from "../emit/filters/relation.js";
import { emitWhereUniqueInput } from "../emit/inputs/where-unique.js";
import { emitOrderByWithRelationInput } from "../emit/inputs/order-by.js";
import { emitSelectInput, emitIncludeInput } from "../emit/inputs/select-include.js";
import { emitCreateInputs } from "../emit/inputs/create.js";
import { emitUpdateInputs } from "../emit/inputs/update.js";
import { emitNestedInputsForModel } from "../emit/inputs/nested.js";
import { emitModelScalarWhereInput } from "../emit/inputs/scalar-where.js";
import { emitAggregateInputs } from "../emit/inputs/aggregate.js";
import { emitEnumFilter } from "../emit/filters/enum.js";
import { emitSharedScalarFilters } from "../emit/filters/scalar.js";
import { emitCommonSharedTypes } from "../emit/shared/common.js";
import { emitFieldUpdateOps } from "../emit/inputs/field-update-ops.js";
import { toSnakeCase } from "../ir/names.js";
import type { ModuleResolver } from "../emit/type-ref.js";
import { selectBackend, selectEngine } from "../emit/engines/index.js";
import type { Backend } from "../emit/engines/sqlx/backend.js";
import { emitSqlxEnumImpls } from "../emit/engines/sqlx/enums.js";
import type { EnumIR } from "../ir/types.js";

export function emitPerModel(ir: IR, cfg: GeneratorConfig): Map<string, string> {
  const files = new Map<string, string>();
  const allModels = new Map(ir.models.map((m) => [m.name, m]));
  const moduleOf: ModuleResolver = (name) => {
    const m = ir.models.find((x) => x.name === name);
    if (m) return `models::${toSnakeCase(m.name)}`;
    const e = ir.enums.find((x) => x.name === name);
    if (e) return `enums::${toSnakeCase(e.name)}`;
    return "shared";
  };

  for (const m of ir.models) {
    const parts: string[] = [emitFileHeader(cfg)];
    if (cfg.serde) parts.push(`use serde::{Deserialize, Serialize};\n`);
    parts.push(
      emitModel(m, {
        serde: cfg.serde,
        vis: cfg.moduleVisibility,
        eqEligible: ir.modelEqEligibility.get(m.name) ?? true,
        moduleOf,
        extraDerives: cfg.extraDerives,
      }),
    );
    parts.push(
      emitModelWhereInput(m, {
        serde: cfg.serde,
        vis: cfg.moduleVisibility,
        moduleOf,
      }),
    );
    parts.push(
      emitRelationFilters(m.name, moduleOf(m.name), {
        serde: cfg.serde,
        vis: cfg.moduleVisibility,
      }),
    );
    parts.push(
      emitWhereUniqueInput(m, { serde: cfg.serde, vis: cfg.moduleVisibility }),
    );
    parts.push(
      emitOrderByWithRelationInput(m, {
        serde: cfg.serde,
        vis: cfg.moduleVisibility,
        moduleOf,
      }),
    );
    parts.push(
      emitSelectInput(m, { serde: cfg.serde, vis: cfg.moduleVisibility, moduleOf }),
    );
    parts.push(
      emitIncludeInput(m, { serde: cfg.serde, vis: cfg.moduleVisibility, moduleOf }),
    );
    parts.push(
      emitCreateInputs(m, { serde: cfg.serde, vis: cfg.moduleVisibility, moduleOf }),
    );
    parts.push(
      emitUpdateInputs(m, { serde: cfg.serde, vis: cfg.moduleVisibility, moduleOf }),
    );
    parts.push(
      emitNestedInputsForModel(m, allModels, {
        serde: cfg.serde,
        vis: cfg.moduleVisibility,
        moduleOf,
      }),
    );
    parts.push(
      emitModelScalarWhereInput(m, {
        serde: cfg.serde,
        vis: cfg.moduleVisibility,
        moduleOf,
      }),
    );
    parts.push(
      emitAggregateInputs(m, { serde: cfg.serde, vis: cfg.moduleVisibility }),
    );
    files.set(`models/${toSnakeCase(m.name)}.rs`, parts.join("\n"));
  }

  for (const e of ir.enums) {
    const parts: string[] = [emitFileHeader(cfg)];
    if (cfg.serde) parts.push(`use serde::{Deserialize, Serialize};\n`);
    parts.push(emitEnum(e, { serde: cfg.serde, vis: cfg.moduleVisibility }));
    parts.push(
      emitEnumFilter(e.name, moduleOf(e.name), {
        serde: cfg.serde,
        vis: cfg.moduleVisibility,
      }),
    );
    files.set(`enums/${toSnakeCase(e.name)}.rs`, parts.join("\n"));
  }

  const sharedParts: string[] = [emitFileHeader(cfg)];
  if (cfg.serde) sharedParts.push(`use serde::{Deserialize, Serialize};\n`);
  sharedParts.push(emitCommonSharedTypes({ serde: cfg.serde, vis: cfg.moduleVisibility }));
  sharedParts.push(emitSharedScalarFilters({ serde: cfg.serde, vis: cfg.moduleVisibility, cfg }));
  sharedParts.push(emitFieldUpdateOps({ serde: cfg.serde, vis: cfg.moduleVisibility, cfg }));
  files.set("shared/filters.rs", sharedParts.join("\n"));
  files.set(
    "shared/mod.rs",
    `${emitFileHeader(cfg)}\npub mod filters;\npub use filters::*;\n`,
  );

  if (ir.models.length > 0) {
    const modelsMod = ir.models
      .map((m) => `pub mod ${toSnakeCase(m.name)};`)
      .join("\n");
    files.set("models/mod.rs", `${emitFileHeader(cfg)}\n${modelsMod}\n`);
  }
  if (ir.enums.length > 0) {
    const enumsMod = ir.enums
      .map((e) => `pub mod ${toSnakeCase(e.name)};`)
      .join("\n");
    files.set("enums/mod.rs", `${emitFileHeader(cfg)}\n${enumsMod}\n`);
  }

  const engine = selectEngine(cfg);
  const backend = selectBackend(cfg);
  if (engine && backend) {
    for (const m of ir.models) {
      const parts: string[] = [
        emitFileHeader(cfg),
        `use sqlx::Row as _;`,
        "",
        engine.emitForModel(m, allModels, ir, cfg, { moduleOf }),
      ];
      const file = `engine/${engine.dirName}/models/${toSnakeCase(m.name)}.rs`;
      files.set(file, parts.join("\n"));
    }

    // Per-enum engine files — host sqlx Type/Decode/Encode impls for enums.
    // In per-model layout each enum lives in its own module
    // (`crate::enums::<snake>`), so the natural place for its sqlx impls is a
    // parallel `engine/<dir>/enums/<snake>.rs`. `emitForModel` above only
    // groups enum impls onto the first model in the same resolved module —
    // since enums and models never share a module in per-model layout, the
    // per-model loop produces no enum impls. We emit them here explicitly.
    for (const e of ir.enums) {
      const parts: string[] = [
        emitFileHeader(cfg),
        "",
        // Inline the enum impls (same emitter the per-file engine uses).
        // Lifted here to avoid expanding the EngineEmitter surface for a
        // layout-specific need.
        ...renderEnumEngineFile(e, backend, moduleOf),
      ];
      const file = `engine/${engine.dirName}/enums/${toSnakeCase(e.name)}.rs`;
      files.set(file, parts.join("\n"));
    }

    // Shared filter pushers
    files.set(
      `engine/${engine.dirName}/filters.rs`,
      [emitFileHeader(cfg), engine.emitShared(ir, cfg, { moduleOf })].join("\n"),
    );

    // engine/<dirName>/models/mod.rs
    const modelMods: string[] = [emitFileHeader(cfg)];
    for (const m of ir.models) modelMods.push(`pub mod ${toSnakeCase(m.name)};`);
    files.set(
      `engine/${engine.dirName}/models/mod.rs`,
      modelMods.join("\n") + "\n",
    );

    // engine/<dirName>/enums/mod.rs (only when there are enums)
    if (ir.enums.length > 0) {
      const enumMods: string[] = [emitFileHeader(cfg)];
      for (const e of ir.enums) enumMods.push(`pub mod ${toSnakeCase(e.name)};`);
      files.set(
        `engine/${engine.dirName}/enums/mod.rs`,
        enumMods.join("\n") + "\n",
      );
    }

    // engine/<dirName>/mod.rs
    const engineMods: string[] = [
      emitFileHeader(cfg),
      `pub mod models;`,
      ...(ir.enums.length > 0 ? [`pub mod enums;`] : []),
      `pub mod filters;`,
    ];
    files.set(
      `engine/${engine.dirName}/mod.rs`,
      engineMods.join("\n") + "\n",
    );

    // engine/mod.rs (top-level)
    files.set(
      "engine/mod.rs",
      [emitFileHeader(cfg), `pub mod ${engine.dirName};`].join("\n") + "\n",
    );
  }

  const rootName = cfg.moduleName ? "mod.rs" : "lib.rs";
  const lib: string[] = [emitFileHeader(cfg), CRATE_RECURSION_LIMIT_ATTR];
  if (ir.models.length > 0) lib.push(`pub mod models;`);
  if (ir.enums.length > 0) lib.push(`pub mod enums;`);
  if (engine) lib.push(`pub mod engine;`);
  lib.push(`pub mod shared;`, `pub use shared::*;`);
  files.set(rootName, lib.join("\n") + "\n");

  return files;
}

/**
 * Per-model layout helper: emit the sqlx Type/Decode/Encode impls for a
 * single enum into its own `engine/<dir>/enums/<snake>.rs` file. Defers to
 * the existing enum-impl emitter.
 */
function renderEnumEngineFile(
  e: EnumIR,
  backend: Backend,
  moduleOf: ModuleResolver,
): string[] {
  return [emitSqlxEnumImpls(e, backend, moduleOf)];
}
