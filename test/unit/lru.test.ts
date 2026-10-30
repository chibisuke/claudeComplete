import { describe, expect, it } from "vitest";
import { hashKey, LRUCache } from "../../src/completion/cache";

describe("LRUCache", () => {
  it("evicts least recently used entries", () => {
    const c = new LRUCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.size).toBe(2);
  });
});

describe("hashKey", () => {
  it("separates parts so that boundaries matter", () => {
    expect(hashKey("ab", "c")).not.toBe(hashKey("a", "bc"));
    expect(hashKey("x", "y")).toBe(hashKey("x", "y"));
  });
});
