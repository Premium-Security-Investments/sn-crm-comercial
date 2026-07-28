// Bounds concurrent async work into fixed-size chunks: never more than
// `limit` in-flight calls at once, and every item is awaited to completion
// (success or throw) before the function returns — no unlimited Promise.all,
// no advancing past items still in flight.
export async function runInConcurrentChunks(items, limit, worker) {
  if (limit < 1) throw new Error('runInConcurrentChunks requires limit >= 1');
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkResults = await Promise.all(chunk.map(worker));
    results.push(...chunkResults);
  }
  return results;
}
