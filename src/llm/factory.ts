import type { ClaudeCompleteConfig } from "../config";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatProvider } from "./openaiCompat";
import { LLMError, type LLMProvider } from "./types";

export function createProvider(
  config: ClaudeCompleteConfig,
  apiKey: string | undefined,
): LLMProvider {
  if (config.provider === "anthropic") {
    if (!apiKey) {
      throw new LLMError("No Anthropic API key set. Run 'ClaudeComplete: Set API Key'.", "auth");
    }
    return new AnthropicProvider({
      apiKey,
      baseUrl: config.anthropicBaseUrl,
      cacheEnabled: config.cache.enabled,
    });
  }
  return new OpenAICompatProvider({ baseUrl: config.openaiBaseUrl, apiKey });
}
