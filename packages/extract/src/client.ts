import Anthropic from "@anthropic-ai/sdk";
import type { CostRecord } from "@desk/core";

/**
 * Model configuration. Plan §6.6: a stronger model for extraction / re-ranking,
 * a smaller one for classification and routing. IDs come from env so they can
 * change without a code release; defaults are the current generation.
 */
export type ModelConfig = {
  extract: string;
  classify: string;
  rerank: string;
};

export function modelConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const extract = env.DESK_EXTRACT_MODEL || "claude-opus-5-5";
  return {
    extract,
    classify: env.DESK_CLASSIFY_MODEL || "claude-haiku-5-5",
    rerank: env.DESK_RERANK_MODEL || extract,
  };
}

/**
 * USD per million tokens. Used for the per-document cost gate (plan §6.4: <$0.10/order
 * at MVP). Keep in sync with https://docs.claude.com pricing; unknown models fall back
 * to the Opus rate so cost is over- rather than under-estimated.
 */
export const PRICE_TABLE: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function usageToCost(usage: Usage, model: string): CostRecord {
  const p = PRICE_TABLE[model] ?? PRICE_TABLE["claude-opus-5-5"]!;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const usd =
    (usage.input_tokens * p.input + usage.output_tokens * p.output + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite) /
    1_000_000;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    usd,
    calls: 1,
  };
}

let singleton: Anthropic | null = null;

/** Credentials resolve from the environment (ANTHROPIC_API_KEY or an `ant auth login` profile). */
export function getAnthropic(): Anthropic {
  if (!singleton) singleton = new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
  return singleton;
}
