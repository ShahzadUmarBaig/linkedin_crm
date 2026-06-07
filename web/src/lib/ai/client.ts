// Provider-agnostic AI client. One entry point: generate({ task, system, user, ... }).
// Handles: key fetch (decrypted), provider routing, budget check, ai_runs logging.

import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getDecryptedApiKey, loadSettings, type AiProvider } from '@/lib/settings'
import { BudgetExceededError, checkBudget } from './budget'
import { computeCostUsd, defaultModelFor } from './pricing'

export type AiTask =
  | 'profile_inference'
  | 'idea_generation'
  | 'draft_write'
  | 'schedule_slot'
  | 'topic_extract'

export interface GenerateRequest {
  userId: string
  task: AiTask
  system: string
  user: string
  provider?: AiProvider
  model?: string
  maxTokens?: number
  scrapeRunId?: string | null
}

export interface GenerateResponse {
  text: string
  provider: AiProvider
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  aiRunId: string
}

export async function generate(req: GenerateRequest): Promise<GenerateResponse> {
  const settings = await loadSettings(req.userId)
  const provider = req.provider ?? settings.defaultProvider
  const model = req.model ?? settings.taskModelOverrides[req.task] ?? settings.defaultModel ?? defaultModelFor(provider)

  const budget = await checkBudget(req.userId)
  if (budget.shouldBlock) throw new BudgetExceededError(budget)

  const apiKey = await getDecryptedApiKey(req.userId, provider)
  if (!apiKey) throw new Error(`No ${provider} API key configured. Visit /settings to add one.`)

  let text: string
  let inputTokens = 0
  let outputTokens = 0

  try {
    const result = await withRetry(
      () => (provider === 'anthropic' ? callAnthropic(apiKey, model, req) : callGoogle(apiKey, model, req)),
      { label: `${provider}/${model} ${req.task}` },
    )
    text = result.text
    inputTokens = result.inputTokens
    outputTokens = result.outputTokens
  } catch (err) {
    await logRun(req, provider, model, 0, 0, 0, 'error', err instanceof Error ? err.message : String(err))
    throw err
  }

  const costUsd = computeCostUsd(model, inputTokens, outputTokens)
  const aiRunId = await logRun(req, provider, model, inputTokens, outputTokens, costUsd, 'success', null)

  return { text, provider, model, inputTokens, outputTokens, costUsd, aiRunId }
}

// ---------- retry ----------
// Wraps provider calls. Retries only on transient errors (network, 429, 502/503/504).
// Other errors (auth, bad request, validation) fail immediately to surface real bugs.
const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 1000  // 1s, 3s, 9s — plus jitter

async function withRetry<T>(fn: () => Promise<T>, opts: { label: string }): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const retryable = isRetryable(err)
      if (attempt === MAX_ATTEMPTS || !retryable) throw err
      const delay = Math.pow(3, attempt - 1) * BASE_DELAY_MS + Math.floor(Math.random() * 400)
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[ai] ${opts.label} attempt ${attempt}/${MAX_ATTEMPTS} transient failure, retrying in ${delay}ms — ${msg.slice(0, 160)}`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
}

function isRetryable(err: unknown): boolean {
  if (!err) return false

  // Anthropic SDK errors expose a status property on its APIError class.
  const status = (err as { status?: number }).status
  if (typeof status === 'number') {
    return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
  }

  // Google SDK throws Error whose .message often contains the raw JSON body.
  const message = err instanceof Error ? err.message : String(err)
  if (/"code":\s*(408|429|500|502|503|504)\b/.test(message)) return true
  if (/\b(UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL|DEADLINE_EXCEEDED)\b/i.test(message)) return true

  // Network / fetch transient errors.
  if (/ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|socket hang up/i.test(message)) return true

  return false
}

async function callAnthropic(apiKey: string, model: string, req: GenerateRequest) {
  // Disable the SDK's built-in retries so our retry policy is the only one in effect.
  // Otherwise both layers retry independently (default SDK does 2 retries), causing 6+ attempts.
  const client = new Anthropic({ apiKey, maxRetries: 0 })
  const msg = await client.messages.create({
    model,
    max_tokens: req.maxTokens ?? 4096,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
  })
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  return {
    text,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
  }
}

async function callGoogle(apiKey: string, model: string, req: GenerateRequest) {
  const ai = new GoogleGenAI({ apiKey })
  // All our tasks expect a JSON response. Forcing application/json on Gemini means:
  //   1. Model outputs raw JSON (no markdown fences)
  //   2. Response is guaranteed parseable JSON (or the API errors)
  //   3. No tokens wasted on prose preamble
  const response = await ai.models.generateContent({
    model,
    contents: req.user,
    config: {
      systemInstruction: req.system,
      maxOutputTokens: req.maxTokens ?? 4096,
      responseMimeType: 'application/json',
      // Gemini 2.5 models are "thinking" models: by default they spend the output-token budget
      // on internal reasoning, which silently truncated/emptied our JSON responses. Our tasks are
      // extraction/formatting, not open reasoning, so disable thinking for reliable, complete JSON.
      thinkingConfig: { thinkingBudget: 0 },
    },
  })
  return {
    text: response.text ?? '',
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
  }
}

async function logRun(
  req: GenerateRequest,
  provider: AiProvider,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  status: 'success' | 'error',
  error: string | null,
): Promise<string> {
  const supabase = createSupabaseServiceClient()
  const { data, error: insertErr } = await supabase
    .from('ai_runs')
    .insert({
      user_id: req.userId,
      task: req.task,
      provider,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
      triggered_by_scrape_run_id: req.scrapeRunId ?? null,
      status,
      error,
    })
    .select('id')
    .single()
  if (insertErr || !data) {
    // Logging failure shouldn't break the AI call result for the caller.
    console.error('ai_runs insert failed', insertErr)
    return ''
  }
  return data.id
}
