// Shared LLM configuration and factory
import { ChatOpenAI } from '@langchain/openai'

function parseNumber(val, def) {
  const n = Number(val)
  return Number.isFinite(n) ? n : def
}

export function getLLMOptions() {
  const openAIApiKey = process.env.OPENAI_API_KEY
  const model = process.env.LLM_MODEL || 'gpt-4o-mini'
  const temperature = parseNumber(process.env.LLM_TEMPERATURE, 0.5)
  const maxTokens = parseNumber(process.env.LLM_MAX_TOKENS, 400)
  return { openAIApiKey, model, temperature, maxTokens }
}

export function createLLM(overrides = {}) {
  const base = getLLMOptions()
  if (!base.openAIApiKey) throw new Error('Server missing OPENAI_API_KEY')
  const opts = { ...base, ...overrides }
  return new ChatOpenAI({
    model: opts.model,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    openAIApiKey: opts.openAIApiKey
  })
}
