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
import { emitCreateInputs } from "../emit/inputs/create.js";
import { emitUpdateInputs } from "../emit/inputs/update.js";
import { emitNestedInputsForModel } from "../emit/inputs/nested.js";
import { emitAggregateInputs } from "../emit/inputs/aggregate.js";
import { emitEnumFilter } from "../emit/filters/enum.js";
import { emitSharedScalarFilters } from "../emit/filters/scalar.js";
import { emitCommonSharedTypes } from "../emit/shared/common.js";
import { emitFieldUpdateOps } from "../emit/inputs/field-update-ops.js";
import type { ModuleResolver } from "../emit/type-ref.js";

export function emitSingle(ir: IR, cfg: GeneratorConfig): Map<string, string> {
  const moduleOf: ModuleResolver = () => "";
  const allModels = new Map(ir.models.map((m) => [m.name, m]));

  const parts: string[] = [emitFileHeader(cfg)];
  if (cfg.serde) parts.push(`use serde::{Deserialize, Serialize};\n`);
  parts.push(emitCommonSharedTypes({ serde: cfg.serde, vis: cfg.moduleVisibility }));
  parts.push(emitSharedScalarFilters({ serde: cfg.serde, vis: cfg.moduleVisibility, cfg }));
  parts.push(emitFieldUpdateOps({ serde: cfg.serde, vis: cfg.moduleVisibility, cfg }));

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
      emitAggregateInputs(m, { serde: cfg.serde, vis: cfg.moduleVisibility }),
    );
  }

  const rootName = cfg.moduleName ? "mod.rs" : "lib.rs";
  return new Map([[rootName, parts.join("\n")]]);
}
