import type * as vscode from "vscode";
import { deltaText, SSEParser, type OpenAIChunk } from "./sse";
import {
  abortSignalFrom,
  LLMError,
  type LLMProvider,
  type LLMRequest,
  type LLMStreamResult,
  type LLMUsage,
} from "./types";

export interface OpenAICompatOptions {
  baseUrl: string;
  apiKey?: string;
}

export function joinSystem(req: LLMRequest): string {
  return req.system
    .map((b) => b.text)
    .filter((t) => t.length > 0)
    .join("\n\n");
}

export class OpenAICompatProvider implements LLMProvider {
  readonly id = "openai-compatible" as const;
  readonly supportsPromptCache = false;

  constructor(private readonly opts: OpenAICompatOptions) {}

  private endpoint(): string {
    return this.opts.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  }

  private body(req: LLMRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: req.maxTokens,
      messages: [
        // Stable system content first so servers with prefix/KV caching can reuse it.
        { role: "system", content: joinSystem(req) },
        { role: "user", content: req.user },
      ],
    };
    if (req.stop && req.stop.length > 0) {
      body.stop = req.stop;
    }
    return body;
  }

  stream(req: LLMRequest, token: vscode.CancellationToken): LLMStreamResult {
    const signal = abortSignalFrom(token);
    let resolveUsage: (u: LLMUsage | undefined) => void = () => undefined;
    let rejectUsage: (e: unknown) => void = () => undefined;
    const usage = new Promise<LLMUsage | undefined>((res, rej) => {
      resolveUsage = res;
      rejectUsage = rej;
    });
    usage.catch(() => undefined);

    const endpoint = this.endpoint();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.apiKey) {
      headers.authorization = `Bearer ${this.opts.apiKey}`;
    }
    const body = JSON.stringify(this.body(req));

    const text = (async function* (): AsyncGenerator<string> {
      let finalUsage: LLMUsage | undefined;
      try {
        let response: Response;
        try {
          response = await fetch(endpoint, { method: "POST", headers, body, signal });
        } catch (err) {
          if (signal.aborted) {
            return;
          }
          throw new LLMError(`Could not reach ${endpoint}.`, "network", err);
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          const kind =
            response.status === 401 || response.status === 403
              ? "auth"
              : response.status === 429
                ? "rate-limit"
                : response.status === 400 || response.status === 404
                  ? "bad-request"
                  : "other";
          throw new LLMError(
            `HTTP ${response.status} from ${endpoint}: ${detail.slice(0, 300)}`,
            kind,
          );
        }
        if (!response.body) {
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SSEParser();
        const handle = function* (events: string[]): Generator<string> {
          for (const data of events) {
            if (data === "[DONE]") {
              continue;
            }
            let chunk: OpenAIChunk;
            try {
              chunk = JSON.parse(data) as OpenAIChunk;
            } catch {
              continue;
            }
            if (chunk.error?.message) {
              throw new LLMError(chunk.error.message, "other");
            }
            if (chunk.usage) {
              finalUsage = {
                inputTokens: chunk.usage.prompt_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? 0,
                cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
                cacheWriteTokens: 0,
              };
            }
            const delta = deltaText(chunk);
            if (delta !== undefined) {
              yield delta;
            }
          }
        };
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          yield* handle(parser.push(decoder.decode(value, { stream: true })));
        }
        yield* handle(parser.end());
        resolveUsage(finalUsage);
      } catch (err) {
        if (signal.aborted) {
          resolveUsage(finalUsage);
          return;
        }
        rejectUsage(err);
        throw err;
      }
    })();

    return { text, usage };
  }

  async prewarm(): Promise<LLMUsage | undefined> {
    return undefined;
  }
}
