import * as vscode from "vscode";
import { SnapshotManager } from "./completion/contextSnapshot";
import { readConfig, type ClaudeCompleteConfig } from "./config";
import { buildSystemBlocks } from "./llm/cacheLayout";
import { createProvider } from "./llm/factory";
import { LLMError, type LLMProvider, type LLMRequest } from "./llm/types";
import { SecretStore } from "./secrets";
import { Logger } from "./ui/log";
import { UsageStats } from "./ui/stats";
import { StatusBar } from "./ui/statusBar";

/**
 * Shared runtime: configuration, provider instance, snapshot manager, cache pre-warming and
 * keep-alive. Both the inline completion provider and the edit command go through this.
 */
export class CompletionService implements vscode.Disposable {
  config: ClaudeCompleteConfig;
  readonly stats = new UsageStats();
  readonly log = new Logger();
  readonly statusBar = new StatusBar(this.stats);
  readonly snapshots: SnapshotManager;

  private provider: LLMProvider | undefined;
  private providerError: LLMError | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private keepAliveTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPrewarmKey = "";
  private lastRequestAt = 0;

  constructor(private readonly secrets: SecretStore) {
    this.config = readConfig();
    this.snapshots = new SnapshotManager(() => ({
      maxChars: this.config.cache.snapshotMaxChars,
      refreshLines: this.config.cache.snapshotRefreshLines,
      maxAgeSec: this.config.cache.snapshotMaxAgeSec,
      includeOpenTabs: this.config.completion.includeOpenTabs,
    }));
    this.disposables.push(
      this.snapshots,
      this.snapshots.onDidCreate((snap) => {
        if (this.config.cache.prewarm) {
          void this.prewarm(snap.uri);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => this.snapshots.invalidate(doc.uri)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.snapshots.invalidate(doc.uri)),
      secrets.onDidChange(() => void this.reload()),
    );
    void this.reload();
  }

  async reload(): Promise<void> {
    this.config = readConfig();
    this.snapshots.clear();
    this.provider = undefined;
    this.providerError = undefined;
    try {
      const key = await this.secrets.get(this.config.provider);
      this.provider = createProvider(this.config, key);
      this.statusBar.set(this.config.enabled ? "idle" : "disabled");
    } catch (err) {
      this.providerError = err instanceof LLMError ? err : new LLMError(String(err), "other", err);
      this.statusBar.set(
        this.providerError.kind === "auth" ? "no-key" : "error",
        this.providerError.message,
      );
      this.log.warn(this.providerError.message);
    }
    this.scheduleKeepAlive();
  }

  getProvider(): LLMProvider {
    if (this.provider) {
      return this.provider;
    }
    throw this.providerError ?? new LLMError("Provider not initialised.", "other");
  }

  /** The cached prefix (system prompt + snapshot) for a document at the given cursor line. */
  buildSystem(systemPrompt: string, doc: vscode.TextDocument, cursorLine: number) {
    const snapshot = this.snapshots.get(doc, cursorLine);
    return buildSystemBlocks(systemPrompt, snapshot.text, {
      enabled: this.config.cache.enabled && this.config.provider === "anthropic",
      systemPromptTtl: this.config.cache.systemPromptTtl,
    });
  }

  /** Writes the cache for the completion prompt of `uri` without generating anything. */
  private async prewarm(uri: string): Promise<void> {
    const provider = this.provider;
    if (!provider || !provider.supportsPromptCache || !this.config.enabled) {
      return;
    }
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
    const snap = this.snapshots.peek(vscode.Uri.parse(uri));
    if (!doc || !snap || this.config.disabledLanguages.includes(doc.languageId)) {
      return;
    }
    const key = `${this.config.completion.model}:${snap.createdAt}:${uri}`;
    if (key === this.lastPrewarmKey) {
      return;
    }
    this.lastPrewarmKey = key;
    const req: LLMRequest = {
      model: this.config.completion.model,
      system: buildSystemBlocks(this.config.completion.systemPrompt, snap.text, {
        enabled: true,
        systemPromptTtl: this.config.cache.systemPromptTtl,
      }),
      user: "(cache warm-up)",
      maxTokens: 0,
      effort: this.config.completion.effort,
    };
    const started = Date.now();
    try {
      const usage = await provider.prewarm(req, new vscode.CancellationTokenSource().token);
      this.stats.add(usage);
      this.lastRequestAt = Date.now();
      this.log.usage("prewarm", usage, Date.now() - started);
      this.statusBar.refresh();
      this.scheduleKeepAlive();
    } catch (err) {
      this.log.error("Cache pre-warm failed.", err);
    }
  }

  /** Called after every real request so the keep-alive timer knows when the cache was touched. */
  touch(): void {
    this.lastRequestAt = Date.now();
    this.scheduleKeepAlive();
  }

  private scheduleKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearTimeout(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
    if (
      !this.config.cache.keepAlive ||
      !this.provider?.supportsPromptCache ||
      !this.config.enabled
    ) {
      return;
    }
    // Refresh ~4 minutes after the last request (5-minute TTL), only while an editor is focused.
    const delay = Math.max(10_000, 4 * 60_000 - (Date.now() - this.lastRequestAt));
    this.keepAliveTimer = setTimeout(() => {
      this.keepAliveTimer = undefined;
      const editor = vscode.window.activeTextEditor;
      if (!editor || !vscode.window.state.focused) {
        this.scheduleKeepAlive();
        return;
      }
      const snap = this.snapshots.peek(editor.document.uri);
      if (snap && !this.snapshots.isStale(snap, editor.document, editor.selection.active.line)) {
        this.lastPrewarmKey = ""; // force
        void this.prewarm(snap.uri);
      }
    }, delay);
  }

  /** Maps an error to a status bar state and logs it. */
  reportError(err: unknown, label: string): void {
    const e = err instanceof LLMError ? err : new LLMError(String(err), "other", err);
    this.log.error(`${label} failed: ${e.message}`, e.cause);
    if (e.kind === "auth") {
      this.statusBar.set("no-key");
    } else if (e.kind !== "refusal") {
      this.statusBar.set("error", e.message);
    }
  }

  dispose(): void {
    if (this.keepAliveTimer) {
      clearTimeout(this.keepAliveTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.statusBar.dispose();
    this.log.dispose();
  }
}
