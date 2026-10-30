import { describe, expect, it } from "vitest";
import { renderTemplate } from "../../src/prompts/template";
import { DEFAULT_COMPLETION_TEMPLATE, DEFAULT_EDIT_TEMPLATE } from "../../src/prompts/defaults";

describe("renderTemplate", () => {
  it("replaces known placeholders and keeps unknown ones", () => {
    expect(renderTemplate("{a}-{b}-{c}", { a: "1", b: "2" })).toBe("1-2-{c}");
  });
  it("does not expand placeholders contained in values", () => {
    expect(renderTemplate("{prefix}", { prefix: "{suffix}", suffix: "X" })).toBe("{suffix}");
  });
  it("default templates reference all documented placeholders", () => {
    for (const p of ["prefix", "suffix", "language", "filename"]) {
      expect(DEFAULT_COMPLETION_TEMPLATE).toContain(`{${p}}`);
    }
    for (const p of ["selection", "instruction", "language", "filename", "before", "after"]) {
      expect(DEFAULT_EDIT_TEMPLATE).toContain(`{${p}}`);
    }
  });
});
