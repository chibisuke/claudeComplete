import * as vscode from "vscode";

export const EXTENSION_ID = "chibisuke.claudecomplete";
export const INLINE_EDIT_PROPOSAL = "inlineCompletionsAdditions";

/**
 * True when VS Code granted this extension the `inlineCompletionsAdditions` proposal, which
 * unlocks the editor's native inline-edit rendering (floating diff box, gutter menu) used by
 * Copilot. VS Code strips disallowed proposals from the manifest it hands back, so reading it
 * reflects the effective state, not just what package.json asks for.
 */
export function isNativeInlineEditAvailable(
  getExtension: (id: string) => { packageJSON?: unknown } | undefined = (id) =>
    vscode.extensions.getExtension(id),
): boolean {
  const manifest = getExtension(EXTENSION_ID)?.packageJSON as
    { enabledApiProposals?: unknown } | undefined;
  const proposals = manifest?.enabledApiProposals;
  return Array.isArray(proposals) && proposals.includes(INLINE_EDIT_PROPOSAL);
}

export interface PendingNativeEdit {
  uri: string;
  range: vscode.Range;
  newText: string;
  createdAt: number;
}

/** Holds the edit that the inline completion provider should present as a native inline edit. */
export class NativeEditStore {
  private pending: PendingNativeEdit | undefined;
  private readonly emitter = new vscode.EventEmitter<PendingNativeEdit | undefined>();
  readonly onDidChange = this.emitter.event;

  get(): PendingNativeEdit | undefined {
    return this.pending;
  }

  set(edit: PendingNativeEdit): void {
    this.pending = edit;
    this.emitter.fire(edit);
  }

  clear(): void {
    if (this.pending) {
      this.pending = undefined;
      this.emitter.fire(undefined);
    }
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

/** Extra fields of the proposed API; typed loosely so the stable build compiles without it. */
export interface InlineEditFields {
  isInlineEdit?: boolean;
  showRange?: vscode.Range;
  showInlineEditMenu?: boolean;
}

export function toNativeInlineEditItem(edit: PendingNativeEdit): vscode.InlineCompletionItem {
  const item = new vscode.InlineCompletionItem(edit.newText, edit.range, {
    command: "claudeComplete.editAccepted",
    title: "",
  });
  const fields = item as vscode.InlineCompletionItem & InlineEditFields;
  fields.isInlineEdit = true;
  fields.showInlineEditMenu = true;
  fields.showRange = edit.range;
  return item;
}
