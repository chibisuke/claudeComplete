import * as vscode from "vscode";
import type { UsageStats } from "./stats";

export type Status = "idle" | "loading" | "disabled" | "error" | "no-key";

export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private status: Status = "idle";
  private detail = "";

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

  private render(): void {
    const icons: Record<Status, string> = {
      idle: "$(sparkle)",
      loading: "$(loading~spin)",
      disabled: "$(circle-slash)",
      error: "$(warning)",
      "no-key": "$(key)",
    };
    this.item.text = `${icons[this.status]} Claude`;
    this.item.backgroundColor =
      this.status === "error" || this.status === "no-key"
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;
    const head =
      this.status === "disabled"
        ? "ClaudeComplete: inline completions disabled (click to enable)"
        : this.status === "no-key"
          ? "ClaudeComplete: no API key set - run 'ClaudeComplete: Set API Key'"
          : this.status === "error"
            ? `ClaudeComplete: ${this.detail || "error"}`
            : this.status === "loading"
              ? "ClaudeComplete: requesting completion..."
              : "ClaudeComplete: ready (click to disable)";
    const md = new vscode.MarkdownString(
      `${head}\n\n${this.stats.summary().replace(/\n/g, "  \n")}`,
    );
    this.item.tooltip = md;
  }

  dispose(): void {
    this.item.dispose();
  }
}
