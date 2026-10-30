import { describe, expect, it } from "vitest";
import {
  postprocessCompletion,
  stripCodeFence,
  stripRepeatedLinePrefix,
  trimSuffixOverlap,
} from "../../src/completion/postprocess";

describe("stripCodeFence", () => {
  it("removes a complete fence", () => {
    expect(stripCodeFence("```ts\nconst a = 1;\n```")).toBe("const a = 1;");
  });
  it("removes an unterminated fence", () => {
    expect(stripCodeFence("```\nfoo()\n")).toBe("foo()\n");
  });
  it("leaves plain code alone", () => {
    expect(stripCodeFence("return x;")).toBe("return x;");
  });
});

describe("stripRepeatedLinePrefix", () => {
  it("drops the repeated current line", () => {
    expect(stripRepeatedLinePrefix("  const x = 1;", "  const x")).toBe(" = 1;");
    expect(stripRepeatedLinePrefix("const x = 1;", "  const x")).toBe(" = 1;");
  });
  it("keeps text when the line prefix is blank", () => {
    expect(stripRepeatedLinePrefix("foo()", "    ")).toBe("foo()");
  });
});

describe("trimSuffixOverlap", () => {
  it("cuts the part that repeats the line suffix", () => {
    expect(trimSuffixOverlap("a, b)", ")", "")).toBe("a, b");
    expect(trimSuffixOverlap("a, b) {", ") {", "")).toBe("a, b");
  });
  it("drops a last line identical to the next document line", () => {
    expect(trimSuffixOverlap("foo();\n}", "", "}")).toBe("foo();");
  });
});

describe("postprocessCompletion", () => {
  it("returns undefined for empty output", () => {
    expect(
      postprocessCompletion({
        raw: "```\n\n```",
        linePrefix: "",
        lineSuffix: "",
        nextLine: "",
        multiline: "auto",
      }),
    ).toBeUndefined();
  });
  it("restricts to a single line when text follows the cursor in auto mode", () => {
    expect(
      postprocessCompletion({
        raw: "x + 1;\nreturn x;",
        linePrefix: "const y = ",
        lineSuffix: "  ",
        nextLine: "",
        multiline: "auto",
      }),
    ).toBe("x + 1;\nreturn x;");
    expect(
      postprocessCompletion({
        raw: "x + 1\nreturn x;",
        linePrefix: "const y = ",
        lineSuffix: ";",
        nextLine: "",
        multiline: "auto",
      }),
    ).toBe("x + 1");
  });
  it("keeps one leading line break after code at the end of a line", () => {
    expect(
      postprocessCompletion({
        raw: "\n  return a + b;\n}",
        linePrefix: "function add(a: number, b: number): number {",
        lineSuffix: "",
        nextLine: "",
        multiline: "auto",
      }),
    ).toBe("\n  return a + b;\n}");
  });
  it("drops leading blank lines on a fresh line", () => {
    expect(
      postprocessCompletion({
        raw: "\n\n  foo();",
        linePrefix: "  ",
        lineSuffix: "",
        nextLine: "",
        multiline: "auto",
      }),
    ).toBe("  foo();");
  });
  it("honours multiline=never", () => {
    expect(
      postprocessCompletion({
        raw: "a\nb",
        linePrefix: "",
        lineSuffix: "",
        nextLine: "",
        multiline: "never",
      }),
    ).toBe("a");
  });
});
