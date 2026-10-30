import Anthropic from "@anthropic-ai/sdk";
import type * as vscode from "vscode";
import {
  abortSignalFrom,
  LLMError,
  type LLMProvider,
  type LLMRequest,
  type LLMStreamResult,
  type LLMUsage,
} from "./types";

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl?: string;
  /** When false, no cache_control markers are sent. */
  cacheEnabled: boolean;
}

type SystemParam = Anthropic.MessageCreateParams["system"];

/** Builds the system array with cache_control breakpoints at the marked blocks (max 4). */
export function buildSystemParam(req: LLMRequest, cacheEnabled: boolean): SystemParam {
  const blocks: Anthropic.TextBlockParam[] = [];
  let breakpoints = 0;
  for (const block of req.system) {
    if (!block.text) {
      continue;
    }
    const param: Anthropic.TextBlockParam = { type: "text", text: block.text };
    if (cacheEnabled && block.cache && breakpoints < 4) {
      param.cache_control =
        block.cache.ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
      breakpoints++;
    }
    blocks.push(param);
  }
  return blocks;
}

function toUsage(usage: Anthropic.Usage | undefined): LLMUsage | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

export function mapAnthropicError(err: unknown): LLMError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new LLMError("Invalid or missing Anthropic API key.", "auth", err);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new LLMError("Claude API rate limit reached.", "rate-limit", err);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new LLMError(`Claude API rejected the request: ${err.message}`, "bad-request", err);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LLMError("Could not reach the Claude API.", "network", err);
  }
  if (err instanceof Anthropic.APIError) {
    return new LLMError(`Claude API error ${err.status ?? ""}: ${err.message}`, "other", err);
  }
  return new LLMError(err instanceof Error ? err.message : String(err), "other", err);
}

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic" as const;
  readonly supportsPromptCache: boolean;
  private readonly client: Anthropic;

  constructor(private readonly opts: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl || undefined,
      maxRetries: 1,
      timeout: 60_000,
    });
    this.supportsPromptCache = opts.cacheEnabled;
  }

  private params(req: LLMRequest, maxTokens: number): Anthropic.MessageCreateParamsNonStreaming {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: req.model,
      max_tokens: maxTokens,
      system: buildSystemParam(req, this.opts.cacheEnabled),
      messages: [{ role: "user", content: req.user }],
    };
    if (req.stop && req.stop.length > 0) {
      params.stop_sequences = req.stop;
    }
    if (req.effort) {
      params.output_config = { effort: req.effort };
    }
    return params;
  }

  stream(req: LLMRequest, token: vscode.CancellationToken): LLMStreamResult {
    const signal = abortSignalFrom(token);
    const stream = this.client.messages.stream(this.params(req, req.maxTokens), { signal });

    const text = (async function* (): AsyncGenerator<string> {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield event.delta.text;
          }
        }
      } catch (err) {
        if (signal.aborted) {
          return;
        }
        throw mapAnthropicError(err);
      }
    })();

    const usage = (async (): Promise<LLMUsage | undefined> => {
      try {
        const message = await stream.finalMessage();
        if (message.stop_reason === "refusal") {
          throw new LLMError("The model declined to answer this request.", "refusal");
        }
        return toUsage(message.usage);
      } catch (err) {
        if (signal.aborted) {
          return undefined;
        }
        if (err instanceof LLMError) {
          throw err;
        }
        throw mapAnthropicError(err);
      }
    })();
    // Avoid unhandled rejection when the caller only consumes `text`.
    usage.catch(() => undefined);

    return { text, usage };
  }

  async prewarm(req: LLMRequest, token: vscode.CancellationToken): Promise<LLMUsage | undefined> {
    if (!this.opts.cacheEnabled) {
      return undefined;
    }
    try {
      // max_tokens: 0 runs prefill only - writes the cache at our breakpoints, bills no output.
      const message = await this.client.messages.create(this.params(req, 0), {
        signal: abortSignalFrom(token),
      });
      return toUsage(message.usage);
    } catch (err) {
      if (token.isCancellationRequested) {
        return undefined;
      }
      throw mapAnthropicError(err);
    }
  }
}
