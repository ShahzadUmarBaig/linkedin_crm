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
    if (provider === 'anthropic') {
      const result = await callAnthropic(apiKey, model, req)
      text = result.text
      inputTokens = result.inputTokens
      outputTokens = result.outputTokens
    } else {
      const result = await callGoogle(apiKey, model, req)
      text = result.text
      inputTokens = result.inputTokens
      outputTokens = result.outputTokens
    }
  } catch (err) {
    await logRun(req, provider, model, 0, 0, 0, 'error', err instanceof Error ? err.message : String(err))
    throw err
  }

  const costUsd = computeCostUsd(model, inputTokens, outputTokens)
  const aiRunId = await logRun(req, provider, model, inputTokens, outputTokens, costUsd, 'success', null)

  return { text, provider, model, inputTokens, outputTokens, costUsd, aiRunId }
}

async function callAnthropic(apiKey: string, model: string, req: GenerateRequest) {
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model,
    max_tokens: req.maxTokens ?? 2048,
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
  const response = await ai.models.generateContent({
    model,
    contents: req.user,
    config: {
      systemInstruction: req.system,
      maxOutputTokens: req.maxTokens ?? 2048,
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
