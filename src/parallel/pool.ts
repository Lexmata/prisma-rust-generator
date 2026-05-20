export async function mapInPool<I, O>(
  items: readonly I[],
  concurrency: number,
  fn: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  if (concurrency <= 1 || items.length < 4) {
    const out: O[] = [];
    for (const [i, item] of items.entries()) {
      if (item === undefined) continue;
      out.push(await fn(item, i));
    }
    return out;
  }
  const results: O[] = Array.from({ length: items.length });
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        const item = items[i];
        if (item === undefined) continue;
        results[i] = await fn(item, i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
