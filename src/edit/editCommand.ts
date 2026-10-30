import * as vscode from "vscode";
import { renderTemplate } from "../prompts/template";
import type { CompletionService } from "../service";
import { collectStream } from "../llm/types";
import { stripCodeFence } from "../completion/postprocess";
import { buildEditPreview, type EditPreview } from "./editPreview";
import { isNativeInlineEditAvailable, NativeEditStore } from "./nativeInlineEdit";

const CONTEXT_PENDING = "claudeComplete.editPending";
const CONTEXT_NATIVE = "claudeComplete.nativeEdit";

interface PendingDecoratedEdit {
  editor: vscode.TextEditor;
  documentVersion: number;
  startLine: number;
  regionLineCount: number;
  oldText: string;
  newText: string;
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

/** Builds the hover shown on the gutter marker: clickable Accept/Reject plus the proposed code. */
export function buildGutterHover(newText: string, languageId: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = { enabledCommands: ["claudeComplete.acceptEdit", "claudeComplete.rejectEdit"] };
  md.appendMarkdown(
    "**ClaudeComplete edit suggestion** &nbsp; " +
      '[$(check) Accept](command:claudeComplete.acceptEdit "Accept (Tab)") &nbsp;·&nbsp; ' +
      '[$(close) Reject](command:claudeComplete.rejectEdit "Reject (Esc)")\n\n',
  );
  md.appendCodeblock(newText, languageId);
  return md;
}

export class EditController implements vscode.Disposable, vscode.CodeLensProvider {
  private pending: PendingDecoratedEdit | undefined;
  private readonly addedLine: vscode.TextEditorDecorationType;
  private readonly removedLine: vscode.TextEditorDecorationType;
  private readonly removedWord: vscode.TextEditorDecorationType;
  private readonly insertedWord: vscode.TextEditorDecorationType;
  private readonly gutter: vscode.TextEditorDecorationType;
  private readonly lensEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly service: CompletionService,
    readonly nativeStore: NativeEditStore,
    extensionUri: vscode.Uri,
  ) {
    this.addedLine = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"),
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.addedForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    this.removedLine = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("diffEditor.removedLineBackground"),
      textDecoration: "line-through",
      opacity: "0.75",
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.deletedForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    this.removedWord = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("diffEditor.removedTextBackground"),
      borderRadius: "3px",
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.modifiedForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    this.insertedWord = vscode.window.createTextEditorDecorationType({
      // contentText is supplied per decoration via renderOptions.
      before: {
        backgroundColor: new vscode.ThemeColor("diffEditor.insertedTextBackground"),
        border: "1px solid",
        borderColor: new vscode.ThemeColor("diffEditor.insertedTextBorder"),
        margin: "0 0 0 0.4em",
        color: new vscode.ThemeColor("editor.foreground"),
      },
    });
    this.gutter = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", "edit-arrow.svg"),
      gutterIconSize: "contain",
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
        const native = this.nativeStore.get();
        if (native && e.document.uri.toString() === native.uri) {
          // Any change (including the accept itself) ends the native suggestion.
          this.nativeStore.clear();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.lensEmitter.fire();
        this.nativeStore.clear();
      }),
    );
    void vscode.commands.executeCommand("setContext", CONTEXT_PENDING, false);
    void vscode.commands.executeCommand("setContext", CONTEXT_NATIVE, false);
  }

  /** Whether the editor's native inline-edit UI is used for the next suggestion. */
  useNative(): boolean {
    const mode = this.service.config.edit.presentation;
    if (mode === "inline-decorations") {
      return false;
    }
    const available = isNativeInlineEditAvailable();
    if (mode === "native" && !available) {
      this.service.log.warn(
        "edit.presentation is 'native' but the inlineCompletionsAdditions proposal is not enabled; falling back to decorations.",
      );
    }
    return available;
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
    const preview = buildEditPreview(selection, replacement);
    if (!preview.changed) {
      void vscode.window.showInformationMessage("ClaudeComplete: the model suggested no change.");
      return;
    }
    if (this.useNative()) {
      await this.showNative(editor, range, preview.newText);
    } else {
      await this.showDecorated(editor, range, preview);
    }
  }

  /** Native path: hand the edit to VS Code's inline-edit renderer through the completion provider. */
  private async showNative(
    editor: vscode.TextEditor,
    range: vscode.Range,
    newText: string,
  ): Promise<void> {
    this.nativeStore.set({
      uri: editor.document.uri.toString(),
      range,
      newText,
      createdAt: Date.now(),
    });
    await vscode.commands.executeCommand("setContext", CONTEXT_NATIVE, true);
    // Put the cursor on the edit so the inline edit is shown right away, then ask for it.
    editor.selection = new vscode.Selection(range.start, range.start);
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    this.service.log.info(`edit: native inline edit offered at line ${range.start.line + 1}`);
  }

  /** Fallback path: decorations in the editor, document only extended by purely new lines. */
  private async showDecorated(
    editor: vscode.TextEditor,
    range: vscode.Range,
    preview: EditPreview,
  ): Promise<void> {
    const ok = await editor.edit((b) => b.replace(range, preview.regionText), {
      undoStopBefore: true,
      undoStopAfter: false,
    });
    if (!ok) {
      return;
    }
    const doc = editor.document;
    const base = range.start.line;
    const lineRange = (offset: number) =>
      new vscode.Range(base + offset, 0, base + offset, doc.lineAt(base + offset).text.length);

    this.pending = {
      editor,
      documentVersion: doc.version,
      startLine: base,
      regionLineCount: preview.regionText.split("\n").length,
      oldText: preview.oldText,
      newText: preview.newText,
    };

    editor.setDecorations(this.addedLine, preview.addedLines.map(lineRange));
    editor.setDecorations(this.removedLine, preview.removedLines.map(lineRange));
    const removedWords: vscode.Range[] = [];
    const insertedWords: vscode.DecorationOptions[] = [];
    for (const m of preview.modified) {
      const line = base + m.line;
      for (const r of m.removed) {
        removedWords.push(new vscode.Range(line, r.start, line, r.end));
      }
      for (const ins of m.inserted) {
        insertedWords.push({
          range: new vscode.Range(line, ins.col, line, ins.col),
          renderOptions: { before: { contentText: ins.text.replace(/ /g, " ") } },
        });
      }
    }
    editor.setDecorations(this.removedWord, removedWords);
    editor.setDecorations(this.insertedWord, insertedWords);
    editor.setDecorations(this.gutter, [
      {
        range: lineRange(preview.firstChangedLine),
        hoverMessage: buildGutterHover(preview.newText, doc.languageId),
      },
    ]);
    await vscode.commands.executeCommand("setContext", CONTEXT_PENDING, true);
    this.lensEmitter.fire();
  }

  async accept(): Promise<void> {
    await this.resolve("accept");
  }

  async reject(): Promise<void> {
    if (this.nativeStore.get()) {
      this.nativeStore.clear();
      await vscode.commands.executeCommand("editor.action.inlineSuggest.hide");
      await vscode.commands.executeCommand("setContext", CONTEXT_NATIVE, false);
      return;
    }
    await this.resolve("reject");
  }

  /** Called through the item command when VS Code applied a native inline edit. */
  async nativeAccepted(): Promise<void> {
    this.nativeStore.clear();
    this.service.stats.completionsAccepted++;
    this.service.statusBar.refresh();
    await vscode.commands.executeCommand("setContext", CONTEXT_NATIVE, false);
  }

  private clearDecorations(editor: vscode.TextEditor): void {
    for (const d of [
      this.addedLine,
      this.removedLine,
      this.removedWord,
      this.insertedWord,
      this.gutter,
    ]) {
      editor.setDecorations(d, []);
    }
  }

  private async resolve(mode: "accept" | "reject"): Promise<void> {
    const p = this.pending;
    if (!p) {
      return;
    }
    this.pending = undefined;
    const doc = p.editor.document;
    this.clearDecorations(p.editor);
    if (doc.version === p.documentVersion) {
      const lastLine = p.startLine + p.regionLineCount - 1;
      const region = new vscode.Range(p.startLine, 0, lastLine, doc.lineAt(lastLine).text.length);
      await p.editor.edit((b) => b.replace(region, mode === "accept" ? p.newText : p.oldText), {
        undoStopBefore: false,
        undoStopAfter: true,
      });
      if (mode === "accept") {
        this.service.stats.completionsAccepted++;
        this.service.statusBar.refresh();
      }
    }
    await vscode.commands.executeCommand("setContext", CONTEXT_PENDING, false);
    this.lensEmitter.fire();
  }

  private abandon(message: string): void {
    const p = this.pending;
    if (!p) {
      return;
    }
    this.pending = undefined;
    this.clearDecorations(p.editor);
    void vscode.commands.executeCommand("setContext", CONTEXT_PENDING, false);
    this.lensEmitter.fire();
    void vscode.window.showWarningMessage(`ClaudeComplete: ${message}`);
  }

  dispose(): void {
    this.pending = undefined;
    for (const d of [
      this.addedLine,
      this.removedLine,
      this.removedWord,
      this.insertedWord,
      this.gutter,
    ]) {
      d.dispose();
    }
    this.lensEmitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
