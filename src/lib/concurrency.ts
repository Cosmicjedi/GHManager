/**
 * Run an async mapper over a list with a bounded number of in-flight tasks.
 * Results are returned in input order regardless of completion order.
 */
export async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  limit: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) return [];

  const effectiveLimit = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const results = new Array<TOutput>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
  return results;
}

/** Split a list into fixed-size chunks. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunkSize = Math.max(1, Math.floor(size) || 1);
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}
