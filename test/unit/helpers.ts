import type * as vscode from "vscode";

/** Builds a TextDocument-like object from text for context tests. */
export function fakeDocument(
  text: string,
  languageId = "typescript",
  path = "src/a.ts",
): vscode.TextDocument {
  const lines = text.split("\n");
  return {
    uri: { toString: () => `file:///${path}`, path, scheme: "file" } as unknown as vscode.Uri,
    languageId,
    lineCount: lines.length,
    version: 1,
    getText: (range?: vscode.Range) => {
      if (!range) {
        return text;
      }
      const sel = lines.slice(range.start.line, range.end.line + 1);
      sel[sel.length - 1] = sel[sel.length - 1].slice(0, range.end.character);
      sel[0] = sel[0].slice(range.start.character);
      return sel.join("\n");
    },
    lineAt: (i: number) => ({ text: lines[i] }),
  } as unknown as vscode.TextDocument;
}
