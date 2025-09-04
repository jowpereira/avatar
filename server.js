// Backend com LangChain (não exponha a API Key no frontend)
// Execução: node server.js
// Env: defina OPENAI_API_KEY

import express from 'express'
import path from 'path'
import bodyParser from 'body-parser'
import { fileURLToPath } from 'url'
import { ChatOpenAI } from '@langchain/openai'
import { ragAnswer } from './rag/ragChat.js'
import { invokeRagWithMemory } from './rag/ragGraph.js'
import { invokeCorrectiveRagWithMemory } from './rag/correctiveGraph.js'
import { StateGraph, START, END } from '@langchain/langgraph'
import dotenv from 'dotenv'
import { readFileSync } from 'fs'
import crypto from 'crypto'

// Load environment variables
dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

app.use(bodyParser.json())
app.use(express.static(path.join(__dirname)))

// Load course content - moved to global scope
var courseContent = []
try {
  const courseData = readFileSync(path.join(__dirname, 'course.json'), 'utf8')
  courseContent = JSON.parse(courseData)
  console.log(`Loaded ${courseContent.length} course topics`)
} catch (err) {
  console.warn('Course content not found, using empty array:', err.message)
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

// RAG Chat using Azure AI Search + MemorySaver (LangGraph)
app.post('/api/chat', async (req, res) => {
  try {
  const { message, threadId } = req.body || {}
  const result = await invokeRagWithMemory(threadId || 'default', message)
  res.json({ text: result.text, sources: result.sources })
  } catch (err) {
    console.error('RAG chat error:', err)
    res.status(500).json({ error: 'RAG chat error', details: err?.message })
  }
})


// Legacy RAG without memory (for comparison/testing)
app.post('/api/chat-rag-simple', async (req, res) => {
  try {
    const { message } = req.body || {}
    const result = await ragAnswer(message)
    res.json({ text: result.text, sources: result.retrieved })
  } catch (err) {
    console.error('Simple RAG error:', err)
    res.status(500).json({ error: 'Simple RAG error', details: err?.message })
  }
})

// Corrective RAG (cRAG) with memory
app.post('/api/chat-crag', async (req, res) => {
  try {
    const { message, threadId } = req.body || {}
    const result = await invokeCorrectiveRagWithMemory(threadId || 'default', message)
    res.json({ text: result.text, sources: result.sources })
  } catch (err) {
    console.error('Corrective RAG error:', err)
    res.status(500).json({ error: 'Corrective RAG error', details: err?.message })
  }
})

// ============ NEW TEACHING ENDPOINTS ============

// Get course structure
app.get('/api/course', (req, res) => {
  if (!courseContent || courseContent.length === 0) {
    return res.status(500).json({ error: 'Course content not available' })
  }
  console.log('Course request - courseContent length:', courseContent.length)
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
    console.log('Lesson request - teachingState:', teachingState)
    console.log('courseContent available:', !!courseContent)
    console.log('courseContent length:', courseContent?.length || 0)
    
    if (!teachingState.isTeaching) {
      return res.status(400).json({ error: 'Teaching session not active' })
    }

    if (!courseContent || courseContent.length === 0) {
      return res.status(500).json({ error: 'Course content not loaded' })
    }

    const currentTopic = courseContent[teachingState.currentTopicIndex]
    if (!currentTopic) {
      return res.status(400).json({ error: 'Invalid topic index' })
    }

    const currentSubtask = currentTopic.subtasks[teachingState.currentSubtaskIndex]
    if (!currentSubtask) {
      return res.status(400).json({ error: 'Invalid subtask index' })
    }
    
    console.log('Current topic index:', teachingState.currentTopicIndex)
    console.log('Current topic:', currentTopic.title)
    console.log('Current subtask:', currentSubtask.title)

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

  if (!courseContent || courseContent.length === 0) {
    return res.status(500).json({ error: 'Course content not available' })
  }

  const currentTopic = courseContent[teachingState.currentTopicIndex]
  if (!currentTopic) {
    return res.status(400).json({ error: 'Invalid current topic' })
  }
  
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
// Teaching questions are disabled in course mode; endpoint removed

// Answer pending questions at end of session
app.post('/api/teaching/answer-pending', async (req, res) => {
  try {
    const scope = (req.query?.scope || '').toString();
    if (!teachingState.pendingQuestions || teachingState.pendingQuestions.length === 0) {
      return res.json({ success: true, message: 'Nenhuma pergunta pendente.', answers: [] })
    }

    // Optionally filter by current topic
    let pending = teachingState.pendingQuestions
    if (scope === 'currentTopic') {
      const topic = courseContent[teachingState.currentTopicIndex]?.title
      pending = pending.filter(q => q.topic === topic)
      // Remove only the ones answered from the global queue later
    }

    const answers = []
    for (const pendingQ of pending) {
      const answerPrompt = `Como instrutor especialista em Machine Learning, responda de forma detalhada e educativa a seguinte pergunta importante de um aluno:

Pergunta: ${pendingQ.question}
Tópico da aula: ${pendingQ.topic}
Data: ${pendingQ.timestamp}

Forneça uma resposta completa, didática e bem estruturada em português. Use exemplos práticos quando apropriado.`

      const response = await teachingLLM.invoke([{ role: 'user', content: answerPrompt }])
      answers.push({
        question: pendingQ.question,
        answer: response.content,
        topic: pendingQ.topic,
        timestamp: pendingQ.timestamp
      })
    }

    // Clear pending questions (all or only answered ones if scoped)
    if (scope === 'currentTopic') {
      const topic = courseContent[teachingState.currentTopicIndex]?.title
      teachingState.pendingQuestions = teachingState.pendingQuestions.filter(q => q.topic !== topic)
    } else {
      teachingState.pendingQuestions = []
    }

    res.json({
      success: true,
      message: `Respondidas ${answers.length} perguntas pendentes.`,
      answers
    })
  } catch (err) {
    console.error('Answer pending questions error:', err)
    res.status(500).json({ error: 'Failed to answer pending questions: ' + err.message })
  }
})

// ============ Avatar Batch Synthesis (Gestures) ============
// Submit a batch job with SSML; returns operation location to poll
app.post('/api/avatar/batch', async (req, res) => {
  try {
    const SPEECH_KEY = process.env.SPEECH_KEY || process.env.AZURE_SPEECH_KEY || process.env.COG_SPEECH_KEY
    const region = (req.body?.region || process.env.SPEECH_REGION || '').toString()
    if (!SPEECH_KEY) return res.status(500).json({ error: 'Server missing SPEECH_KEY' })
    if (!region) return res.status(400).json({ error: 'region is required (e.g., eastus)' })

    const ssml = (req.body?.ssml || '').toString()
    const character = (req.body?.character || 'lisa').toString()
    const style = (req.body?.style || 'casual-sitting').toString()
    const backgroundColor = (req.body?.backgroundColor || 'white').toString()
    const videoFormat = (req.body?.videoFormat || 'mp4').toString()
    const videoCodec = (req.body?.videoCodec || 'h264').toString()
    const subtitleType = (req.body?.subtitleType || 'soft_embedded').toString()
    const jobId = (req.body?.jobId || ('talking-avatar-batch-' + crypto.randomBytes(4).toString('hex'))).toString()

    if (!ssml) return res.status(400).json({ error: 'ssml is required' })

    const url = `https://${region}.api.cognitive.microsoft.com/avatar/batchsyntheses/${encodeURIComponent(jobId)}?api-version=2024-08-01`
    const payload = {
      inputKind: 'SSML',
      inputs: [{ content: ssml }],
      avatarConfig: {
        talkingAvatarCharacter: character,
        talkingAvatarStyle: style,
        videoFormat,
        videoCodec,
        subtitleType,
        backgroundColor
      }
    }

    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Ocp-Apim-Subscription-Key': SPEECH_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!resp.ok) {
      const t = await resp.text().catch(() => '')
      return res.status(resp.status).json({ error: 'Azure batch submit failed', details: t })
    }
    const opLoc = resp.headers.get('Operation-Location')
    const opId = resp.headers.get('Operation-Id')
    const body = await resp.json().catch(() => ({}))
    res.status(201).json({ success: true, operationLocation: opLoc, operationId: opId, job: body, jobId })
  } catch (err) {
    console.error('Batch submit error:', err)
    res.status(500).json({ error: 'Batch submit error', details: err?.message })
  }
})

// Poll batch operation by Operation-Location URL
app.get('/api/avatar/batch-status', async (req, res) => {
  try {
    const SPEECH_KEY = process.env.SPEECH_KEY || process.env.AZURE_SPEECH_KEY || process.env.COG_SPEECH_KEY
    const opLoc = (req.query?.operationLocation || '').toString()
    if (!SPEECH_KEY) return res.status(500).json({ error: 'Server missing SPEECH_KEY' })
    if (!opLoc) return res.status(400).json({ error: 'operationLocation is required' })

    const resp = await fetch(opLoc, {
      method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': SPEECH_KEY }
    })
    if (!resp.ok) {
      const t = await resp.text().catch(() => '')
      return res.status(resp.status).json({ error: 'Azure status failed', details: t })
    }
    const data = await resp.json()
    // If succeeded, try to extract result URL
    let resultUrl = data?.outputs?.result || null
    res.json({ success: true, status: data?.status, data, resultUrl })
  } catch (err) {
    console.error('Batch status error:', err)
    res.status(500).json({ error: 'Batch status error', details: err?.message })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
