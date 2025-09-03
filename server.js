// Backend com LangChain (não exponha a API Key no frontend)
// Execução: node server.js
// Env: defina OPENAI_API_KEY

import express from 'express'
import path from 'path'
import bodyParser from 'body-parser'
import { fileURLToPath } from 'url'
import { ChatOpenAI } from '@langchain/openai'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

app.use(bodyParser.json())
app.use(express.static(path.join(__dirname)))

const llm = new ChatOpenAI({
  model: 'gpt-4o-mini',
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
