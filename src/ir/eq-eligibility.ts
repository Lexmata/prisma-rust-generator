// src/ir/eq-eligibility.ts
import type { EnumIR, ModelIR } from "./types.js";

export function computeEqEligibility(
  models: readonly ModelIR[],
  _enums: readonly EnumIR[],
): Map<string, boolean> {
  const eligible = new Map<string, boolean>();
  for (const m of models) eligible.set(m.name, allScalarsEq(m));

  // Fix-point: propagate `false` along relation edges until no change.
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of models) {
      if (!eligible.get(m.name)) continue;
      for (const r of m.relations) {
        if (eligible.get(r.toModel) === false) {
          eligible.set(m.name, false);
          changed = true;
          break;
        }
      }
    }
  }
  return eligible;
}

function allScalarsEq(m: ModelIR): boolean {
  for (const f of m.scalarFields) {
    if (f.type.kind === "scalar" && !f.type.eq) return false;
  }
  return true;
}
