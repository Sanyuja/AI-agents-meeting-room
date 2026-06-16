/**
 * The AI Meeting Room — v2
 *
 * - Agents live in the backend. Frontend fetches the list.
 * - Invite agents into the meeting with one click.
 * - Always-on mic: say an agent's name and they activate instantly.
 * - Agents can interject after each response.
 * - Each response plays in the agent's ElevenLabs voice.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSpeechRecognition } from './hooks/useSpeechRecognition.js'
import { useAudio } from './hooks/useAudio.js'

const API = 'http://localhost:3001'

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [allAgents, setAllAgents] = useState([])        // from backend
  const [inMeeting, setInMeeting] = useState([])        // agent IDs currently in the room
  const [activeAgentId, setActiveAgentId] = useState(null) // who was just addressed
  const [conversation, setConversation] = useState([])  // { role, agentId, text, ts }
  const [interimText, setInterimText] = useState('')    // what the mic is hearing right now
  const [processingAgentId, setProcessingAgentId] = useState(null)
  const [listeningEnabled, setListeningEnabled] = useState(true)
  const [textInput, setTextInput] = useState('')
  const convHistoryRef = useRef(new Map())               // agentId → [{role, content}]
  const { play, isPlaying } = useAudio()
  const feedRef = useRef(null)

  // ── Fetch agents from backend ──
  useEffect(() => {
    fetch(`${API}/api/agents`)
      .then((r) => r.json())
      .then(({ agents }) => {
        setAllAgents(agents)
        // Alfred is always in the meeting by default
        setInMeeting(['alfred'])
      })
      .catch(() => {
        // Fallback if backend not running yet
        setAllAgents([
          { id: 'alfred', name: 'Alfred', emoji: '🎩', role: 'Tech & Ops', color: '#4f8ef7', catchphrase: 'Consider it done.' },
          { id: 'miss-behave', name: 'Miss Behave', emoji: '👑', role: 'Brand & Content', color: '#f764b0', catchphrase: 'Darling, make it iconic.' },
        ])
        setInMeeting(['alfred'])
      })
  }, [])

  // ── Send utterance to the right agent ──
  const handleUtterance = useCallback(async (text) => {
    if (!text.trim() || processingAgentId) return
    setInterimText('')

    // Determine target: named agent, or last active, or first in meeting (Alfred)
    const targetId = activeAgentId ?? inMeeting[0]
    if (!targetId) return

    // Add user message to conversation
    const userMsg = { role: 'user', text, ts: new Date() }
    setConversation((prev) => [...prev, userMsg])

    const agentHistory = convHistoryRef.current.get(targetId) ?? []
    const updatedHistory = [...agentHistory, { role: 'user', content: text }]
    convHistoryRef.current.set(targetId, updatedHistory)

    setProcessingAgentId(targetId)
    setListeningEnabled(false) // pause mic while agent is speaking

    try {
      const res = await fetch(`${API}/api/agents/${targetId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: text,
          conversationHistory: updatedHistory.slice(-10), // last 10 turns
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const agentMsg = { role: 'agent', agentId: targetId, text: data.text, ts: new Date() }
      setConversation((prev) => [...prev, agentMsg])
      convHistoryRef.current.set(targetId, [
        ...updatedHistory,
        { role: 'assistant', content: data.text },
      ])

      // Play the agent's voice
      if (data.audio) {
        await play(data.audio, data.audioMime)
      }

      // After agent finishes speaking, check for interjections
      await checkInterjections(targetId, text, data.text)

    } catch (err) {
      console.error('Agent response failed:', err)
      setConversation((prev) => [
        ...prev,
        { role: 'error', text: err.message, ts: new Date() },
      ])
    } finally {
      setProcessingAgentId(null)
      setActiveAgentId(null)
      setListeningEnabled(true)
    }
  }, [activeAgentId, inMeeting, processingAgentId, play])

  // ── Interjection check ──
  const checkInterjections = async (respondedAgentId, userSaid, agentSaid) => {
    if (inMeeting.length <= 1) return
    try {
      const res = await fetch(`${API}/api/agents/interject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          excludeAgentId: respondedAgentId,
          inMeetingAgentIds: inMeeting,
          lastExchange: `Sanyuja: "${userSaid}"\n${respondedAgentId}: "${agentSaid}"`,
        }),
      })
      const { interjections } = await res.json()
      for (const inj of interjections) {
        setConversation((prev) => [
          ...prev,
          { role: 'agent', agentId: inj.agentId, text: inj.text, ts: new Date(), isInterjection: true },
        ])
        if (inj.audio) await play(inj.audio)
        await new Promise((r) => setTimeout(r, 500)) // small gap between voices
      }
    } catch {}
  }

  // ── Name detection from always-on mic ──
  const handleNameDetected = useCallback((agentId) => {
    if (inMeeting.includes(agentId)) {
      setActiveAgentId(agentId)
    }
  }, [inMeeting])

  const { isListening, error: micError } = useSpeechRecognition({
    onUtterance: handleUtterance,
    onNameDetected: handleNameDetected,
    onInterim: setInterimText,
    enabled: listeningEnabled,
    agents: allAgents,
  })

  // ── Invite / remove agent ──
  const toggleInMeeting = (agentId) => {
    setInMeeting((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId]
    )
  }

  // ── Auto-scroll feed ──
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [conversation])

  const agentMap = Object.fromEntries(allAgents.map((a) => [a.id, a]))

  return (
    <div style={s.page}>

      {/* ── Sidebar: Available agents ── */}
      <aside style={s.sidebar}>
        <p style={s.sidebarLabel}>Team</p>
        {allAgents.map((agent) => {
          const active = inMeeting.includes(agent.id)
          return (
            <div key={agent.id} style={{ ...s.agentRow, borderColor: active ? agent.color : '#2a2a3a' }}>
              <span style={s.agentEmoji}>{agent.emoji}</span>
              <div style={s.agentInfo}>
                <span style={{ ...s.agentName, color: active ? agent.color : '#e8e8f0' }}>{agent.name}</span>
                <span style={s.agentRole}>{agent.role}</span>
              </div>
              <button
                onClick={() => toggleInMeeting(agent.id)}
                style={{ ...s.inviteBtn, background: active ? '#1e2a1e' : '#1a1a27', color: active ? '#22c55e' : '#6b6b85', borderColor: active ? '#22c55e33' : '#2a2a3a' }}
              >
                {active ? 'In room' : 'Invite'}
              </button>
            </div>
          )
        })}

        <div style={s.sidebarDivider} />
        <p style={s.sidebarHint}>
          To add a new agent, create their profile in <code style={s.code}>backend/agents/</code> and register in <code style={s.code}>index.js</code>.
        </p>
      </aside>

      {/* ── Main meeting room ── */}
      <main style={s.main}>

        {/* Header */}
        <header style={s.header}>
          <div style={s.headerLeft}>
            <h1 style={s.title}>🎙️ The AI Meeting Room</h1>
            <div style={s.inRoomPills}>
              {inMeeting.map((id) => {
                const a = agentMap[id]
                if (!a) return null
                const isActive = processingAgentId === id
                return (
                  <span key={id} style={{ ...s.pill, borderColor: isActive ? a.color : '#2a2a3a', color: isActive ? a.color : '#888', boxShadow: isActive ? `0 0 12px ${a.color}44` : 'none' }}>
                    {a.emoji} {a.name}
                    {isActive && <PulsingDot />}
                  </span>
                )
              })}
            </div>
          </div>

          {/* Mic status */}
          <div style={s.micStatus}>
            <div style={{ ...s.micDot, background: isListening ? '#22c55e' : '#ef4444', boxShadow: isListening ? '0 0 8px #22c55e88' : 'none' }} />
            <span style={s.micLabel}>{isListening ? 'Listening' : 'Mic off'}</span>
          </div>
        </header>

        {/* Interim text — what mic is hearing right now */}
        {interimText && (
          <div style={s.interim}>
            <span style={s.interimText}>"{interimText}"</span>
            {activeAgentId && agentMap[activeAgentId] && (
              <span style={{ ...s.interimTarget, color: agentMap[activeAgentId].color }}>
                → {agentMap[activeAgentId].name}
              </span>
            )}
          </div>
        )}

        {/* Conversation feed */}
        <div ref={feedRef} style={s.feed}>
          {conversation.length === 0 && (
            <div style={s.emptyState}>
              <p style={s.emptyTitle}>The room is ready.</p>
              <p style={s.emptyHint}>Say <strong>"Alfred"</strong> to address your right hand, or just start talking — he's listening.</p>
            </div>
          )}

          {conversation.map((msg, i) => {
            if (msg.role === 'user') {
              return (
                <div key={i} style={s.userBubble}>
                  <span style={s.userLabel}>You</span>
                  <p style={s.userText}>{msg.text}</p>
                </div>
              )
            }

            if (msg.role === 'agent') {
              const agent = agentMap[msg.agentId]
              if (!agent) return null
              return (
                <div key={i} style={{ ...s.agentBubble, borderLeftColor: agent.color }}>
                  <div style={s.agentBubbleHeader}>
                    <span style={{ color: agent.color, fontWeight: 600, fontSize: 13 }}>
                      {agent.emoji} {agent.name}
                    </span>
                    {msg.isInterjection && <span style={s.interjectionTag}>jumped in</span>}
                    <span style={s.bubbleTime}>{msg.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p style={s.agentText}>{msg.text}</p>
                </div>
              )
            }

            if (msg.role === 'error') {
              return (
                <div key={i} style={s.errorBubble}>
                  ⚠️ {msg.text}
                </div>
              )
            }

            return null
          })}

          {processingAgentId && agentMap[processingAgentId] && (
            <div style={{ ...s.agentBubble, borderLeftColor: agentMap[processingAgentId].color }}>
              <span style={{ color: agentMap[processingAgentId].color, fontSize: 13, fontWeight: 600 }}>
                {agentMap[processingAgentId].emoji} {agentMap[processingAgentId].name}
              </span>
              <ThinkingDots />
            </div>
          )}
        </div>

        {/* Text input bar */}
        <form
          onSubmit={(e) => { e.preventDefault(); if (textInput.trim()) { handleUtterance(textInput.trim()); setTextInput('') } }}
          style={s.inputBar}
        >
          <input
            style={s.textInput}
            type="text"
            placeholder={activeAgentId && agentMap[activeAgentId] ? `Message ${agentMap[activeAgentId].name}…` : 'Type a message…'}
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            disabled={!!processingAgentId}
          />
          <button type="submit" style={{ ...s.sendBtn, opacity: textInput.trim() && !processingAgentId ? 1 : 0.4 }} disabled={!textInput.trim() || !!processingAgentId}>
            Send
          </button>
        </form>

        {/* Mic error */}
        {micError && <p style={s.micError}>{micError}</p>}
      </main>
    </div>
  )
}

// ─── Small components ─────────────────────────────────────────────────────────

function PulsingDot() {
  return (
    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#22c55e', marginLeft: 6, animation: 'pulse 1s infinite' }} />
  )
}

function ThinkingDots() {
  return (
    <span style={{ display: 'flex', gap: 4, marginTop: 8 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#4a4a60', animation: `bounce 1.2s ${i * 0.2}s infinite` }} />
      ))}
    </span>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = {
  page: { display: 'flex', minHeight: '100vh', background: '#0a0a0f' },

  sidebar: {
    width: 240, flexShrink: 0, borderRight: '1px solid #1e1e2a',
    padding: '28px 16px', display: 'flex', flexDirection: 'column', gap: 10,
  },
  sidebarLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#4a4a60', marginBottom: 4, fontWeight: 600 },
  agentRow: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
    borderRadius: 10, border: '1px solid', transition: 'all 0.2s',
    background: '#13131a',
  },
  agentEmoji: { fontSize: 20 },
  agentInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 },
  agentName: { fontSize: 13, fontWeight: 600, transition: 'color 0.2s' },
  agentRole: { fontSize: 10, color: '#4a4a60', textTransform: 'uppercase', letterSpacing: '0.05em' },
  inviteBtn: {
    fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid',
    cursor: 'pointer', fontWeight: 500, transition: 'all 0.2s', whiteSpace: 'nowrap',
  },
  sidebarDivider: { height: 1, background: '#1e1e2a', margin: '8px 0' },
  sidebarHint: { fontSize: 11, color: '#3a3a50', lineHeight: 1.6 },
  code: { fontFamily: 'monospace', background: '#1e1e2a', padding: '1px 4px', borderRadius: 3, fontSize: 10 },

  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },

  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '24px 28px 16px', borderBottom: '1px solid #1e1e2a',
  },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: 10 },
  title: { fontSize: 18, fontWeight: 700, color: '#e8e8f0', letterSpacing: '-0.01em' },
  inRoomPills: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  pill: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
    padding: '4px 10px', borderRadius: 20, border: '1px solid',
    transition: 'all 0.3s',
  },
  micStatus: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 },
  micDot: { width: 8, height: 8, borderRadius: '50%', transition: 'all 0.3s' },
  micLabel: { fontSize: 12, color: '#6b6b85' },

  interim: {
    margin: '0 28px', padding: '8px 14px', background: '#13131a',
    border: '1px solid #2a2a3a', borderRadius: 8,
    display: 'flex', alignItems: 'center', gap: 12,
  },
  interimText: { fontSize: 13, color: '#6b6b85', fontStyle: 'italic', flex: 1 },
  interimTarget: { fontSize: 12, fontWeight: 600 },

  feed: { flex: 1, overflowY: 'auto', padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 14 },

  emptyState: { margin: 'auto', textAlign: 'center', paddingBottom: 40 },
  emptyTitle: { fontSize: 18, color: '#4a4a60', marginBottom: 8 },
  emptyHint: { fontSize: 14, color: '#3a3a50', lineHeight: 1.7 },

  userBubble: {
    alignSelf: 'flex-end', maxWidth: '70%',
    background: '#1c1c27', border: '1px solid #2a2a3a', borderRadius: '12px 12px 2px 12px',
    padding: '10px 14px',
  },
  userLabel: { fontSize: 11, color: '#4a4a60', display: 'block', marginBottom: 4 },
  userText: { fontSize: 14, color: '#c8c8dc', lineHeight: 1.55 },

  agentBubble: {
    alignSelf: 'flex-start', maxWidth: '80%',
    background: '#13131a', border: '1px solid #2a2a3a', borderLeft: '3px solid',
    borderRadius: '2px 12px 12px 12px', padding: '12px 16px',
  },
  agentBubbleHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  agentText: { fontSize: 14, color: '#d8d8ec', lineHeight: 1.65 },
  bubbleTime: { fontSize: 10, color: '#3a3a50', marginLeft: 'auto' },
  interjectionTag: { fontSize: 10, color: '#f97316', background: '#f9731611', padding: '1px 6px', borderRadius: 4 },

  errorBubble: { padding: '8px 12px', background: '#1a0f0f', border: '1px solid #ef444433', borderRadius: 8, fontSize: 13, color: '#ef4444' },

  micError: { fontSize: 12, color: '#ef4444', padding: '4px 28px 0' },

  inputBar: {
    display: 'flex', gap: 8, padding: '12px 28px 16px',
    borderTop: '1px solid #1e1e2a',
  },
  textInput: {
    flex: 1, background: '#13131a', border: '1px solid #2a2a3a', borderRadius: 8,
    padding: '9px 14px', fontSize: 14, color: '#e8e8f0', outline: 'none',
    fontFamily: 'inherit',
  },
  sendBtn: {
    background: '#1e1e35', border: '1px solid #3a3a55', borderRadius: 8,
    padding: '9px 18px', fontSize: 13, color: '#a0a0c0', cursor: 'pointer',
    fontWeight: 500, transition: 'opacity 0.15s',
  },
}
