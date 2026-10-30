import { describe, expect, it } from "vitest";
import { buildMergedDiff } from "../../src/edit/diffPreview";
import { alignIndentation } from "../../src/edit/editCommand";

describe("buildMergedDiff", () => {
  it("interleaves removed and added lines", () => {
    const m = buildMergedDiff("a\nb\nc", "a\nB\nc");
    expect(m.text).toBe("a\nb\nB\nc");
    expect(m.removed).toEqual([{ start: 1, end: 2 }]);
    expect(m.added).toEqual([{ start: 2, end: 3 }]);
    expect(m.changed).toBe(true);
  });
  it("reports no change for identical text", () => {
    const m = buildMergedDiff("x\ny", "x\ny\n");
    expect(m.changed).toBe(false);
    expect(m.text).toBe("x\ny");
  });
  it("accept/reject deletions reconstruct the respective sides", () => {
    const oldText = "one\ntwo\nthree";
    const newText = "one\n2\nthree\nfour";
    const m = buildMergedDiff(oldText, newText);
    const lines = m.text.split("\n");
    const drop = (ranges: Array<{ start: number; end: number }>) =>
      lines.filter((_, i) => !ranges.some((r) => i >= r.start && i < r.end)).join("\n");
    expect(drop(m.removed)).toBe(newText);
    expect(drop(m.added)).toBe(oldText);
  });
});

describe("alignIndentation", () => {
  it("re-indents the replacement to match the original", () => {
    expect(alignIndentation("    foo();", "foo();\nbar();")).toBe("    foo();\n    bar();");
  });
  it("keeps relative indentation", () => {
    expect(alignIndentation("  a", "    if (x) {\n      b\n    }")).toBe("  if (x) {\n    b\n  }");
  });
});
