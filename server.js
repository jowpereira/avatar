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
import { readFileSync } from 'fs'

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
app.post('/api/teaching/question', async (req, res) => {
  try {
    const { message } = req.body || {}
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' })
    }

    if (!teachingState.isTeaching) {
      return res.status(400).json({ error: 'Teaching session not active' })
    }

    // AI Judge to decide what to do with the question
    const currentTopic = courseContent[teachingState.currentTopicIndex]
    const judgePrompt = `Como um assistente especializado, analise esta pergunta de um aluno durante uma aula sobre "${currentTopic.title}":

Pergunta: "${message}"

Contexto da aula: ${currentTopic.description}

Classifique a pergunta em uma destas categorias:
- ANSWER_NOW: Pergunta relevante e simples que deve ser respondida imediatamente
- QUEUE_IMPORTANT: Pergunta muito importante/complexa que deve ser guardada para o final da sessão
- IGNORE: Pergunta irrelevante, fora de contexto ou inadequada

Responda APENAS com uma das três palavras: ANSWER_NOW, QUEUE_IMPORTANT, ou IGNORE`

    const judgeResponse = await teachingLLM.invoke([{ role: 'user', content: judgePrompt }])
    const decision = judgeResponse.content.trim().toUpperCase()

    console.log(`Question decision: ${decision} for "${message}"`)

    if (decision === 'IGNORE') {
      return res.json({
        success: true,
        message: '🤖 Essa pergunta não está relacionada ao conteúdo atual.',
        type: 'ignored'
      })
    }
    
    if (decision === 'ANSWER_NOW') {
      const contextPrompt = `Como instrutor especialista, responda de forma concisa a seguinte pergunta do aluno sobre o tópico "${currentTopic.title}":

Pergunta: ${message}

Contexto do curso: ${currentTopic.description}

Forneça uma resposta educativa, clara e direta em português, máximo 2 parágrafos.`

      const response = await teachingLLM.invoke([{ role: 'user', content: contextPrompt }])
      
      return res.json({
        success: true,
        answer: response.content,
        type: 'immediate'
      })
    }
    
    if (decision === 'QUEUE_IMPORTANT') {
      teachingState.pendingQuestions.push({
        question: message,
        timestamp: new Date().toISOString(),
        topic: currentTopic.title
      })
      
      return res.json({
        success: true,
        message: '📋 Excelente pergunta! Será respondida com detalhes no final da sessão.',
        type: 'queued'
      })
    }

    // If judge returned unexpected decision, throw error
    throw new Error(`Invalid judge decision: ${decision}`)

  } catch (err) {
    console.error('Teaching question error:', err)
    res.status(500).json({ error: 'Failed to process question: ' + err.message })
  }
})

// Answer pending questions at end of session
app.post('/api/teaching/answer-pending', async (req, res) => {
  try {
    if (!teachingState.pendingQuestions || teachingState.pendingQuestions.length === 0) {
      return res.json({ success: true, message: 'Nenhuma pergunta pendente.', answers: [] })
    }

    const answers = []
    for (const pendingQ of teachingState.pendingQuestions) {
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

    // Clear pending questions
    teachingState.pendingQuestions = []

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
