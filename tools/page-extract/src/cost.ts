/** 1M トークンあたりの USD 単価（Claude API 第一者料金） */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export type CostBreakdown = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  usd: number | null;
};

/**
 * input_tokens はキャッシュ分を含まない「素のまま課金される分」なので、
 * 総入力量は input + cache_creation + cache_read になる。
 * キャッシュ書き込みは 1.25 倍、読み出しは 0.1 倍で課金される。
 */
export function estimateCost(model: string, usage: Usage): CostBreakdown {
  const price = PRICES[model];
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;

  const breakdown: CostBreakdown = {
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheWriteTokens,
    cacheReadTokens,
    usd: null,
  };

  if (!price) return breakdown;

  breakdown.usd =
    (usage.input_tokens * price.input +
      cacheWriteTokens * price.input * 1.25 +
      cacheReadTokens * price.input * 0.1 +
      usage.output_tokens * price.output) /
    1_000_000;

  return breakdown;
}

export function formatUsd(usd: number | null): string {
  if (usd === null) return "不明（単価未登録）";
  return `$${usd.toFixed(4)}`;
}
