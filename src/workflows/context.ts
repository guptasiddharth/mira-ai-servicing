import type { CustomerContext } from "@/platform/workflows/types";
import type { Source } from "@/platform/tools/types";

/**
 * Helper for workflow context loaders: fetch several systems in parallel and
 * degrade gracefully — a slow or failing system never blocks the conversation.
 */
export async function loadInParallel<T extends Record<string, () => Promise<unknown>>>(
  loaders: T,
): Promise<{ values: { [K in keyof T]?: Awaited<ReturnType<T[K]>> }; degraded: string[] }> {
  const keys = Object.keys(loaders) as (keyof T)[];
  const settled = await Promise.allSettled(keys.map((k) => loaders[k]()));
  const values: { [K in keyof T]?: Awaited<ReturnType<T[K]>> } = {};
  const degraded: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") values[keys[i]] = r.value as Awaited<ReturnType<T[keyof T]>>;
    else degraded.push(String(keys[i]));
  });
  return { values, degraded };
}

export function makeContext(snapshot: Record<string, unknown>, sources: Source[], degraded: string[]): CustomerContext {
  return { snapshot, sources, degraded, loadedAt: new Date().toISOString() };
}
