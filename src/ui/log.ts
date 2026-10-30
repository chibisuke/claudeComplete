import * as vscode from "vscode";
import type { LLMUsage } from "../llm/types";

export class Logger {
  private readonly channel: vscode.LogOutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel("ClaudeComplete", { log: true });
  }

  info(message: string): void {
    this.channel.info(message);
  }

  warn(message: string): void {
    this.channel.warn(message);
  }

  error(message: string, err?: unknown): void {
    const detail = err instanceof Error ? ` ${err.message}` : err ? ` ${String(err)}` : "";
    this.channel.error(message + detail);
  }

  debug(message: string): void {
    this.channel.debug(message);
  }

  prompt(label: string, system: string, user: string): void {
    this.channel.debug(
      `${label} prompt\n--- system ---\n${system}\n--- user ---\n${user}\n--- end ---`,
    );
  }

  usage(label: string, usage: LLMUsage | undefined, ms: number): void {
    if (!usage) {
      this.channel.info(`${label}: ${ms} ms (no usage reported)`);
      return;
    }
    this.channel.info(
      `${label}: ${ms} ms | input ${usage.inputTokens} | cache read ${usage.cacheReadTokens} | cache write ${usage.cacheWriteTokens} | output ${usage.outputTokens}`,
    );
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
