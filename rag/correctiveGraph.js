// Corrective RAG (cRAG) with MemorySaver
import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph'
import { createLLM } from '../config/llm.js'
import { searchTopN } from './searchClient.js'
import { buildSystemPrompt, buildUserPrompt } from './prompt.js'

const checkpointer = new MemorySaver()

function createGraderLLM() { return createLLM({ temperature: 0.2, maxTokens: 300 }) }

async function gradeGroundedness(question, draftAnswer, docs) {
  const context = (docs || []).map((d, i) => {
    const doc = d.document || {}
    const title = doc.title || doc.name || doc.id || `Fonte ${i+1}`
    const content = doc.content || doc.text || doc.chunk || ''
    return `Fonte ${i+1}: ${title}\n${String(content).slice(0, 1200)}`
  }).join('\n\n')
  const grader = createGraderLLM()
  const prompt = [
    'Você é um verificador de fundamentação. Analise se a resposta está bem fundamentada no contexto fornecido.',
    'Responda APENAS em JSON com o seguinte formato:',
    '{"grounded": true|false, "needs_more_context": true|false, "queries": ["..."]}',
    `Pergunta: ${question}`,
    `Resposta: ${draftAnswer}`,
    `Contexto:\n${context || '[vazio]'}`
  ].join('\n\n')
  const result = await grader.invoke([{ role: 'user', content: prompt }])
  const text = typeof result?.content === 'string' ? result.content : Array.isArray(result?.content) ? result.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join(' ') : ''
  try {
    const parsed = JSON.parse(text)
    return { grounded: !!parsed.grounded, needs: !!parsed.needs_more_context, queries: Array.isArray(parsed.queries) ? parsed.queries.slice(0, 3) : [] }
  } catch {
    // Fallback heuristic
    const grounded = /"grounded"\s*:\s*true/i.test(text)
    const needs = /needs_more_context\s*:\s*true/i.test(text)
    return { grounded, needs, queries: [] }
  }
}

function dedupeDocs(list) {
  const seen = new Set()
  const out = []
  for (const d of list) {
    const id = d?.document?.id || d?.document?.key || d?.document?.['@search.action'] || JSON.stringify(d.document).slice(0,80)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(d)
  }
  return out
}

const builder = new StateGraph({
  channels: {
    messages: { reducer: (cur, upd) => (cur || []).concat(upd || []), default: () => [] },
    lastRetrieved: { reducer: (_cur, upd) => upd, default: () => [] }
  }
})

builder.addNode('crag', async (state) => {
  const msgs = state.messages || []
  const lastUser = [...msgs].reverse().find(m => (m?.role || m?._getType) === 'user')
  const question = typeof lastUser?.content === 'string'
    ? lastUser.content
    : Array.isArray(lastUser?.content)
      ? lastUser.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join(' ')
      : ''

  // First pass retrieval
  let docs = await searchTopN(question, { top: 5, select: ['id','title','content','text','chunk','url'] })
  const system = buildSystemPrompt()
  const user1 = buildUserPrompt(question, docs)
  const llm = createLLM(0.5, 500)
  const draft = await llm.invoke([
    { role: 'system', content: system },
    { role: 'user', content: user1 }
  ])
  const draftText = typeof draft?.content === 'string' ? draft.content : Array.isArray(draft?.content) ? draft.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join(' ') : ''

  const eval1 = await gradeGroundedness(question, draftText, docs)
  if (!eval1.needs && eval1.grounded) {
    const minimalSources = (docs || []).map(d => ({ score: d.score, document: { id: d.document?.id, title: d.document?.title, url: d.document?.url } }))
    return { messages: [{ role: 'assistant', content: draftText }], lastRetrieved: minimalSources }
  }

  // Corrective step: expand queries and retrieve more
  const queries = eval1.queries && eval1.queries.length ? eval1.queries : [ `explique melhor: ${question}`, `${question} detalhes técnicos`, `${question} exemplos práticos` ]
  let moreDocs = []
  for (const q of queries) {
    try {
      const r = await searchTopN(q, { top: 5, select: ['id','title','content','text','chunk','url'] })
      moreDocs = moreDocs.concat(r || [])
    } catch {}
  }
  const merged = dedupeDocs([...(docs || []), ...moreDocs])

  const user2 = buildUserPrompt(question, merged)
  const finalAns = await llm.invoke([
    { role: 'system', content: system },
    { role: 'user', content: user2 }
  ])
  const finalText = typeof finalAns?.content === 'string' ? finalAns.content : Array.isArray(finalAns?.content) ? finalAns.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join(' ') : ''
  const minimalSources = (merged || []).slice(0, 10).map(d => ({ score: d.score, document: { id: d.document?.id, title: d.document?.title, url: d.document?.url } }))
  return { messages: [{ role: 'assistant', content: finalText }], lastRetrieved: minimalSources }
})

builder.addEdge(START, 'crag')
builder.addEdge('crag', END)

const app = builder.compile({ checkpointer })

export async function invokeCorrectiveRagWithMemory(threadId, userMessage) {
  if (!userMessage || typeof userMessage !== 'string') {
    throw new Error('message is required')
  }
  const config = { configurable: { thread_id: String(threadId || 'default') } }
  const out = await app.invoke({ messages: [{ role: 'user', content: userMessage }] }, config)
  const last = out?.messages?.[out.messages.length - 1]
  const text = typeof last?.content === 'string' ? last.content : Array.isArray(last?.content) ? last.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join(' ') : ''
  return { text, sources: out?.lastRetrieved || [] }
}
