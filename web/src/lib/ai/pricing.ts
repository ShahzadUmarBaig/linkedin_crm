// Cost per million tokens, USD. Update as providers publish new prices.
// Unknown models get null pricing and are logged with cost_usd = 0.

import type { AiProvider } from '@/lib/settings'

interface Price {
  inputPerMTok: number
  outputPerMTok: number
}

const PRICES: Record<string, Price> = {
  // Anthropic — Claude 4.x family
  'claude-opus-4-8':   { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-opus-4-7':   { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-opus-4-6':   { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-sonnet-4-6': { inputPerMTok: 3,  outputPerMTok: 15 },
  'claude-haiku-4-5':  { inputPerMTok: 1,  outputPerMTok: 5 },

  // Google — Gemini 2.5 family
  'gemini-2.5-pro':         { inputPerMTok: 1.25, outputPerMTok: 10 },
  'gemini-2.5-flash':       { inputPerMTok: 0.30, outputPerMTok: 2.50 },
  'gemini-2.5-flash-lite':  { inputPerMTok: 0.10, outputPerMTok: 0.40 },
}

export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model]
  if (!price) return 0
  return (inputTokens / 1_000_000) * price.inputPerMTok + (outputTokens / 1_000_000) * price.outputPerMTok
}

export function isPricingKnown(model: string): boolean {
  return Boolean(PRICES[model])
}

export function defaultModelFor(provider: AiProvider): string {
  return provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash'
}
