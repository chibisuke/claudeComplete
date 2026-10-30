export interface PostprocessInput {
  raw: string;
  linePrefix: string;
  lineSuffix: string;
  /** First non-empty line after the cursor line (used for overlap trimming). */
  nextLine: string;
  multiline: "auto" | "always" | "never";
}

/** Removes a wrapping markdown code fence if the model added one. */
export function stripCodeFence(text: string): string {
  const fence = /^\s*```[\w+-]*\s*\n([\s\S]*?)\n?\s*```\s*$/;
  const m = fence.exec(text);
  if (m) {
    return m[1];
  }
  // Leading fence without closing fence (truncated output).
  const open = /^\s*```[\w+-]*\s*\n/;
  if (open.test(text)) {
    return text.replace(open, "").replace(/\n?\s*```\s*$/, "");
  }
  return text;
}

/** If the completion repeats the text already on the cursor line, drop that repetition. */
export function stripRepeatedLinePrefix(text: string, linePrefix: string): string {
  const trimmed = linePrefix.trimStart();
  if (trimmed.length === 0) {
    return text;
  }
  if (text.startsWith(linePrefix)) {
    return text.slice(linePrefix.length);
  }
  if (text.startsWith(trimmed)) {
    return text.slice(trimmed.length);
  }
  return text;
}

/** Cuts the completion where it starts repeating the suffix right after the cursor. */
export function trimSuffixOverlap(text: string, lineSuffix: string, nextLine: string): string {
  let out = text;
  const suffix = lineSuffix.trimEnd();
  if (suffix.length > 0) {
    const firstLine = out.split("\n")[0];
    for (let k = Math.min(firstLine.length, suffix.length); k > 0; k--) {
      if (firstLine.endsWith(suffix.slice(0, k))) {
        out = firstLine.slice(0, firstLine.length - k);
        break;
      }
    }
  }
  const next = nextLine.trim();
  if (next.length > 0) {
    const lines = out.split("\n");
    if (lines.length > 1 && lines[lines.length - 1].trim() === next) {
      lines.pop();
      out = lines.join("\n");
    }
  }
  return out;
}

export function postprocessCompletion(input: PostprocessInput): string | undefined {
  let text = stripCodeFence(input.raw);
  text = text.replace(/\r\n/g, "\n");
  // Drop leading blank lines only; keep leading indentation of the first real line
  // if the cursor is at a fresh line.
  text = text.replace(/^(\s*\n)+/, "");
  text = stripRepeatedLinePrefix(text, input.linePrefix);
  text = trimSuffixOverlap(text, input.lineSuffix, input.nextLine);

  const singleLine =
    input.multiline === "never" ||
    (input.multiline === "auto" && input.lineSuffix.trim().length > 0);
  if (singleLine) {
    text = text.split("\n")[0];
  }
  text = text.replace(/\s+$/, "");
  if (
    input.linePrefix.trim().length > 0 &&
    input.linePrefix.endsWith(" ") &&
    text.startsWith(" ")
  ) {
    text = text.trimStart();
  }
  return text.length > 0 ? text : undefined;
}
