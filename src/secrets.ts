import * as vscode from "vscode";
import type { ProviderId } from "./config";

const KEYS: Record<ProviderId, string> = {
  anthropic: "claudeComplete.apiKey.anthropic",
  "openai-compatible": "claudeComplete.apiKey.openai",
};

export class SecretStore {
  private readonly emitter = new vscode.EventEmitter<ProviderId>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(provider: ProviderId): Promise<string | undefined> {
    const value = await this.secrets.get(KEYS[provider]);
    return value && value.length > 0 ? value : undefined;
  }

  async set(provider: ProviderId, value: string): Promise<void> {
    await this.secrets.store(KEYS[provider], value);
    this.emitter.fire(provider);
  }

  async clear(provider: ProviderId): Promise<void> {
    await this.secrets.delete(KEYS[provider]);
    this.emitter.fire(provider);
  }

  /** Interactive prompt for an API key. Returns true when a key was stored. */
  async promptAndStore(provider: ProviderId): Promise<boolean> {
    const label = provider === "anthropic" ? "Anthropic (Claude API)" : "OpenAI-compatible API";
    const value = await vscode.window.showInputBox({
      title: `ClaudeComplete: API key for ${label}`,
      prompt:
        provider === "anthropic"
          ? "Paste your Anthropic API key (sk-ant-...). It is stored in VS Code's secret storage."
          : "Paste the API key for your OpenAI-compatible endpoint (leave empty for servers without auth, e.g. Ollama).",
      password: true,
      ignoreFocusOut: true,
    });
    if (value === undefined) {
      return false;
    }
    if (value.trim().length === 0) {
      await this.clear(provider);
      return provider !== "anthropic";
    }
    await this.set(provider, value.trim());
    return true;
  }
}
