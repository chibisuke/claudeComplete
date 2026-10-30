import * as vscode from "vscode";

export interface SnapshotOptions {
  maxChars: number;
  refreshLines: number;
  maxAgeSec: number;
  includeOpenTabs: boolean;
}

export interface Snapshot {
  /** Byte-stable text that goes into the cached prefix. */
  text: string;
  createdAt: number;
  lineCount: number;
  /** Line range of the current file covered by the snapshot (inclusive start, exclusive end). */
  coveredStart: number;
  coveredEnd: number;
  uri: string;
}

/** Pure function: builds the snapshot text for a file (trimmed around `cursorLine` if too large). */
export function buildFileSnapshot(
  lines: string[],
  cursorLine: number,
  maxChars: number,
): { text: string; coveredStart: number; coveredEnd: number } {
  const full = lines.join("\n");
  if (full.length <= maxChars) {
    return { text: full, coveredStart: 0, coveredEnd: lines.length };
  }
  // Keep the file head (imports, declarations) and a window around the cursor.
  const headBudget = Math.floor(maxChars * 0.2);
  const head: string[] = [];
  let used = 0;
  let headEnd = 0;
  while (headEnd < lines.length && used + lines[headEnd].length + 1 <= headBudget) {
    head.push(lines[headEnd]);
    used += lines[headEnd].length + 1;
    headEnd++;
  }
  const windowBudget = maxChars - used;
  let start = Math.max(headEnd, cursorLine);
  let end = Math.min(lines.length, cursorLine + 1);
  let windowUsed = start < end ? lines[start].length + 1 : 0;
  // Expand alternately upwards and downwards.
  for (;;) {
    let grew = false;
    if (start > headEnd && windowUsed + lines[start - 1].length + 1 <= windowBudget) {
      start--;
      windowUsed += lines[start].length + 1;
      grew = true;
    }
    if (end < lines.length && windowUsed + lines[end].length + 1 <= windowBudget) {
      windowUsed += lines[end].length + 1;
      end++;
      grew = true;
    }
    if (!grew) {
      break;
    }
  }
  const parts = [...head];
  if (start > headEnd) {
    parts.push(`... (${start - headEnd} lines omitted) ...`);
  }
  parts.push(...lines.slice(start, end));
  if (end < lines.length) {
    parts.push(`... (${lines.length - end} lines omitted) ...`);
  }
  return { text: parts.join("\n"), coveredStart: start, coveredEnd: end };
}

function relativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false);
}

/** Other visible text documents, deterministic order, capped. */
export function collectOpenTabSnippets(
  current: vscode.TextDocument,
  budgetChars: number,
  perFileChars = 4000,
): string {
  if (budgetChars <= 0) {
    return "";
  }
  const seen = new Set<string>();
  const docs: vscode.TextDocument[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (!(input instanceof vscode.TabInputText)) {
        continue;
      }
      const key = input.uri.toString();
      if (key === current.uri.toString() || seen.has(key)) {
        continue;
      }
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
      if (!doc || doc.uri.scheme !== "file" || doc.languageId !== current.languageId) {
        continue;
      }
      seen.add(key);
      docs.push(doc);
    }
  }
  docs.sort((a, b) => a.uri.toString().localeCompare(b.uri.toString()));
  const parts: string[] = [];
  let used = 0;
  for (const doc of docs) {
    const text = doc.getText();
    const snippet =
      text.length > perFileChars ? text.slice(0, perFileChars) + "\n... (truncated) ..." : text;
    const block = `<file path="${relativePath(doc.uri)}">\n${snippet}\n</file>`;
    if (used + block.length > budgetChars) {
      break;
    }
    parts.push(block);
    used += block.length;
  }
  return parts.join("\n");
}

/**
 * Keeps one frozen snapshot per document so the cached prompt prefix stays byte-identical
 * across keystrokes. The snapshot is only rebuilt when it is stale (see `isStale`).
 */
export class SnapshotManager {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly emitter = new vscode.EventEmitter<Snapshot>();
  /** Fires whenever a new snapshot was created (used for cache pre-warming). */
  readonly onDidCreate = this.emitter.event;

  constructor(private getOptions: () => SnapshotOptions) {}

  isStale(snap: Snapshot | undefined, doc: vscode.TextDocument, cursorLine: number): boolean {
    if (!snap) {
      return true;
    }
    const opts = this.getOptions();
    if (Date.now() - snap.createdAt > opts.maxAgeSec * 1000) {
      return true;
    }
    if (Math.abs(doc.lineCount - snap.lineCount) >= opts.refreshLines) {
      return true;
    }
    if (cursorLine < snap.coveredStart || cursorLine >= snap.coveredEnd) {
      return true;
    }
    return false;
  }

  get(doc: vscode.TextDocument, cursorLine: number): Snapshot {
    const key = doc.uri.toString();
    const existing = this.snapshots.get(key);
    if (!this.isStale(existing, doc, cursorLine)) {
      return existing as Snapshot;
    }
    return this.refresh(doc, cursorLine);
  }

  refresh(doc: vscode.TextDocument, cursorLine: number): Snapshot {
    const opts = this.getOptions();
    const lines = doc.getText().split(/\r?\n/);
    const fileBudget = opts.includeOpenTabs ? Math.floor(opts.maxChars * 0.7) : opts.maxChars;
    const file = buildFileSnapshot(lines, cursorLine, fileBudget);
    const parts = [`<file path="${relativePath(doc.uri)}" current="true">\n${file.text}\n</file>`];
    if (opts.includeOpenTabs) {
      const others = collectOpenTabSnippets(doc, opts.maxChars - parts[0].length);
      if (others) {
        parts.push(others);
      }
    }
    const snap: Snapshot = {
      text: parts.join("\n"),
      createdAt: Date.now(),
      lineCount: doc.lineCount,
      coveredStart: file.coveredStart,
      coveredEnd: file.coveredEnd,
      uri: doc.uri.toString(),
    };
    this.snapshots.set(doc.uri.toString(), snap);
    this.emitter.fire(snap);
    return snap;
  }

  invalidate(uri: vscode.Uri): void {
    this.snapshots.delete(uri.toString());
  }

  peek(uri: vscode.Uri): Snapshot | undefined {
    return this.snapshots.get(uri.toString());
  }

  clear(): void {
    this.snapshots.clear();
  }

  dispose(): void {
    this.emitter.dispose();
    this.snapshots.clear();
  }
}
