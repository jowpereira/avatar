// Centralized system prompt builder for RAG Chat
export function buildSystemPrompt() {
  return [
    'Você é um assistente em português. Responda de forma clara, objetiva e útil.',
    'Seja fiel às fontes recuperadas; se não souber, diga que não encontrou nas referências.',
    'Mostre cautela com suposições e especifique limitações quando necessárias.'
  ].join(' ')
}

export function buildUserPrompt(userQuestion, docs) {
  const context = (docs || []).map((d, i) => `Fonte ${i + 1} (score=${d.score?.toFixed?.(2) ?? ''}):\n${summarizeDocument(d.document)}`).join('\n\n')
  return [
    `Pergunta do usuário: ${userQuestion}`,
    'Contexto recuperado:\n' + (context || '[sem resultados relevantes]'),
    'Responda somente com base no contexto quando possível.'
  ].join('\n\n')
}

function summarizeDocument(doc) {
  if (!doc) return ''
  // Try common fields; customize as needed per your index schema
  const title = doc.title || doc.name || doc.id || ''
  const content = doc.content || doc.text || doc.chunk || JSON.stringify(doc)
  // Limit content length for prompt
  const trimmed = String(content).slice(0, 1500)
  return [title, trimmed].filter(Boolean).join('\n')
}
