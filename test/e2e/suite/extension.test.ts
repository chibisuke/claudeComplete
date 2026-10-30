import * as assert from "node:assert";
import * as vscode from "vscode";

suite("ClaudeComplete extension", () => {
  test("activates and registers its commands", async () => {
    const ext = vscode.extensions.getExtension("chibisuke.claudecomplete");
    assert.ok(ext, "extension not found");
    await ext.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      "claudeComplete.setApiKey",
      "claudeComplete.toggle",
      "claudeComplete.editSelection",
      "claudeComplete.acceptEdit",
      "claudeComplete.rejectEdit",
      "claudeComplete.showLogs",
    ]) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  });

  test("exposes the documented settings with defaults", () => {
    const cfg = vscode.workspace.getConfiguration("claudeComplete");
    assert.strictEqual(cfg.get("provider"), "anthropic");
    assert.strictEqual(cfg.get("completion.model"), "claude-haiku-5-5");
    assert.strictEqual(cfg.get("edit.model"), "claude-sonnet-5-5");
    assert.strictEqual(cfg.get("cache.enabled"), true);
  });
});
