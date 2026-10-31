/** Mirrors vscode.InlineCompletionTriggerKind without importing the editor module. */
export const TRIGGER_INVOKE = 0;
export const TRIGGER_AUTOMATIC = 1;

export interface GateInput {
  /** `claudeComplete.enabled`: automatic completions while typing. */
  enabled: boolean;
  triggerKind: number;
  /** A manual request (Ctrl+Alt+Space) is pending for this document. */
  manualPending: boolean;
}

/**
 * Decides whether an inline completion request is served. With automatic completions off, only
 * an explicit invocation that was announced through `claudeComplete.triggerCompletion` goes
 * through, so neither typing nor the editor's own trigger shortcut costs a request.
 */
export function shouldServe(input: GateInput): boolean {
  if (input.enabled) {
    return true;
  }
  return input.triggerKind === TRIGGER_INVOKE && input.manualPending;
}

/** Tracks a one-shot manual trigger with an expiry so a stale flag never leaks into typing. */
export class ManualTrigger {
  private uri: string | undefined;
  private expiresAt = 0;

  constructor(private readonly ttlMs = 2000) {}

  arm(uri: string, now = Date.now()): void {
    this.uri = uri;
    this.expiresAt = now + this.ttlMs;
  }

  /** Returns true (and consumes the flag) when a manual request is pending for `uri`. */
  consume(uri: string, now = Date.now()): boolean {
    const hit = this.uri === uri && now <= this.expiresAt;
    this.uri = undefined;
    this.expiresAt = 0;
    return hit;
  }

  isPending(uri: string, now = Date.now()): boolean {
    return this.uri === uri && now <= this.expiresAt;
  }
}
