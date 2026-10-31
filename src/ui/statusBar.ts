import * as vscode from "vscode";
import type { UsageStats } from "./stats";

export type Status = "idle" | "loading" | "manual" | "error" | "no-key";

export interface StatusBarInfo {
  cacheTtl: string;
  cacheEnabled: boolean;
}

export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private status: Status = "idle";
  private detail = "";
  private info: StatusBarInfo = { cacheTtl: "5m", cacheEnabled: true };

  constructor(private readonly stats: UsageStats) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = "ClaudeComplete";
    this.item.command = "claudeComplete.toggle";
    this.render();
    this.item.show();
  }

  set(status: Status, detail = ""): void {
    this.status = status;
    this.detail = detail;
    this.render();
  }

  refresh(): void {
    this.render();
  }

  setInfo(info: StatusBarInfo): void {
    this.info = info;
    this.render();
  }

  private render(): void {
    const icons: Record<Status, string> = {
      idle: "$(sparkle)",
      loading: "$(loading~spin)",
      manual: "$(circle-slash)",
      error: "$(warning)",
      "no-key": "$(key)",
    };
    this.item.text = `${icons[this.status]} Claude`;
    this.item.backgroundColor =
      this.status === "error" || this.status === "no-key"
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;
    const head =
      this.status === "manual"
        ? "**ClaudeComplete: automatic completions off.** `Ctrl+Alt+Space` requests one. Click to turn automatic completions on."
        : this.status === "no-key"
          ? "**ClaudeComplete: no API key set** - run 'ClaudeComplete: Set API Key'"
          : this.status === "error"
            ? `**ClaudeComplete: ${this.detail || "error"}**`
            : this.status === "loading"
              ? "**ClaudeComplete: requesting completion...**"
              : "**ClaudeComplete: automatic completions on.** Click to turn them off.";
    const cache = this.info.cacheEnabled
      ? `Prompt cache: on, system prompt TTL ${this.info.cacheTtl} ([switch to ${this.info.cacheTtl === "1h" ? "5m" : "1h"}](command:claudeComplete.toggleCacheTtl))`
      : "Prompt cache: off";
    const md = new vscode.MarkdownString(
      `${head}\n\n${cache}\n\n${this.stats.summary().replace(/\n/g, "  \n")}\n\n[Toggle automatic completions](command:claudeComplete.toggle) · [Trigger completion now](command:claudeComplete.triggerCompletion) · [Show logs](command:claudeComplete.showLogs)`,
    );
    md.isTrusted = {
      enabledCommands: [
        "claudeComplete.toggle",
        "claudeComplete.toggleCacheTtl",
        "claudeComplete.triggerCompletion",
        "claudeComplete.showLogs",
      ],
    };
    this.item.tooltip = md;
  }

  dispose(): void {
    this.item.dispose();
  }
}
