/**
 * Minimal Server-Sent-Events parser for OpenAI-style streaming responses.
 * Feed raw chunks via `push`, read complete `data:` payloads from the returned array.
 */
export class SSEParser {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const events: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const data = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data.length > 0) {
        events.push(data);
      }
    }
    return events;
  }

  /** Flush a trailing event without a terminating blank line. */
  end(): string[] {
    if (this.buffer.trim().length === 0) {
      this.buffer = "";
      return [];
    }
    const rest = this.push("\n\n");
    this.buffer = "";
    return rest;
  }
}

export interface OpenAIChunk {
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
  error?: { message?: string };
}

/** Extracts the text delta from one OpenAI streaming chunk, or undefined. */
export function deltaText(chunk: OpenAIChunk): string | undefined {
  const content = chunk.choices?.[0]?.delta?.content;
  return typeof content === "string" && content.length > 0 ? content : undefined;
}
