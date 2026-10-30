import { describe, expect, it } from "vitest";
import { Position } from "vscode";
import { buildCursorWindow } from "../../src/completion/contextBuilder";
import { fakeDocument } from "./helpers";

describe("buildCursorWindow", () => {
  const doc = fakeDocument(["l0", "l1", "l2 ab|cd", "l3", "l4", "l5"].join("\n").replace("|", ""));
  it("splits the current line at the cursor and limits context lines", () => {
    const w = buildCursorWindow(doc, new Position(2, 5), 1, 2, "src/a.ts");
    expect(w.prefix).toBe("l1\nl2 ab");
    expect(w.suffix).toBe("cd\nl3\nl4");
    expect(w.linePrefix).toBe("l2 ab");
    expect(w.lineSuffix).toBe("cd");
    expect(w.language).toBe("typescript");
  });
  it("clamps at document boundaries", () => {
    const w = buildCursorWindow(doc, new Position(0, 0), 10, 10, "a");
    expect(w.prefix).toBe("");
    expect(w.suffix.split("\n")).toHaveLength(6);
  });
});
