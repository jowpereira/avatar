// RAG chat pipeline using Azure AI Search + LLM
import { searchTopN } from './searchClient.js'
import { buildSystemPrompt, buildUserPrompt } from './prompt.js'
import { createLLM } from '../config/llm.js'

export async function ragAnswer(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') {
    throw new Error('message is required')
  }

  // 1) Retrieve relevant docs from Azure AI Search
  const docs = await searchTopN(userMessage, { top: 5, select: ['id','title','content','text','chunk','url'] })

  // 2) Build prompts
  const system = buildSystemPrompt()
  const user = buildUserPrompt(userMessage, docs)

  // 3) Generate answer with LLM
  const llm = createLLM()

  const result = await llm.invoke([
    { role: 'system', content: system },
    { role: 'user', content: user }
  ])

  const text = typeof result?.content === 'string'
    ? result.content
    : Array.isArray(result?.content)
      ? result.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join(' ')
      : ''

  return { text, retrieved: docs }
}
