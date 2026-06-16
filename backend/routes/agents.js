/**
 * Agent routes:
 *   GET  /api/agents           — list all registered agents
 *   POST /api/agents/:id/chat  — send a message to an agent, get text + audio back
 *   POST /api/agents/interject — check if any in-meeting agent wants to interject
 */

import { Router } from 'express'
import { registry } from '../index.js'
import { getAgentResponse, checkInterjections } from '../lib/claude.js'
import { synthesize } from '../lib/tts.js'

const router = Router()

// GET /api/agents — return all agent profiles (minus the system prompts)
router.get('/', (req, res) => {
  const agents = Object.values(registry).map(({ systemPrompt, voiceSettings, ...pub }) => pub)
  res.json({ agents })
})

// POST /api/agents/:id/chat
router.post('/:id/chat', async (req, res) => {
  const { id } = req.params
  const { transcript, conversationHistory = [] } = req.body

  if (!registry[id]) return res.status(404).json({ error: `Agent "${id}" not found` })
  if (!transcript?.trim()) return res.status(400).json({ error: 'No transcript provided' })

  try {
    const agent = registry[id]

    // 1. Get Claude response (with tool use if needed)
    const text = await getAgentResponse({ agentId: id, transcript, conversationHistory })

    // 2. Synthesize voice
    let audioBase64 = null
    try {
      const audioBuf = await synthesize({
        text,
        voiceId: agent.voiceId,
        voiceSettings: agent.voiceSettings,
      })
      audioBase64 = audioBuf.toString('base64')
    } catch (err) {
      console.warn(`⚠️  TTS failed for ${id} (voice: ${agent.voiceId}):`, err.message)
      // Non-fatal — return text without audio
    }

    res.json({
      agentId: id,
      text,
      audio: audioBase64, // base64 mp3, null if TTS failed
      audioMime: 'audio/mpeg',
    })
  } catch (err) {
    console.error(`Error in /${id}/chat:`, err)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/agents/interject
// Body: { excludeAgentId, inMeetingAgentIds, lastExchange }
router.post('/interject', async (req, res) => {
  const { excludeAgentId, inMeetingAgentIds = [], lastExchange } = req.body

  try {
    const interjections = await checkInterjections({
      excludeAgentId,
      inMeetingAgentIds,
      lastExchange,
    })

    // Synthesize audio for each interjection
    const withAudio = await Promise.all(
      interjections.map(async ({ agentId, text }) => {
        const agent = registry[agentId]
        let audioBase64 = null
        try {
          const buf = await synthesize({ text, voiceId: agent.voiceId, voiceSettings: agent.voiceSettings })
          audioBase64 = buf.toString('base64')
        } catch {}
        return { agentId, text, audio: audioBase64 }
      })
    )

    res.json({ interjections: withAudio })
  } catch (err) {
    console.error('Interjection check failed:', err)
    res.json({ interjections: [] }) // graceful fail
  }
})

export default router
