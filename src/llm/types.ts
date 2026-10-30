import type * as vscode from "vscode";

/**
 * A system-prompt block. Blocks are rendered in order; `cache` marks the end of a stable
 * prefix that the Anthropic provider turns into a `cache_control` breakpoint. Providers that
 * have no explicit caching simply concatenate the blocks.
 */
export interface SystemBlock {
  text: string;
  cache?: { ttl: "5m" | "1h" };
}

export interface LLMRequest {
  model: string;
  /** Ordered system blocks: stable first, volatile last. */
  system: SystemBlock[];
  /** The volatile user message (cursor window, instruction, ...). */
  user: string;
  maxTokens: number;
  stop?: string[];
  /** Reasoning effort for Claude models; ignored by providers without the concept. */
  effort?: "low" | "medium" | "high";
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LLMStreamResult {
  /** Async iterator over text deltas. */
  text: AsyncIterable<string>;
  /** Resolves once the stream finished (or was aborted) with usage if the provider reports it. */
  usage: Promise<LLMUsage | undefined>;
}

export interface LLMProvider {
  readonly id: "anthropic" | "openai-compatible";
  /** Whether `prewarm()` does anything useful on this provider. */
  readonly supportsPromptCache: boolean;
  stream(req: LLMRequest, token: vscode.CancellationToken): LLMStreamResult;
  /** Write the cached prefix without generating output. No-op where unsupported. */
  prewarm(req: LLMRequest, token: vscode.CancellationToken): Promise<LLMUsage | undefined>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly kind: "auth" | "rate-limit" | "network" | "bad-request" | "refusal" | "other",
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

/** Collects all deltas of a stream into one string. */
export async function collectStream(result: LLMStreamResult): Promise<string> {
  let out = "";
  for await (const chunk of result.text) {
    out += chunk;
  }
  return out;
}

/** Turns a VS Code CancellationToken into an AbortSignal. */
export function abortSignalFrom(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    token.onCancellationRequested(() => controller.abort());
  }
  return controller.signal;
}
