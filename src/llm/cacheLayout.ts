import { SNAPSHOT_HEADER } from "../prompts/defaults";
import type { SystemBlock } from "./types";

export interface CacheLayoutOptions {
  enabled: boolean;
  systemPromptTtl: "5m" | "1h";
}

/**
 * Three-layer prompt: [system prompt | cache] [snapshot | cache] [volatile user message].
 * Longer TTLs must precede shorter ones, so the system prompt (optionally 1h) comes first.
 */
export function buildSystemBlocks(
  systemPrompt: string,
  snapshotText: string | undefined,
  opts: CacheLayoutOptions,
): SystemBlock[] {
  const blocks: SystemBlock[] = [
    { text: systemPrompt, cache: opts.enabled ? { ttl: opts.systemPromptTtl } : undefined },
  ];
  if (snapshotText && snapshotText.length > 0) {
    blocks.push({
      text: `${SNAPSHOT_HEADER}\n\n${snapshotText}`,
      cache: opts.enabled ? { ttl: "5m" } : undefined,
    });
  }
  return blocks;
}
