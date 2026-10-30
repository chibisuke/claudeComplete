import type { LLMUsage } from "../llm/types";

export class UsageStats {
  requests = 0;
  inputTokens = 0;
  outputTokens = 0;
  cacheReadTokens = 0;
  cacheWriteTokens = 0;
  completionsShown = 0;
  completionsAccepted = 0;

  add(usage: LLMUsage | undefined): void {
    this.requests++;
    if (!usage) {
      return;
    }
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.cacheReadTokens += usage.cacheReadTokens;
    this.cacheWriteTokens += usage.cacheWriteTokens;
  }

  /** Share of prompt tokens served from cache. */
  cacheHitRate(): number {
    const total = this.inputTokens + this.cacheReadTokens + this.cacheWriteTokens;
    return total === 0 ? 0 : this.cacheReadTokens / total;
  }

  summary(): string {
    const pct = Math.round(this.cacheHitRate() * 100);
    return [
      `Requests: ${this.requests}`,
      `Prompt tokens: ${this.inputTokens} uncached, ${this.cacheReadTokens} cache reads, ${this.cacheWriteTokens} cache writes (${pct}% hit rate)`,
      `Output tokens: ${this.outputTokens}`,
      `Completions shown/accepted: ${this.completionsShown}/${this.completionsAccepted}`,
    ].join("\n");
  }
}
