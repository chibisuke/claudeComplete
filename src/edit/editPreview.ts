import { diffLines, diffWordsWithSpace } from "diff";

export interface WordRange {
  start: number;
  end: number;
}

export interface InsertedWord {
  /** Column in the old line text after which the new text is shown. */
  col: number;
  text: string;
}

export interface ModifiedLine {
  /** Line offset inside the region text. */
  line: number;
  removed: WordRange[];
  inserted: InsertedWord[];
}

export interface EditPreview {
  /** Text that temporarily replaces the selection: old lines plus the purely new lines. */
  regionText: string;
  /** Line offsets (in regionText) of lines that are new. */
  addedLines: number[];
  /** Line offsets of old lines that disappear entirely. */
  removedLines: number[];
  /** Old lines that change partially, with word-level ranges. */
  modified: ModifiedLine[];
  oldText: string;
  newText: string;
  changed: boolean;
  /** First line offset that carries any change (for the gutter marker). */
  firstChangedLine: number;
}

/** Above this share of changed characters a line is shown as removed + added instead of word diff. */
const WORD_DIFF_MAX_CHANGE_RATIO = 0.6;

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export function wordDiff(
  oldLine: string,
  newLine: string,
): { removed: WordRange[]; inserted: InsertedWord[]; ratio: number } {
  const parts = diffWordsWithSpace(oldLine, newLine);
  const removed: WordRange[] = [];
  const inserted: InsertedWord[] = [];
  let col = 0;
  let changedChars = 0;
  for (const part of parts) {
    if (part.removed) {
      removed.push({ start: col, end: col + part.value.length });
      col += part.value.length;
      changedChars += part.value.length;
    } else if (part.added) {
      const last = inserted[inserted.length - 1];
      if (last && last.col === col) {
        last.text += part.value;
      } else {
        inserted.push({ col, text: part.value });
      }
      changedChars += part.value.length;
    } else {
      col += part.value.length;
    }
  }
  // Show replacements after the text they replace (old → new), like Copilot does.
  for (const ins of inserted) {
    const r = removed.find((x) => x.start === ins.col);
    if (r) {
      ins.col = r.end;
    }
  }
  const total = oldLine.length + newLine.length;
  return { removed, inserted, ratio: total === 0 ? 0 : changedChars / total };
}

/**
 * Builds the inline preview model for replacing `oldText` by `newText`. Lines that change
 * partially stay in the document and get word-level markers; purely new lines are inserted
 * (green), purely removed lines stay (red). Accepting replaces the whole region by `newText`,
 * rejecting restores `oldText`.
 */
export function buildEditPreview(oldText: string, newText: string): EditPreview {
  const oldNorm = oldText.replace(/\r\n/g, "\n");
  const newNorm = newText.replace(/\r\n/g, "\n");
  const oldLines = splitLines(oldNorm);
  const newLines = splitLines(newNorm);
  const parts = diffLines(oldLines.join("\n") + "\n", newLines.join("\n") + "\n");

  const out: string[] = [];
  const addedLines: number[] = [];
  const removedLines: number[] = [];
  const modified: ModifiedLine[] = [];

  const hunk = (removed: string[], added: string[]) => {
    const pairs = Math.min(removed.length, added.length);
    const extraAdded: string[] = [];
    for (let i = 0; i < pairs; i++) {
      const wd = wordDiff(removed[i], added[i]);
      if (wd.ratio > WORD_DIFF_MAX_CHANGE_RATIO) {
        removedLines.push(out.length);
        out.push(removed[i]);
        extraAdded.push(added[i]);
      } else {
        modified.push({ line: out.length, removed: wd.removed, inserted: wd.inserted });
        out.push(removed[i]);
      }
    }
    for (let i = pairs; i < removed.length; i++) {
      removedLines.push(out.length);
      out.push(removed[i]);
    }
    for (const line of [...extraAdded, ...added.slice(pairs)]) {
      addedLines.push(out.length);
      out.push(line);
    }
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const lines = splitLines(part.value);
    if (lines.length === 0) {
      continue;
    }
    if (part.removed) {
      const next = parts[i + 1];
      if (next && next.added) {
        hunk(lines, splitLines(next.value));
        i++;
      } else {
        hunk(lines, []);
      }
    } else if (part.added) {
      hunk([], lines);
    } else {
      out.push(...lines);
    }
  }

  const changedOffsets = [...addedLines, ...removedLines, ...modified.map((m) => m.line)];
  return {
    regionText: out.join("\n"),
    addedLines,
    removedLines,
    modified,
    oldText: oldNorm,
    newText: newNorm,
    changed: changedOffsets.length > 0,
    firstChangedLine: changedOffsets.length > 0 ? Math.min(...changedOffsets) : 0,
  };
}
