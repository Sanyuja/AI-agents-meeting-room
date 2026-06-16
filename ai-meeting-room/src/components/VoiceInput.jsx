import { useState, useRef, useCallback } from 'react'

const WHISPER_API = 'https://api.openai.com/v1/audio/transcriptions'
const API_KEY = import.meta.env.VITE_OPENAI_API_KEY

/**
 * VoiceInput — Layer 1 of The AI Meeting Room
 *
 * Flow:
 *   1. User clicks mic button → MediaRecorder starts capturing from podcast mic
 *   2. Audio chunks are collected in memory
 *   3. User releases button (or clicks again to stop)
 *   4. Audio blob sent to OpenAI Whisper API
 *   5. Transcription returned → passed up via onTranscription(text)
 */
export default function VoiceInput({ onTranscription, disabled = false }) {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [error, setError] = useState(null)
  const [volume, setVolume] = useState(0) // 0–1, for visualizer

  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const streamRef = useRef(null)
  const analyserRef = useRef(null)
  const animFrameRef = useRef(null)

  // --- Volume visualizer (reads mic level while recording) ---
  const startVolumeMonitor = useCallback((stream) => {
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyserRef.current = { analyser, ctx }

    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(data)
      const avg = data.reduce((a, b) => a + b, 0) / data.length
      setVolume(Math.min(avg / 80, 1)) // normalize ~0–1
      animFrameRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [])

  const stopVolumeMonitor = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (analyserRef.current?.ctx) analyserRef.current.ctx.close()
    analyserRef.current = null
    setVolume(0)
  }, [])

  // --- Start recording ---
  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.start(100) // collect chunks every 100ms
      setIsRecording(true)
      startVolumeMonitor(stream)
    } catch (err) {
      setError('Mic access denied. Check browser permissions.')
      console.error(err)
    }
  }, [startVolumeMonitor])

  // --- Stop recording + transcribe ---
  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return

    recorder.onstop = async () => {
      stopVolumeMonitor()

      // Stop all mic tracks
      streamRef.current?.getTracks().forEach((t) => t.stop())

      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      if (blob.size < 1000) {
        // Too short — ignore
        setIsRecording(false)
        return
      }

      setIsRecording(false)
      setIsTranscribing(true)

      try {
        const formData = new FormData()
        formData.append('file', blob, 'recording.webm')
        formData.append('model', 'whisper-1')
        formData.append('language', 'en')

        const res = await fetch(WHISPER_API, {
          method: 'POST',
          headers: { Authorization: `Bearer ${API_KEY}` },
          body: formData,
        })

        if (!res.ok) {
          const err = await res.json()
          throw new Error(err?.error?.message || `HTTP ${res.status}`)
        }

        const { text } = await res.json()
        if (text?.trim()) onTranscription?.(text.trim())
      } catch (err) {
        setError(`Transcription failed: ${err.message}`)
        console.error(err)
      } finally {
        setIsTranscribing(false)
      }
    }

    recorder.stop()
  }, [stopVolumeMonitor, onTranscription])

  const toggleRecording = () => {
    if (isRecording) stopRecording()
    else startRecording()
  }

  // --- Visualizer bars ---
  const bars = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2
    const height = isRecording ? 4 + volume * 28 * (0.5 + 0.5 * Math.sin(angle * 3 + Date.now() / 200)) : 4
    return height
  })

  return (
    <div style={styles.wrapper}>
      {/* Mic button */}
      <button
        onClick={toggleRecording}
        disabled={disabled || isTranscribing}
        style={{
          ...styles.micBtn,
          background: isRecording
            ? `radial-gradient(circle, #ef4444 0%, #b91c1c 100%)`
            : `radial-gradient(circle, #7c6af7 0%, #5b46f5 100%)`,
          boxShadow: isRecording
            ? `0 0 0 ${4 + volume * 20}px rgba(239,68,68,0.2), 0 0 40px rgba(239,68,68,0.4)`
            : '0 0 20px rgba(124,106,247,0.3)',
          transform: isRecording ? 'scale(1.08)' : 'scale(1)',
        }}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
      >
        {isTranscribing ? (
          <SpinnerIcon />
        ) : isRecording ? (
          <StopIcon />
        ) : (
          <MicIcon />
        )}
      </button>

      {/* Status label */}
      <p style={styles.statusLabel}>
        {isTranscribing
          ? 'Transcribing…'
          : isRecording
          ? 'Listening… click to send'
          : 'Click to speak'}
      </p>

      {/* Error */}
      {error && <p style={styles.error}>{error}</p>}
    </div>
  )
}

// --- Icons ---
function MicIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  )
}

// --- Styles ---
const styles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '14px',
  },
  micBtn: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    outline: 'none',
  },
  statusLabel: {
    fontSize: '13px',
    color: '#6b6b85',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  error: {
    fontSize: '12px',
    color: '#ef4444',
    maxWidth: '280px',
    textAlign: 'center',
  },
}
