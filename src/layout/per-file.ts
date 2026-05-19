import type { IR } from "../ir/types.js";
import type { GeneratorConfig } from "../types.js";
import { emitFileHeader } from "./header.js";
import { emitModel } from "../emit/model.js";
import { emitEnum } from "../emit/enums.js";
import { emitModelWhereInput } from "../emit/filters/model.js";
import { emitRelationFilters } from "../emit/filters/relation.js";
import { emitWhereUniqueInput } from "../emit/inputs/where-unique.js";
import { emitOrderByWithRelationInput } from "../emit/inputs/order-by.js";
import { emitSelectInput, emitIncludeInput } from "../emit/inputs/select-include.js";
import { emitEnumFilter } from "../emit/filters/enum.js";
import { emitSharedScalarFilters } from "../emit/filters/scalar.js";
import { emitCommonSharedTypes } from "../emit/shared/common.js";
import type { ModuleResolver } from "../emit/type-ref.js";

export function emitPerFile(ir: IR, cfg: GeneratorConfig): Map<string, string> {
  const files = new Map<string, string>();
  const moduleOf = makeModuleResolver(ir);
  const modules = collectModules(ir);

  for (const module of modules) {
    const modelsInModule = ir.models.filter((m) => m.module === module);
    const enumsInModule = ir.enums.filter((e) => e.module === module);
    const parts: string[] = [emitFileHeader(cfg)];

    if (cfg.serde) parts.push(`use serde::{Deserialize, Serialize};\n`);

    for (const e of enumsInModule) {
      parts.push(emitEnum(e, { serde: cfg.serde, vis: cfg.moduleVisibility }));
      parts.push(
        emitEnumFilter(e.name, e.module, {
          serde: cfg.serde,
          vis: cfg.moduleVisibility,
        }),
      );
    }
    for (const m of modelsInModule) {
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
        emitRelationFilters(m.name, m.module, {
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
    }
    files.set(`${module}.rs`, parts.join("\n"));
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

  const rootName = cfg.moduleName ? "mod.rs" : "lib.rs";
  const lib: string[] = [emitFileHeader(cfg)];
  for (const mod of [...modules].sort()) lib.push(`pub mod ${mod};`);
  lib.push(`pub mod shared;`);
  lib.push(`pub use shared::*;`);
  files.set(rootName, lib.join("\n") + "\n");

  return files;
}

function collectModules(ir: IR): Set<string> {
  const s = new Set<string>();
  for (const m of ir.models) s.add(m.module);
  for (const e of ir.enums) s.add(e.module);
  return s;
}

function makeModuleResolver(ir: IR): ModuleResolver {
  const moduleByName = new Map<string, string>();
  for (const m of ir.models) moduleByName.set(m.name, m.module);
  for (const e of ir.enums) moduleByName.set(e.name, e.module);
  return (name: string): string => moduleByName.get(name) ?? "shared";
}
