import type { IR } from "../ir/types.js";
import type { GeneratorConfig } from "../types.js";
import { emitFileHeader } from "./header.js";
import { emitModel } from "../emit/model.js";
import { emitEnum } from "../emit/enums.js";
import { emitModelWhereInput } from "../emit/filters/model.js";
import { emitRelationFilters } from "../emit/filters/relation.js";
import { emitWhereUniqueInput } from "../emit/inputs/where-unique.js";
import { emitEnumFilter } from "../emit/filters/enum.js";
import { emitSharedScalarFilters } from "../emit/filters/scalar.js";
import { emitCommonSharedTypes } from "../emit/shared/common.js";
import type { ModuleResolver } from "../emit/type-ref.js";

export function emitSingle(ir: IR, cfg: GeneratorConfig): Map<string, string> {
  const moduleOf: ModuleResolver = () => "";

  const parts: string[] = [emitFileHeader(cfg)];
  if (cfg.serde) parts.push(`use serde::{Deserialize, Serialize};\n`);
  parts.push(emitCommonSharedTypes({ serde: cfg.serde, vis: cfg.moduleVisibility }));
  parts.push(emitSharedScalarFilters({ serde: cfg.serde, vis: cfg.moduleVisibility }));

  for (const e of ir.enums) {
    parts.push(emitEnum(e, { serde: cfg.serde, vis: cfg.moduleVisibility }));
    parts.push(emitEnumFilter(e.name, "", { serde: cfg.serde, vis: cfg.moduleVisibility }));
  }
  for (const m of ir.models) {
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
      emitRelationFilters(m.name, "", {
        serde: cfg.serde,
        vis: cfg.moduleVisibility,
      }),
    );
    parts.push(
      emitWhereUniqueInput(m, { serde: cfg.serde, vis: cfg.moduleVisibility }),
    );
  }

  const rootName = cfg.moduleName ? "mod.rs" : "lib.rs";
  return new Map([[rootName, parts.join("\n")]]);
}
