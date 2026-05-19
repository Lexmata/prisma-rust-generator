import type { IR } from "../ir/types.js";
import type { GeneratorConfig } from "../types.js";
import { emitFileHeader } from "./header.js";
import { emitModel } from "../emit/model.js";
import { emitEnum } from "../emit/enums.js";
import { emitModelWhereInput } from "../emit/filters/model.js";
import { emitRelationFilters } from "../emit/filters/relation.js";
import { emitEnumFilter } from "../emit/filters/enum.js";
import { emitSharedScalarFilters } from "../emit/filters/scalar.js";
import { emitCommonSharedTypes } from "../emit/shared/common.js";
import { toSnakeCase } from "../ir/names.js";
import type { ModuleResolver } from "../emit/type-ref.js";

export function emitPerModel(ir: IR, cfg: GeneratorConfig): Map<string, string> {
  const files = new Map<string, string>();
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
  sharedParts.push(emitSharedScalarFilters({ serde: cfg.serde, vis: cfg.moduleVisibility }));
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

  const rootName = cfg.moduleName ? "mod.rs" : "lib.rs";
  const lib: string[] = [emitFileHeader(cfg)];
  if (ir.models.length > 0) lib.push(`pub mod models;`);
  if (ir.enums.length > 0) lib.push(`pub mod enums;`);
  lib.push(`pub mod shared;`);
  lib.push(`pub use shared::*;`);
  files.set(rootName, lib.join("\n") + "\n");

  return files;
}
