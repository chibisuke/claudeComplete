import { diffLines } from "diff";

export interface MergedDiff {
  /** Text that replaces the original selection: original lines plus inserted new lines. */
  text: string;
  /** Line offsets (relative to the first selected line) of removed (old) lines. */
  removed: Array<{ start: number; end: number }>;
  /** Line offsets of added (new) lines. */
  added: Array<{ start: number; end: number }>;
  changed: boolean;
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Builds an inline-diff representation: removed lines stay in place (to be shown red),
 * added lines are inserted right after them (shown green). Accepting deletes the removed
 * ranges, rejecting deletes the added ranges.
 */
export function buildMergedDiff(oldText: string, newText: string): MergedDiff {
  const oldLines = splitLines(oldText.replace(/\r\n/g, "\n"));
  const newLines = splitLines(newText.replace(/\r\n/g, "\n"));
  const parts = diffLines(oldLines.join("\n") + "\n", newLines.join("\n") + "\n");
  const out: string[] = [];
  const removed: MergedDiff["removed"] = [];
  const added: MergedDiff["added"] = [];
  let changed = false;
  for (const part of parts) {
    const lines = splitLines(part.value);
    if (lines.length === 0) {
      continue;
    }
    const start = out.length;
    out.push(...lines);
    if (part.removed) {
      removed.push({ start, end: out.length });
      changed = true;
    } else if (part.added) {
      added.push({ start, end: out.length });
      changed = true;
    }
  }
  return { text: out.join("\n"), removed, added, changed };
}
