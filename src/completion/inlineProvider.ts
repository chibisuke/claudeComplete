import * as vscode from "vscode";
import { renderTemplate } from "../prompts/template";
import type { CompletionService } from "../service";
import { collectStream, LLMError } from "../llm/types";
import { hashKey, LRUCache } from "./cache";
import { buildCursorWindow } from "./contextBuilder";
import { postprocessCompletion } from "./postprocess";
import { toNativeInlineEditItem, type NativeEditStore } from "../edit/nativeInlineEdit";

function delay(ms: number, token: vscode.CancellationToken): Promise<boolean> {
  if (ms <= 0) {
    return Promise.resolve(!token.isCancellationRequested);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve(!token.isCancellationRequested);
    }, ms);
    const sub = token.onCancellationRequested(() => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export class ClaudeInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly cache = new LRUCache<string>(100);
  private inFlight = 0;

  constructor(
    private readonly service: CompletionService,
    private readonly nativeEdits: NativeEditStore,
  ) {}

  /** Proposed-API hook (inlineCompletionsAdditions): called when an item is no longer shown. */
  handleEndOfLifetime(_item: vscode.InlineCompletionItem, reason: { kind: number }): void {
    // 0 = Accepted (handled by the item command), 1 = Rejected, 2 = Ignored.
    if (reason.kind === 1 && this.nativeEdits.get()) {
      this.nativeEdits.clear();
      void vscode.commands.executeCommand("setContext", "claudeComplete.nativeEdit", false);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const cfg = this.service.config;
    const nativeEdit = this.nativeEdits.get();
    if (nativeEdit) {
      // A pending edit suggestion takes over the inline-suggest slot (native Copilot-style UI).
      return nativeEdit.uri === document.uri.toString()
        ? [toNativeInlineEditItem(nativeEdit)]
        : undefined;
    }
    if (!cfg.enabled || cfg.disabledLanguages.includes(document.languageId)) {
      return undefined;
    }
    if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
      return undefined;
    }

    const filename = vscode.workspace.asRelativePath(document.uri, false);
    const window = buildCursorWindow(
      document,
      position,
      cfg.completion.contextLinesBefore,
      cfg.completion.contextLinesAfter,
      filename,
    );
    // When IntelliSense shows a selected entry, VS Code expects the completion to start with it.
    const selected = context.selectedCompletionInfo;
    if (selected && !selected.text.startsWith(document.getText(selected.range))) {
      return undefined;
    }

    const key = hashKey(
      document.uri.toString(),
      cfg.completion.model,
      window.prefix,
      window.suffix,
    );
    let text = this.cache.get(key);

    if (text === undefined) {
      const isAutomatic = context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic;
      if (isAutomatic && !(await delay(cfg.completion.debounceMs, token))) {
        return undefined;
      }
      text = await this.request(document, position, window, token);
      if (token.isCancellationRequested) {
        return undefined;
      }
      if (text === undefined) {
        return undefined;
      }
      this.cache.set(key, text);
    }

    const nextLine =
      position.line + 1 < document.lineCount ? document.lineAt(position.line + 1).text : "";
    const processed = postprocessCompletion({
      raw: text,
      linePrefix: window.linePrefix,
      lineSuffix: window.lineSuffix,
      nextLine,
      multiline: cfg.completion.multiline,
    });
    if (!processed) {
      return undefined;
    }
    this.service.stats.completionsShown++;
    const item = new vscode.InlineCompletionItem(processed, new vscode.Range(position, position), {
      command: "claudeComplete.completionAccepted",
      title: "",
    });
    return [item];
  }

  private async request(
    document: vscode.TextDocument,
    position: vscode.Position,
    window: ReturnType<typeof buildCursorWindow>,
    token: vscode.CancellationToken,
  ): Promise<string | undefined> {
    const cfg = this.service.config;
    let provider;
    try {
      provider = this.service.getProvider();
    } catch (err) {
      this.service.reportError(err, "completion");
      return undefined;
    }

    const system = this.service.buildSystem(cfg.completion.systemPrompt, document, position.line);
    const user = renderTemplate(cfg.completion.promptTemplate, {
      prefix: window.prefix,
      suffix: window.suffix,
      language: window.language,
      filename: window.filename,
    });
    if (cfg.logPrompts) {
      this.service.log.prompt("completion", system.map((b) => b.text).join("\n\n"), user);
    }

    this.inFlight++;
    this.service.statusBar.set("loading");
    const started = Date.now();
    try {
      const result = provider.stream(
        {
          model: cfg.completion.model,
          system,
          user,
          maxTokens: cfg.completion.maxTokens,
          stop: ["</prefix>", "<suffix>", "</suffix>", "```"],
          effort: cfg.completion.effort,
        },
        token,
      );
      const text = await collectStream(result);
      const usage = await result.usage.catch((err: unknown) => {
        if (err instanceof LLMError && err.kind === "refusal") {
          this.service.log.warn("Completion refused by the model.");
          return undefined;
        }
        throw err;
      });
      this.service.stats.add(usage);
      this.service.touch();
      this.service.log.usage("completion", usage, Date.now() - started);
      if (!token.isCancellationRequested) {
        this.service.statusBar.set("idle");
      }
      return text;
    } catch (err) {
      if (token.isCancellationRequested) {
        return undefined;
      }
      this.service.reportError(err, "completion");
      return undefined;
    } finally {
      this.inFlight--;
      if (this.inFlight === 0 && token.isCancellationRequested) {
        this.service.statusBar.set(cfg.enabled ? "idle" : "disabled");
      }
    }
  }
}
