import * as vscode from "vscode";
import {
  DEFAULT_COMPLETION_SYSTEM_PROMPT,
  DEFAULT_COMPLETION_TEMPLATE,
  DEFAULT_EDIT_SYSTEM_PROMPT,
  DEFAULT_EDIT_TEMPLATE,
} from "./prompts/defaults";

export type ProviderId = "anthropic" | "openai-compatible";
export type Effort = "low" | "medium" | "high";

export interface ClaudeCompleteConfig {
  enabled: boolean;
  provider: ProviderId;
  anthropicBaseUrl: string;
  openaiBaseUrl: string;
  completion: {
    model: string;
    maxTokens: number;
    effort: Effort;
    debounceMs: number;
    multiline: "auto" | "always" | "never";
    contextLinesBefore: number;
    contextLinesAfter: number;
    includeOpenTabs: boolean;
    systemPrompt: string;
    promptTemplate: string;
  };
  edit: {
    model: string;
    maxTokens: number;
    effort: Effort;
    presentation: "auto" | "native" | "inline-decorations";
    systemPrompt: string;
    promptTemplate: string;
  };
  disabledLanguages: string[];
  cache: {
    enabled: boolean;
    systemPromptTtl: "5m" | "1h";
    prewarm: boolean;
    keepAlive: boolean;
    snapshotMaxChars: number;
    snapshotRefreshLines: number;
    snapshotMaxAgeSec: number;
  };
  logPrompts: boolean;
}

export const SECTION = "claudeComplete";

function orDefault(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value : fallback;
}

export function readConfig(scope?: vscode.ConfigurationScope): ClaudeCompleteConfig {
  const c = vscode.workspace.getConfiguration(SECTION, scope);
  return {
    enabled: c.get<boolean>("enabled", true),
    provider: c.get<ProviderId>("provider", "anthropic"),
    anthropicBaseUrl: c.get<string>("anthropic.baseUrl", ""),
    openaiBaseUrl: c.get<string>("openai.baseUrl", "http://localhost:11434/v1"),
    completion: {
      model: c.get<string>("completion.model", "claude-haiku-5-5"),
      maxTokens: c.get<number>("completion.maxTokens", 256),
      effort: c.get<Effort>("completion.effort", "low"),
      debounceMs: c.get<number>("completion.debounceMs", 300),
      multiline: c.get<"auto" | "always" | "never">("completion.multiline", "auto"),
      contextLinesBefore: c.get<number>("completion.contextLinesBefore", 60),
      contextLinesAfter: c.get<number>("completion.contextLinesAfter", 20),
      includeOpenTabs: c.get<boolean>("completion.includeOpenTabs", true),
      systemPrompt: orDefault(
        c.get<string>("completion.systemPrompt"),
        DEFAULT_COMPLETION_SYSTEM_PROMPT,
      ),
      promptTemplate: orDefault(
        c.get<string>("completion.promptTemplate"),
        DEFAULT_COMPLETION_TEMPLATE,
      ),
    },
    edit: {
      model: c.get<string>("edit.model", "claude-sonnet-5-5"),
      maxTokens: c.get<number>("edit.maxTokens", 4096),
      effort: c.get<Effort>("edit.effort", "medium"),
      presentation: c.get<"auto" | "native" | "inline-decorations">("edit.presentation", "auto"),
      systemPrompt: orDefault(c.get<string>("edit.systemPrompt"), DEFAULT_EDIT_SYSTEM_PROMPT),
      promptTemplate: orDefault(c.get<string>("edit.promptTemplate"), DEFAULT_EDIT_TEMPLATE),
    },
    disabledLanguages: c.get<string[]>("disabledLanguages", ["plaintext", "markdown", "scminput"]),
    cache: {
      enabled: c.get<boolean>("cache.enabled", true),
      systemPromptTtl: c.get<"5m" | "1h">("cache.systemPromptTtl", "5m"),
      prewarm: c.get<boolean>("cache.prewarm", true),
      keepAlive: c.get<boolean>("cache.keepAlive", false),
      snapshotMaxChars: c.get<number>("cache.snapshotMaxChars", 32000),
      snapshotRefreshLines: c.get<number>("cache.snapshotRefreshLines", 20),
      snapshotMaxAgeSec: c.get<number>("cache.snapshotMaxAgeSec", 120),
    },
    logPrompts: c.get<boolean>("logPrompts", false),
  };
}

export function onConfigChanged(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SECTION)) {
      listener();
    }
  });
}

/** Clears user-level prompt overrides so the built-in defaults apply again. */
export async function resetPrompts(): Promise<void> {
  const c = vscode.workspace.getConfiguration(SECTION);
  for (const key of [
    "completion.systemPrompt",
    "completion.promptTemplate",
    "edit.systemPrompt",
    "edit.promptTemplate",
  ]) {
    await c.update(key, undefined, vscode.ConfigurationTarget.Global);
    await c.update(key, undefined, vscode.ConfigurationTarget.Workspace);
  }
}
