import { describe, expect, it } from "vitest";
import { deltaText, SSEParser } from "../../src/llm/sse";
import { joinSystem } from "../../src/llm/openaiCompat";

describe("SSEParser", () => {
  it("parses events split across chunks", () => {
    const p = new SSEParser();
    expect(p.push('data: {"a":1}\n\nda')).toEqual(['{"a":1}']);
    expect(p.push('ta: {"b":2}\r\n\r\ndata: [DONE]\n\n')).toEqual(['{"b":2}', "[DONE]"]);
    expect(p.end()).toEqual([]);
  });
  it("ignores comments and event lines, flushes trailing data", () => {
    const p = new SSEParser();
    expect(p.push(": keep-alive\nevent: x\ndata: 1\n\ndata: 2")).toEqual(["1"]);
    expect(p.end()).toEqual(["2"]);
  });
});

describe("deltaText", () => {
  it("extracts delta content", () => {
    expect(deltaText({ choices: [{ delta: { content: "hi" } }] })).toBe("hi");
    expect(deltaText({ choices: [{ delta: { content: null } }] })).toBeUndefined();
    expect(deltaText({})).toBeUndefined();
  });
});

describe("joinSystem", () => {
  it("concatenates non-empty blocks", () => {
    expect(
      joinSystem({
        model: "m",
        system: [{ text: "a" }, { text: "" }, { text: "b" }],
        user: "u",
        maxTokens: 1,
      }),
    ).toBe("a\n\nb");
  });
});
