import { describe, expect, it } from "vitest";
import { buildEditPreview, wordDiff } from "../../src/edit/editPreview";
import { alignIndentation } from "../../src/edit/editCommand";
import { isNativeInlineEditAvailable } from "../../src/edit/nativeInlineEdit";

describe("wordDiff", () => {
  it("marks the replaced token and places the new token after it", () => {
    const d = wordDiff('const greeting = "hi";', 'const greeting = "hello world";');
    // diffWordsWithSpace tokenizes the quotes separately, so only the inner word changes.
    expect(d.removed).toEqual([{ start: 18, end: 20 }]);
    expect(d.inserted).toEqual([{ col: 20, text: "hello world" }]);
    expect(d.ratio).toBeLessThan(0.6);
  });
  it("reports a high ratio for a complete rewrite", () => {
    expect(wordDiff("foo();", "return bar(x, y);").ratio).toBeGreaterThan(0.6);
  });
});

describe("buildEditPreview", () => {
  it("renders a word change in place without extra lines", () => {
    const p = buildEditPreview('const greeting = "hi";', 'const greeting = "hello world";');
    expect(p.changed).toBe(true);
    expect(p.regionText).toBe('const greeting = "hi";');
    expect(p.addedLines).toEqual([]);
    expect(p.removedLines).toEqual([]);
    expect(p.modified).toHaveLength(1);
    expect(p.modified[0].removed).toEqual([{ start: 18, end: 20 }]);
    expect(p.modified[0].inserted[0].text).toBe("hello world");
    expect(p.firstChangedLine).toBe(0);
  });
  it("inserts purely new lines and keeps unchanged ones", () => {
    const p = buildEditPreview("a\nb", "a\nx\ny\nb");
    expect(p.regionText).toBe("a\nx\ny\nb");
    expect(p.addedLines).toEqual([1, 2]);
    expect(p.removedLines).toEqual([]);
    expect(p.modified).toEqual([]);
    expect(p.firstChangedLine).toBe(1);
  });
  it("marks purely removed lines", () => {
    const p = buildEditPreview("a\nb\nc", "a\nc");
    expect(p.regionText).toBe("a\nb\nc");
    expect(p.removedLines).toEqual([1]);
    expect(p.addedLines).toEqual([]);
  });
  it("pairs lines in a mixed hunk and appends the surplus as new lines", () => {
    const p = buildEditPreview("let a = 1;\nlet b = 2;", "let a = 10;\nlet b = 20;\nlet c = 30;");
    expect(p.modified.map((m) => m.line)).toEqual([0, 1]);
    expect(p.addedLines).toEqual([2]);
    expect(p.regionText.split("\n")).toEqual(["let a = 1;", "let b = 2;", "let c = 30;"]);
  });
  it("falls back to removed + added lines for a full rewrite", () => {
    const p = buildEditPreview("foo();", "return bar(x, y);");
    expect(p.modified).toEqual([]);
    expect(p.removedLines).toEqual([0]);
    expect(p.addedLines).toEqual([1]);
    expect(p.regionText).toBe("foo();\nreturn bar(x, y);");
  });
  it("reports no change for identical text", () => {
    const p = buildEditPreview("x\ny", "x\ny\n");
    expect(p.changed).toBe(false);
  });
  it("keeps old/new text for accept and reject", () => {
    const p = buildEditPreview("one\r\ntwo", "one\nzwei");
    expect(p.oldText).toBe("one\ntwo");
    expect(p.newText).toBe("one\nzwei");
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

describe("isNativeInlineEditAvailable", () => {
  it("is true only when the proposal survived VS Code's filtering", () => {
    expect(
      isNativeInlineEditAvailable(() => ({
        packageJSON: { enabledApiProposals: ["inlineCompletionsAdditions"] },
      })),
    ).toBe(true);
    expect(isNativeInlineEditAvailable(() => ({ packageJSON: { enabledApiProposals: [] } }))).toBe(
      false,
    );
    expect(isNativeInlineEditAvailable(() => undefined)).toBe(false);
  });
});
