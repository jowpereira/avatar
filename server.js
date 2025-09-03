// Backend com LangChain (não exponha a API Key no frontend)
// Execução: node server.js
// Env: defina OPENAI_API_KEY

import express from 'express'
import path from 'path'
import bodyParser from 'body-parser'
import { fileURLToPath } from 'url'
import { ChatOpenAI } from '@langchain/openai'
import { StateGraph, START, END } from '@langchain/langgraph'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

app.use(bodyParser.json())
app.use(express.static(path.join(__dirname)))

const llm = new ChatOpenAI({
  model: 'gpt-5-nano',
  temperature: 0.6,
  maxTokens: 256,
  // OPENAI_API_KEY é lido automaticamente de process.env.OPENAI_API_KEY
})

app.post('/api/generate', async (req, res) => {
  try {
    const { message } = req.body || {}
    if (!message || typeof message !== 'string') {
      return res.status(400).send('message is required')
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).send('Server missing OPENAI_API_KEY')
    }

    const system = 'Você é um assistente amigável que responde em português do Brasil.'
    const user = message

    const aiMsg = await llm.invoke([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ])

    const text = typeof aiMsg?.content === 'string'
      ? aiMsg.content
      : Array.isArray(aiMsg?.content)
        ? aiMsg.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join(' ')
        : ''

    res.json({ text: text || 'Desculpe, não consegui gerar uma resposta agora.' })
  } catch (err) {
    console.error(err)
    res.status(500).send('Internal error')
  }
})

// LangGraph: simple stateful chat graph
const graphModel = new ChatOpenAI({ model: 'gpt-5-nano', temperature: 0.6, maxTokens: 256 })

// Define a minimal state: messages array (use reducer/default per docs)
const graph = new StateGraph({
  channels: {
    messages: {
      reducer: (currentState, updateValue) => (currentState || []).concat(updateValue || []),
      default: () => [],
    },
  },
})
  .addNode('llm', async (state) => {
    const msgs = state.messages || []
    const result = await graphModel.invoke(msgs)
    return { messages: [result] }
  })
  .addEdge(START, 'llm')
  .addEdge('llm', END)
  .compile()

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body || {}
    if (!message || typeof message !== 'string') {
      return res.status(400).send('message is required')
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).send('Server missing OPENAI_API_KEY')
    }

    const inputs = { messages: [{ role: 'system', content: 'Você é um assistente amigável em português.' }, { role: 'user', content: message }] }
    const out = await graph.invoke(inputs)
    const last = out?.messages?.[out.messages.length - 1]
    const text = typeof last?.content === 'string' ? last.content : Array.isArray(last?.content) ? last.content.map(p => (typeof p === 'string' ? p : p?.text || '')).join(' ') : ''
    res.json({ text: text || 'Desculpe, não consegui gerar uma resposta agora.' })
  } catch (err) {
    console.error(err)
    res.status(500).send('Internal error')
  }
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
