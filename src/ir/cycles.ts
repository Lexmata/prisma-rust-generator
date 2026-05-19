export function findInputCycles(
  edges: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const inCycle = new Set<string>();

  const strongconnect = (v: string): void => {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of edges.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      // SCC with >1 nodes is a cycle; a singleton is in-cycle only if it self-loops.
      if (scc.length > 1 || (edges.get(v)?.has(v) ?? false)) {
        for (const n of scc) inCycle.add(n);
      }
    }
  };

  for (const v of edges.keys()) {
    if (!indices.has(v)) strongconnect(v);
  }
  return inCycle;
}
