import { describe, expect, it } from "vitest";
import { buildSystemBlocks } from "../../src/llm/cacheLayout";
import { buildSystemParam } from "../../src/llm/anthropic";
import { buildFileSnapshot } from "../../src/completion/contextSnapshot";

describe("buildSystemBlocks", () => {
  it("produces a byte-identical prefix for an unchanged snapshot", () => {
    const opts = { enabled: true, systemPromptTtl: "1h" as const };
    const a = buildSystemBlocks("SYS", "snap", opts);
    const b = buildSystemBlocks("SYS", "snap", opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a[0].cache?.ttl).toBe("1h");
    expect(a[1].cache?.ttl).toBe("5m");
  });
  it("omits the snapshot block when there is no snapshot", () => {
    expect(
      buildSystemBlocks("SYS", undefined, { enabled: true, systemPromptTtl: "5m" }),
    ).toHaveLength(1);
  });
  it("sends no cache markers when caching is disabled", () => {
    const blocks = buildSystemBlocks("SYS", "snap", { enabled: false, systemPromptTtl: "5m" });
    expect(blocks.every((b) => b.cache === undefined)).toBe(true);
  });
});

describe("buildSystemParam", () => {
  it("maps cache markers to cache_control with TTL", () => {
    const param = buildSystemParam(
      {
        model: "m",
        system: [
          { text: "A", cache: { ttl: "1h" } },
          { text: "B", cache: { ttl: "5m" } },
          { text: "C" },
        ],
        user: "u",
        maxTokens: 1,
      },
      true,
    );
    expect(param).toEqual([
      { type: "text", text: "A", cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: "B", cache_control: { type: "ephemeral" } },
      { type: "text", text: "C" },
    ]);
  });
  it("respects the 4-breakpoint limit and the disabled flag", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      text: `b${i}`,
      cache: { ttl: "5m" as const },
    }));
    const on = buildSystemParam(
      { model: "m", system: many, user: "u", maxTokens: 1 },
      true,
    ) as Array<{
      cache_control?: unknown;
    }>;
    expect(on.filter((b) => b.cache_control).length).toBe(4);
    const off = buildSystemParam(
      { model: "m", system: many, user: "u", maxTokens: 1 },
      false,
    ) as Array<{
      cache_control?: unknown;
    }>;
    expect(off.filter((b) => b.cache_control).length).toBe(0);
  });
});

describe("buildFileSnapshot", () => {
  const lines = Array.from({ length: 400 }, (_, i) => `line ${i} ${"x".repeat(40)}`);
  it("returns the whole file when it fits", () => {
    const s = buildFileSnapshot(lines.slice(0, 10), 3, 100_000);
    expect(s.text).toBe(lines.slice(0, 10).join("\n"));
    expect(s.coveredStart).toBe(0);
    // A full-file snapshot stays valid when lines are appended below the old end.
    expect(s.coveredEnd).toBe(Number.POSITIVE_INFINITY);
  });
  it("keeps the head and a window around the cursor when trimming", () => {
    const s = buildFileSnapshot(lines, 300, 5000);
    expect(s.text.length).toBeLessThanOrEqual(5000 + 100);
    expect(s.text.startsWith("line 0 ")).toBe(true);
    expect(s.text).toContain("line 300 ");
    expect(s.text).toContain("lines omitted");
    expect(s.coveredStart).toBeLessThanOrEqual(300);
    expect(s.coveredEnd).toBeGreaterThan(300);
  });
  it("is deterministic", () => {
    expect(buildFileSnapshot(lines, 120, 3000)).toEqual(buildFileSnapshot(lines, 120, 3000));
  });
});
