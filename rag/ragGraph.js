// LangGraph RAG with checkpoint memory saver
import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph'
import { createLLM } from '../config/llm.js'
import { searchTopN } from './searchClient.js'
import { buildSystemPrompt, buildUserPrompt } from './prompt.js'

const checkpointer = new MemorySaver()

// use shared createLLM()

// Graph state: messages (array) + lastRetrieved (array of minimal source info)
const builder = new StateGraph({
  channels: {
    messages: { reducer: (cur, upd) => (cur || []).concat(upd || []), default: () => [] },
    lastRetrieved: { reducer: (_cur, upd) => upd, default: () => [] }
  }
})

builder.addNode('rag', async (state) => {
  const msgs = state.messages || []
  // Find last user message text
  const reversed = [...msgs].reverse()
  const lastUser = reversed.find(m => (m?.role || m?._getType) === 'user')
  const question = typeof lastUser?.content === 'string'
    ? lastUser.content
    : Array.isArray(lastUser?.content)
      ? lastUser.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join(' ')
      : ''

  // Retrieve docs for the last user question
  const docs = await searchTopN(question, { top: 5, select: ['id','title','content','text','chunk','url'] })
  const system = buildSystemPrompt()
  const userPrompt = buildUserPrompt(question, docs)

  // Build conversational context: include prior messages but replace the last user content with enriched prompt
  const prior = msgs.slice(0, Math.max(0, msgs.length - 1))
  const llmMessages = [
    { role: 'system', content: system },
    ...prior,
    { role: 'user', content: userPrompt }
  ]

  const llm = createLLM()
  const result = await llm.invoke(llmMessages)
  const assistantText = typeof result?.content === 'string'
    ? result.content
    : Array.isArray(result?.content)
      ? result.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join(' ')
      : ''

  // Minimal sources for UI
  const minimalSources = (docs || []).map(d => {
    const doc = d.document || {}
    return {
      score: d.score,
      document: {
        id: doc.id || doc.key || undefined,
        title: doc.title || doc.name || undefined,
        url: doc.url || undefined
      }
    }
  })

  return {
    messages: [ { role: 'assistant', content: assistantText } ],
    lastRetrieved: minimalSources
  }
})

builder.addEdge(START, 'rag')
builder.addEdge('rag', END)

const app = builder.compile({ checkpointer })

export async function invokeRagWithMemory(threadId, userMessage) {
  if (!userMessage || typeof userMessage !== 'string') {
    throw new Error('message is required')
  }
  const config = { configurable: { thread_id: String(threadId || 'default') } }
  const out = await app.invoke({ messages: [{ role: 'user', content: userMessage }] }, config)
  // Get last assistant message
  const last = out?.messages?.[out.messages.length - 1]
  const text = typeof last?.content === 'string' ? last.content : Array.isArray(last?.content) ? last.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join(' ') : ''
  return { text, sources: out?.lastRetrieved || [] }
}
