/**
 * The AI Meeting Room — v2
 *
 * - Agents live in the backend. Frontend fetches the list.
 * - Invite agents into the meeting with one click.
 * - Always-on mic: say an agent's name and they activate instantly.
 * - Agents can interject after each response.
 * - Each response plays in the agent's ElevenLabs voice.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useSpeechRecognition } from './hooks/useSpeechRecognition.js'
import { useAudio } from './hooks/useAudio.js'

// Use VITE_API_URL env var if set, otherwise derive from current host (works on phone over local network)
const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`

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

      // Play the agent's voice (ElevenLabs if available, browser TTS as fallback)
      if (data.audio) {
        await play(data.audio, data.audioMime)
      } else if (data.text) {
        await speakBrowser(data.text, targetId)
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
        else if (inj.text) await speakBrowser(inj.text, inj.agentId)
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
        <div style={s.brandMark}>vr_rani</div>
        <div style={s.sidebarDivider} />
        <p style={s.sidebarLabel}>Team</p>
        {allAgents.map((agent) => {
          const active = inMeeting.includes(agent.id)
          return (
            <div key={agent.id} style={{ ...s.agentRow, borderColor: active ? agent.color : 'rgba(160,80,255,0.12)' }}>
              <AgentAvatar agent={agent} size={38} active={active} />
              <div style={s.agentInfo}>
                <span style={{ ...s.agentName, color: active ? agent.color : '#E8D8FF' }}>{agent.name}</span>
                <span style={s.agentRole}>{agent.role}</span>
              </div>
              <RoomToggleBtn agent={agent} active={active} onClick={() => toggleInMeeting(agent.id)} />
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
                <div key={i} style={{ ...s.agentBubble, borderLeftColor: agent.color, borderTopColor: `${agent.color}33`, background: `linear-gradient(135deg, rgba(17,0,28,0.75) 0%, ${agent.color}08 100%)` }}>
                  <div style={s.agentBubbleHeader}>
                    <AgentAvatar agent={agent} size={22} active />
                    <span style={{ color: agent.color, fontWeight: 700, fontSize: 13 }}>
                      {agent.name}
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

function RoomToggleBtn({ agent, active, onClick }) {
  const [hovered, setHovered] = React.useState(false)
  if (active) {
    return (
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ ...s.inviteBtn,
          background: hovered ? 'rgba(239,68,68,0.12)' : `${agent.color}22`,
          color: hovered ? '#ef4444' : agent.color,
          borderColor: hovered ? 'rgba(239,68,68,0.4)' : `${agent.color}55`,
          minWidth: 62,
        }}
      >
        {hovered ? 'Remove' : 'In room'}
      </button>
    )
  }
  return (
    <button
      onClick={onClick}
      style={{ ...s.inviteBtn,
        background: 'rgba(17,0,28,0.8)',
        color: '#6B5080',
        borderColor: 'rgba(160,80,255,0.15)',
        minWidth: 62,
      }}
    >
      Invite
    </button>
  )
}

function AgentAvatar({ agent, size = 36, active = false }) {
  const [imgFailed, setImgFailed] = React.useState(false)
  const showImg = agent.image && !imgFailed
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
      border: `1.5px solid ${active ? agent.color : 'rgba(160,80,255,0.2)'}`,
      boxShadow: active ? `0 0 ${size * 0.4}px ${agent.color}55` : 'none',
      background: `${agent.color}22`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.3s',
    }}>
      {showImg
        ? <img src={agent.image} alt="" onError={() => setImgFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontSize: size * 0.45, lineHeight: 1 }}>{agent.emoji}</span>
      }
    </div>
  )
}

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

// ─── Browser TTS fallback ────────────────────────────────────────────────────
// Used when ElevenLabs is unavailable (free plan, quota exceeded, etc.)

function speakBrowser(text, agentId = '') {
  return new Promise((resolve) => {
    if (!window.speechSynthesis || !text) { resolve(); return }
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)

    // Voices load async — wait briefly if not ready yet
    const go = () => {
      const voices = window.speechSynthesis.getVoices()
      if (agentId === 'alfred') {
        const v = voices.find((v) => v.lang === 'en-GB') || voices.find((v) => v.lang.startsWith('en'))
        if (v) utter.voice = v
        utter.pitch = 0.88
        utter.rate  = 0.92
      } else {
        const v = voices.find((v) => /female|woman/i.test(v.name) && v.lang.startsWith('en'))
          || voices.find((v) => v.lang.startsWith('en-US'))
        if (v) utter.voice = v
        utter.pitch = 1.12
        utter.rate  = 1.05
      }
      utter.onend  = resolve
      utter.onerror = resolve
      window.speechSynthesis.speak(utter)
    }

    const voices = window.speechSynthesis.getVoices()
    if (voices.length) {
      go()
    } else {
      window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; go() }
    }
  })
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const GOLD   = '#C9A84C'
const GOLD_G = 'rgba(201,168,76,0.18)'
const PURPLE = 'rgba(155,93,229,0.15)'
const BORDER = 'rgba(160,80,255,0.16)'

const s = {
  page: { display: 'flex', minHeight: '100vh' },

  // ── Sidebar ──
  sidebar: {
    width: 250, flexShrink: 0,
    borderRight: `1px solid ${BORDER}`,
    padding: '24px 14px', display: 'flex', flexDirection: 'column', gap: 10,
    background: 'rgba(7,0,14,0.72)',
    backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
  },
  brandMark: {
    textAlign: 'center', padding: '4px 0 12px',
    fontSize: 15, fontWeight: 800, letterSpacing: '0.12em',
    background: 'linear-gradient(135deg, #C9A84C 0%, #F0D47A 50%, #C9A84C 100%)',
    backgroundSize: '200% auto',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
    animation: 'shimmer 4s linear infinite',
  },
  sidebarLabel: {
    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em',
    color: GOLD, marginBottom: 4, fontWeight: 700,
  },
  agentRow: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
    borderRadius: 10, border: '1px solid', transition: 'all 0.2s',
    background: 'rgba(17,0,28,0.65)',
  },
  agentEmoji: { fontSize: 20 }, // fallback when no image
  agentInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 },
  agentName: { fontSize: 13, fontWeight: 600, transition: 'color 0.2s' },
  agentRole: { fontSize: 10, color: '#6B5080', textTransform: 'uppercase', letterSpacing: '0.06em' },
  inviteBtn: {
    fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid',
    cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s', whiteSpace: 'nowrap',
    letterSpacing: '0.02em',
  },
  sidebarDivider: { height: 1, background: BORDER, margin: '8px 0' },
  sidebarHint: { fontSize: 11, color: '#4A3060', lineHeight: 1.6 },
  code: {
    fontFamily: 'monospace', background: PURPLE,
    padding: '1px 5px', borderRadius: 3, fontSize: 10, color: '#A080D0',
  },

  // ── Main ──
  main: {
    flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    background: 'rgba(7,0,14,0.45)',
    backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
  },

  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '22px 28px 14px',
    borderBottom: `1px solid ${BORDER}`,
    background: 'rgba(7,0,14,0.35)',
  },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: 10 },
  title: {
    fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em',
    background: 'linear-gradient(135deg, #E8D8FF 0%, #C9A84C 100%)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  inRoomPills: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  pill: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
    padding: '4px 10px', borderRadius: 20, border: '1px solid', transition: 'all 0.3s',
  },
  micStatus: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 },
  micDot: { width: 8, height: 8, borderRadius: '50%', transition: 'all 0.3s' },
  micLabel: { fontSize: 12, color: '#8A70A8' },

  // ── Chat ──
  interim: {
    margin: '8px 28px', padding: '8px 14px',
    background: 'rgba(17,0,28,0.55)', border: `1px solid ${GOLD_G}`,
    borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12,
    backdropFilter: 'blur(8px)',
  },
  interimText: { fontSize: 13, color: '#8A70A8', fontStyle: 'italic', flex: 1 },
  interimTarget: { fontSize: 12, fontWeight: 600 },

  feed: { flex: 1, overflowY: 'auto', padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 14 },

  emptyState: { margin: 'auto', textAlign: 'center', paddingBottom: 40 },
  emptyTitle: { fontSize: 18, color: '#4A3060', marginBottom: 8 },
  emptyHint: { fontSize: 14, color: '#3A2050', lineHeight: 1.7 },

  userBubble: {
    alignSelf: 'flex-end', maxWidth: '70%',
    background: 'rgba(30,8,50,0.7)',
    border: `1px solid ${GOLD_G}`,
    borderRadius: '12px 12px 2px 12px', padding: '10px 14px',
    backdropFilter: 'blur(8px)',
  },
  userLabel: { fontSize: 11, color: GOLD, display: 'block', marginBottom: 4, fontWeight: 600 },
  userText: { fontSize: 14, color: '#D8C8F0', lineHeight: 1.55 },

  agentBubble: {
    alignSelf: 'flex-start', maxWidth: '80%',
    background: 'rgba(17,0,28,0.65)',
    border: `1px solid ${BORDER}`, borderLeft: '3px solid',
    borderRadius: '2px 12px 12px 12px', padding: '12px 16px',
    backdropFilter: 'blur(8px)',
  },
  agentBubbleHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  agentText: { fontSize: 14, color: '#D8C8F0', lineHeight: 1.65 },
  bubbleTime: { fontSize: 10, color: '#4A3060', marginLeft: 'auto' },
  interjectionTag: {
    fontSize: 10, color: GOLD,
    background: GOLD_G, padding: '1px 6px', borderRadius: 4,
  },

  errorBubble: {
    padding: '8px 12px', background: 'rgba(30,0,0,0.7)',
    border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8,
    fontSize: 13, color: '#ef4444',
  },
  micError: { fontSize: 12, color: '#ef4444', padding: '4px 28px 0' },

  // ── Input ──
  inputBar: {
    display: 'flex', gap: 8, padding: '12px 28px 16px',
    borderTop: `1px solid ${BORDER}`,
    background: 'rgba(7,0,14,0.5)',
  },
  textInput: {
    flex: 1, background: 'rgba(17,0,28,0.75)',
    border: `1px solid ${BORDER}`, borderRadius: 8,
    padding: '9px 14px', fontSize: 14, color: '#F0E8FF', outline: 'none',
    fontFamily: 'inherit', transition: 'border-color 0.2s',
  },
  sendBtn: {
    background: `linear-gradient(135deg, #8B6010, ${GOLD})`,
    border: 'none', borderRadius: 8,
    padding: '9px 22px', fontSize: 13, color: '#07000E',
    cursor: 'pointer', fontWeight: 700, transition: 'opacity 0.15s',
    letterSpacing: '0.03em',
  },
}
