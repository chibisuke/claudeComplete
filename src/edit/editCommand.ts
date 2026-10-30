import * as vscode from "vscode";
import { renderTemplate } from "../prompts/template";
import type { CompletionService } from "../service";
import { collectStream } from "../llm/types";
import { stripCodeFence } from "../completion/postprocess";
import { buildMergedDiff } from "./diffPreview";

const CONTEXT_KEY = "claudeComplete.editPending";

interface PendingEdit {
  editor: vscode.TextEditor;
  documentVersion: number;
  startLine: number;
  removed: vscode.Range[];
  added: vscode.Range[];
}

/** Expands a selection to whole lines; falls back to the current line when empty. */
export function lineRangeOf(doc: vscode.TextDocument, selection: vscode.Selection): vscode.Range {
  const start = selection.start.line;
  let end = selection.end.line;
  if (!selection.isEmpty && selection.end.character === 0 && end > start) {
    end--;
  }
  return new vscode.Range(start, 0, end, doc.lineAt(end).text.length);
}

/** Re-indents the replacement so its first line matches the indentation of the original. */
export function alignIndentation(original: string, replacement: string): string {
  const origIndent = /^[ \t]*/.exec(original)?.[0] ?? "";
  const replLines = replacement.split("\n");
  const firstNonEmpty = replLines.find((l) => l.trim().length > 0);
  if (!firstNonEmpty) {
    return replacement;
  }
  const replIndent = /^[ \t]*/.exec(firstNonEmpty)?.[0] ?? "";
  if (replIndent === origIndent) {
    return replacement;
  }
  return replLines
    .map((l) => {
      if (l.trim().length === 0) {
        return l;
      }
      return l.startsWith(replIndent) ? origIndent + l.slice(replIndent.length) : l;
    })
    .join("\n");
}

export class EditController implements vscode.Disposable, vscode.CodeLensProvider {
  private pending: PendingEdit | undefined;
  private readonly removedDecoration: vscode.TextEditorDecorationType;
  private readonly addedDecoration: vscode.TextEditorDecorationType;
  private readonly lensEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly service: CompletionService) {
    this.removedDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("diffEditor.removedLineBackground"),
      textDecoration: "line-through",
      opacity: "0.7",
    });
    this.addedDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"),
    });
    this.disposables.push(
      vscode.languages.registerCodeLensProvider({ scheme: "*" }, this),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const p = this.pending;
        if (p && e.document === p.editor.document && e.document.version !== p.documentVersion) {
          this.abandon(
            "Edit suggestion abandoned because the document changed. Use Undo to restore.",
          );
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.lensEmitter.fire()),
    );
    void vscode.commands.executeCommand("setContext", CONTEXT_KEY, false);
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const p = this.pending;
    if (!p || p.editor.document !== document) {
      return [];
    }
    const range = new vscode.Range(p.startLine, 0, p.startLine, 0);
    return [
      new vscode.CodeLens(range, {
        title: "$(check) Accept (Tab)",
        command: "claudeComplete.acceptEdit",
      }),
      new vscode.CodeLens(range, {
        title: "$(close) Reject (Esc)",
        command: "claudeComplete.rejectEdit",
      }),
    ];
  }

  async editSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    if (this.pending) {
      void vscode.window.showInformationMessage(
        "Accept or reject the pending edit suggestion first.",
      );
      return;
    }
    const instruction = await vscode.window.showInputBox({
      title: "ClaudeComplete: Edit instruction",
      prompt: "Describe how the selected code should be changed",
      placeHolder: "e.g. add error handling, convert to async/await, extract a helper",
      ignoreFocusOut: true,
    });
    if (!instruction || instruction.trim().length === 0) {
      return;
    }

    const doc = editor.document;
    const cfg = this.service.config;
    const range = lineRangeOf(doc, editor.selection);
    const selection = doc.getText(range);
    const beforeStart = Math.max(0, range.start.line - 40);
    const afterEnd = Math.min(doc.lineCount - 1, range.end.line + 40);
    const before =
      range.start.line > 0
        ? doc.getText(
            new vscode.Range(
              beforeStart,
              0,
              range.start.line - 1,
              doc.lineAt(range.start.line - 1).text.length,
            ),
          )
        : "";
    const after =
      range.end.line < doc.lineCount - 1
        ? doc.getText(
            new vscode.Range(range.end.line + 1, 0, afterEnd, doc.lineAt(afterEnd).text.length),
          )
        : "";

    let provider;
    try {
      provider = this.service.getProvider();
    } catch (err) {
      this.service.reportError(err, "edit");
      void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      return;
    }
    const system = this.service.buildSystem(cfg.edit.systemPrompt, doc, range.start.line);
    const user = renderTemplate(cfg.edit.promptTemplate, {
      selection,
      instruction: instruction.trim(),
      language: doc.languageId,
      filename: vscode.workspace.asRelativePath(doc.uri, false),
      before,
      after,
    });
    if (cfg.logPrompts) {
      this.service.log.prompt("edit", system.map((b) => b.text).join("\n\n"), user);
    }

    const versionBefore = doc.version;
    const started = Date.now();
    const raw = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "ClaudeComplete: generating edit...",
        cancellable: true,
      },
      async (_progress, token) => {
        try {
          const result = provider.stream(
            {
              model: cfg.edit.model,
              system,
              user,
              maxTokens: cfg.edit.maxTokens,
              stop: ["</selection>"],
              effort: cfg.edit.effort,
            },
            token,
          );
          const text = await collectStream(result);
          const usage = await result.usage;
          this.service.stats.add(usage);
          this.service.touch();
          this.service.log.usage("edit", usage, Date.now() - started);
          return token.isCancellationRequested ? undefined : text;
        } catch (err) {
          if (!token.isCancellationRequested) {
            this.service.reportError(err, "edit");
            void vscode.window.showErrorMessage(
              `ClaudeComplete: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          return undefined;
        }
      },
    );
    if (raw === undefined) {
      return;
    }
    if (doc.version !== versionBefore || vscode.window.activeTextEditor !== editor) {
      void vscode.window.showWarningMessage(
        "ClaudeComplete: document changed while generating; edit discarded.",
      );
      return;
    }
    const replacement = alignIndentation(selection, stripCodeFence(raw).replace(/\s+$/, ""));
    const merged = buildMergedDiff(selection, replacement);
    if (!merged.changed) {
      void vscode.window.showInformationMessage("ClaudeComplete: the model suggested no change.");
      return;
    }
    await this.showPreview(editor, range, merged);
  }

  private async showPreview(
    editor: vscode.TextEditor,
    range: vscode.Range,
    merged: ReturnType<typeof buildMergedDiff>,
  ): Promise<void> {
    const ok = await editor.edit((b) => b.replace(range, merged.text), {
      undoStopBefore: true,
      undoStopAfter: false,
    });
    if (!ok) {
      return;
    }
    const base = range.start.line;
    const toRange = (r: { start: number; end: number }) =>
      new vscode.Range(
        base + r.start,
        0,
        base + r.end - 1,
        editor.document.lineAt(base + r.end - 1).text.length,
      );
    this.pending = {
      editor,
      documentVersion: editor.document.version,
      startLine: base,
      removed: merged.removed.map(toRange),
      added: merged.added.map(toRange),
    };
    editor.setDecorations(this.removedDecoration, this.pending.removed);
    editor.setDecorations(this.addedDecoration, this.pending.added);
    await vscode.commands.executeCommand("setContext", CONTEXT_KEY, true);
    this.lensEmitter.fire();
  }

  async accept(): Promise<void> {
    await this.resolve("accept");
  }

  async reject(): Promise<void> {
    await this.resolve("reject");
  }

  private async resolve(mode: "accept" | "reject"): Promise<void> {
    const p = this.pending;
    if (!p) {
      return;
    }
    this.pending = undefined;
    const doc = p.editor.document;
    const toDelete = (mode === "accept" ? p.removed : p.added)
      .slice()
      .sort((a, b) => b.start.line - a.start.line);
    p.editor.setDecorations(this.removedDecoration, []);
    p.editor.setDecorations(this.addedDecoration, []);
    if (doc.version === p.documentVersion) {
      await p.editor.edit(
        (b) => {
          for (const r of toDelete) {
            const deleteRange =
              r.end.line + 1 < doc.lineCount
                ? new vscode.Range(r.start.line, 0, r.end.line + 1, 0)
                : r.start.line > 0
                  ? new vscode.Range(
                      r.start.line - 1,
                      doc.lineAt(r.start.line - 1).text.length,
                      r.end.line,
                      r.end.character,
                    )
                  : new vscode.Range(r.start.line, 0, r.end.line, r.end.character);
            b.delete(deleteRange);
          }
        },
        { undoStopBefore: false, undoStopAfter: true },
      );
      if (mode === "accept") {
        this.service.stats.completionsAccepted++;
      }
    }
    await vscode.commands.executeCommand("setContext", CONTEXT_KEY, false);
    this.lensEmitter.fire();
  }

  private abandon(message: string): void {
    const p = this.pending;
    if (!p) {
      return;
    }
    this.pending = undefined;
    p.editor.setDecorations(this.removedDecoration, []);
    p.editor.setDecorations(this.addedDecoration, []);
    void vscode.commands.executeCommand("setContext", CONTEXT_KEY, false);
    this.lensEmitter.fire();
    void vscode.window.showWarningMessage(`ClaudeComplete: ${message}`);
  }

  dispose(): void {
    this.pending = undefined;
    this.removedDecoration.dispose();
    this.addedDecoration.dispose();
    this.lensEmitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
