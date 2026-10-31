import * as vscode from "vscode";
import { ClaudeInlineCompletionProvider } from "./completion/inlineProvider";
import { onConfigChanged, resetPrompts, SECTION } from "./config";
import { EditController } from "./edit/editCommand";
import { isNativeInlineEditAvailable, NativeEditStore } from "./edit/nativeInlineEdit";
import { SecretStore } from "./secrets";
import { CompletionService } from "./service";

export function activate(context: vscode.ExtensionContext): void {
  const secrets = new SecretStore(context.secrets);
  const service = new CompletionService(secrets);
  const nativeEdits = new NativeEditStore();
  const inline = new ClaudeInlineCompletionProvider(service, nativeEdits);
  const edits = new EditController(service, nativeEdits, context.extensionUri);

  context.subscriptions.push(
    service,
    edits,
    nativeEdits,
    vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, inline),
    onConfigChanged(() => {
      inline.clearCache();
      void service.reload();
    }),

    vscode.commands.registerCommand("claudeComplete.setApiKey", async () => {
      const stored = await secrets.promptAndStore(service.config.provider);
      if (stored) {
        void vscode.window.showInformationMessage("ClaudeComplete: API key saved.");
      }
    }),
    vscode.commands.registerCommand("claudeComplete.clearApiKey", async () => {
      await secrets.clear(service.config.provider);
      void vscode.window.showInformationMessage("ClaudeComplete: API key removed.");
    }),
    vscode.commands.registerCommand("claudeComplete.toggle", async () => {
      const cfg = vscode.workspace.getConfiguration(SECTION);
      const next = !cfg.get<boolean>("enabled", false);
      await cfg.update("enabled", next, vscode.ConfigurationTarget.Global);
      void vscode.window.setStatusBarMessage(
        `ClaudeComplete: automatic completions ${next ? "on" : "off"}`,
        2000,
      );
    }),
    vscode.commands.registerCommand("claudeComplete.triggerCompletion", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      inline.requestManual(editor.document);
      await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    }),
    vscode.commands.registerCommand("claudeComplete.toggleCacheTtl", async () => {
      const cfg = vscode.workspace.getConfiguration(SECTION);
      const next = cfg.get<string>("cache.systemPromptTtl", "5m") === "1h" ? "5m" : "1h";
      await cfg.update("cache.systemPromptTtl", next, vscode.ConfigurationTarget.Global);
      void vscode.window.setStatusBarMessage(
        `ClaudeComplete: prompt cache duration ${next === "1h" ? "1 hour" : "5 minutes"}`,
        3000,
      );
    }),
    vscode.commands.registerCommand("claudeComplete.editSelection", () => edits.editSelection()),
    vscode.commands.registerCommand("claudeComplete.acceptEdit", () => edits.accept()),
    vscode.commands.registerCommand("claudeComplete.rejectEdit", () => edits.reject()),
    vscode.commands.registerCommand("claudeComplete.editAccepted", () => edits.nativeAccepted()),
    vscode.commands.registerCommand("claudeComplete.showLogs", () => service.log.show()),
    vscode.commands.registerCommand("claudeComplete.resetPrompts", async () => {
      await resetPrompts();
      void vscode.window.showInformationMessage("ClaudeComplete: prompts reset to defaults.");
    }),
    vscode.commands.registerCommand("claudeComplete.refreshContext", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        service.snapshots.refresh(editor.document, editor.selection.active.line);
        inline.clearCache();
        void vscode.window.setStatusBarMessage("ClaudeComplete: context snapshot refreshed", 2000);
      }
    }),
    vscode.commands.registerCommand("claudeComplete.completionAccepted", () => {
      service.stats.completionsAccepted++;
      service.statusBar.refresh();
    }),
  );

  service.log.info(
    `ClaudeComplete activated. Native inline edits: ${isNativeInlineEditAvailable() ? "available" : "not enabled"} (enabledApiProposals=${JSON.stringify(
      (
        vscode.extensions.getExtension("chibisuke.claudecomplete")?.packageJSON as {
          enabledApiProposals?: unknown;
        }
      )?.enabledApiProposals ?? null,
    )}).`,
  );
}

export function deactivate(): void {
  // Disposables are cleaned up through context.subscriptions.
}
