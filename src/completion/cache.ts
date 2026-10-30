import { createHash } from "node:crypto";

export function hashKey(...parts: string[]): string {
  const h = createHash("sha1");
  for (const p of parts) {
    h.update(p);
    h.update("\u0000");
  }
  return h.digest("hex");
}

/** Small LRU cache for completion results keyed by cursor context. */
export class LRUCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly capacity: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
