import type { EnumIR, ModelIR } from "./types.js";

// A model is Eq-eligible iff (a) all its scalars are Eq-deriveable, and
// (b) every model reachable via its relation graph is also Eq-eligible.
// We compute the initial scalar-based answer per model, then propagate
// ineligibility backwards along the relation graph in a single BFS pass.
export function computeEqEligibility(
  models: readonly ModelIR[],
  _enums: readonly EnumIR[],
): Map<string, boolean> {
  const eligible = new Map<string, boolean>();
  for (const m of models) eligible.set(m.name, allScalarsEq(m));

  // Reverse adjacency: each target maps to the source models that reference
  // it. When a target turns ineligible, every source must be re-evaluated.
  const referrers = new Map<string, string[]>();
  for (const m of models) {
    for (const r of m.relations) {
      const list = referrers.get(r.toModel);
      if (list) list.push(m.name);
      else referrers.set(r.toModel, [m.name]);
    }
  }

  // Queue every model that's already ineligible from its own scalars, then
  // BFS outward. Index-based dequeue keeps the loop O(V+E) — shift() on an
  // array is O(n).
  const queue: string[] = [];
  for (const [name, e] of eligible) if (!e) queue.push(name);
  for (let head = 0; head < queue.length; head++) {
    const target = queue[head]!;
    for (const src of referrers.get(target) ?? []) {
      if (eligible.get(src) === false) continue;
      eligible.set(src, false);
      queue.push(src);
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
