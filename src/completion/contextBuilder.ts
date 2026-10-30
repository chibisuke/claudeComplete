import type * as vscode from "vscode";

export interface CursorWindow {
  prefix: string;
  suffix: string;
  /** Text of the current line before the cursor. */
  linePrefix: string;
  /** Text of the current line after the cursor. */
  lineSuffix: string;
  language: string;
  filename: string;
}

export function buildCursorWindow(
  doc: vscode.TextDocument,
  position: vscode.Position,
  linesBefore: number,
  linesAfter: number,
  filename: string,
): CursorWindow {
  const startLine = Math.max(0, position.line - linesBefore);
  const endLine = Math.min(doc.lineCount - 1, position.line + linesAfter);
  const lines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    lines.push(doc.lineAt(i).text);
  }
  const rel = position.line - startLine;
  const current = lines[rel] ?? "";
  const linePrefix = current.slice(0, position.character);
  const lineSuffix = current.slice(position.character);
  const prefix = [...lines.slice(0, rel), linePrefix].join("\n");
  const suffix = [lineSuffix, ...lines.slice(rel + 1)].join("\n");
  return { prefix, suffix, linePrefix, lineSuffix, language: doc.languageId, filename };
}
