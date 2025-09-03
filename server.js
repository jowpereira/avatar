// Backend com LangChain (não exponha a API Key no frontend)
// Execução: node server.js
// Env: defina OPENAI_API_KEY

import express from 'express'
import path from 'path'
import bodyParser from 'body-parser'
import { fileURLToPath } from 'url'
import { ChatOpenAI } from '@langchain/openai'
import { StateGraph, START, END } from '@langchain/langgraph'
import dotenv from 'dotenv'
import fs from 'fs'

// Load environment variables
dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

app.use(bodyParser.json())
app.use(express.static(path.join(__dirname)))

// Load course content
let courseContent = []
try {
  const courseData = fs.readFileSync(path.join(__dirname, 'course.json'), 'utf8')
  courseContent = JSON.parse(courseData)
} catch (err) {
  console.warn('Course content not found, using empty array')
}

const llm = new ChatOpenAI({
  model: 'gpt-4o-mini', // Changed to available model
  temperature: 0.6,
  maxTokens: 256,
  openAIApiKey: process.env.OPENAI_API_KEY || 'your-openai-api-key-here'
})

// Teaching mode LLM with higher token limit for lessons
const teachingLLM = new ChatOpenAI({
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 512,
  openAIApiKey: process.env.OPENAI_API_KEY || 'your-openai-api-key-here'
})

// Global teaching state
let teachingState = {
  currentTopicIndex: 0,
  currentSubtaskIndex: 0,
  isTeaching: false,
  pendingQuestions: []
}

app.post('/api/generate', async (req, res) => {
  try {
    const { message } = req.body || {}
    if (!message || typeof message !== 'string') {
      return res.status(400).send('message is required')
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).send('Server missing OPENAI_API_KEY')
    }

    // Delegate to LangGraph chat flow for compatibility on this path
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

// ============ NEW TEACHING ENDPOINTS ============

// Get course structure
app.get('/api/course', (req, res) => {
  res.json(courseContent)
})

// Get current teaching state
app.get('/api/teaching/state', (req, res) => {
  res.json(teachingState)
})

// Start teaching session
app.post('/api/teaching/start', (req, res) => {
  teachingState.isTeaching = true
  teachingState.currentTopicIndex = 0
  teachingState.currentSubtaskIndex = 0
  teachingState.pendingQuestions = []
  res.json({ success: true, state: teachingState })
})

// Stop teaching session
app.post('/api/teaching/stop', (req, res) => {
  teachingState.isTeaching = false
  res.json({ success: true, state: teachingState })
})

// Generate lesson content for current subtask
app.post('/api/teaching/lesson', async (req, res) => {
  try {
    if (!teachingState.isTeaching) {
      return res.status(400).json({ error: 'Teaching session not active' })
    }

    const currentTopic = courseContent[teachingState.currentTopicIndex]
    const currentSubtask = currentTopic?.subtasks[teachingState.currentSubtaskIndex]
    
    if (!currentTopic || !currentSubtask) {
      return res.status(400).json({ error: 'No more content available' })
    }

    const prompt = `Como instrutor especialista em Machine Learning e IA, explique de forma didática o tópico "${currentSubtask.title}" dentro do contexto de "${currentTopic.title}". 

Contexto: ${currentTopic.description}

Forneça uma explicação clara, objetiva e educativa em português, com exemplos práticos quando possível. Mantenha o tom professoral e amigável, adequado para um avatar educacional.`

    const response = await teachingLLM.invoke([{ role: 'user', content: prompt }])
    const lessonText = response.content

    res.json({
      success: true,
      lesson: {
        topicTitle: currentTopic.title,
        subtaskTitle: currentSubtask.title,
        content: lessonText,
        progress: {
          topicIndex: teachingState.currentTopicIndex,
          subtaskIndex: teachingState.currentSubtaskIndex,
          totalTopics: courseContent.length,
          totalSubtasks: currentTopic.subtasks.length
        }
      }
    })
  } catch (err) {
    console.error('Teaching lesson error:', err)
    res.status(500).json({ error: 'Failed to generate lesson' })
  }
})

// Move to next subtask/topic
app.post('/api/teaching/next', (req, res) => {
  if (!teachingState.isTeaching) {
    return res.status(400).json({ error: 'Teaching session not active' })
  }

  const currentTopic = courseContent[teachingState.currentTopicIndex]
  
  if (teachingState.currentSubtaskIndex < currentTopic.subtasks.length - 1) {
    // Next subtask in current topic
    teachingState.currentSubtaskIndex++
  } else if (teachingState.currentTopicIndex < courseContent.length - 1) {
    // Next topic
    teachingState.currentTopicIndex++
    teachingState.currentSubtaskIndex = 0
  } else {
    // Course finished
    teachingState.isTeaching = false
    return res.json({ success: true, finished: true, state: teachingState })
  }

  res.json({ success: true, state: teachingState })
})

// Handle questions during teaching
app.post('/api/teaching/question', async (req, res) => {
  try {
    const { message, immediate = false } = req.body || {}
    
    if (!message || typeof message !== 'string') {
      return res.status(400).send('message is required')
    }

    if (immediate) {
      // Answer immediately using course context
      const currentTopic = courseContent[teachingState.currentTopicIndex]
      const contextPrompt = `Como instrutor especialista, responda a seguinte pergunta do aluno sobre o tópico "${currentTopic?.title || 'Machine Learning'}":

Pergunta: ${message}

Contexto do curso: ${currentTopic?.description || 'Curso de Machine Learning e IA'}

Forneça uma resposta educativa, clara e direta em português.`

      const response = await teachingLLM.invoke([{ role: 'user', content: contextPrompt }])
      
      res.json({
        success: true,
        answer: response.content,
        type: 'immediate'
      })
    } else {
      // Queue for later
      teachingState.pendingQuestions.push({
        question: message,
        timestamp: new Date().toISOString(),
        topic: courseContent[teachingState.currentTopicIndex]?.title || 'Unknown'
      })
      
      res.json({
        success: true,
        message: 'Pergunta adicionada à fila. Será respondida no final da sessão.',
        type: 'queued'
      })
    }
  } catch (err) {
    console.error('Teaching question error:', err)
    res.status(500).json({ error: 'Failed to process question' })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
