/**
 * Always-on speech recognition hook.
 * Uses the browser's Web Speech API in continuous mode.
 * Detects agent names in real-time and fires onNameDetected.
 * Fires onUtterance when a complete thought is spoken (after a natural pause).
 */

import { useEffect, useRef, useState, useCallback } from 'react'


export function useSpeechRecognition({ onUtterance, onNameDetected, onInterim, enabled = true, agents = [] }) {
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState(null)
  const recognitionRef = useRef(null)
  const finalTranscriptRef = useRef('')
  const interimRef = useRef('')
  const pauseTimerRef = useRef(null)
  const enabledRef = useRef(enabled)

  // Keep callback refs current so recognition handlers always call the latest version,
  // even if the parent re-creates the callbacks after allAgents/inMeeting loads.
  const onUtteranceRef = useRef(onUtterance)
  const onNameDetectedRef = useRef(onNameDetected)
  const onInterimRef = useRef(onInterim)
  useEffect(() => { onUtteranceRef.current = onUtterance }, [onUtterance])
  useEffect(() => { onNameDetectedRef.current = onNameDetected }, [onNameDetected])
  useEffect(() => { onInterimRef.current = onInterim }, [onInterim])

  // Keep the ref in sync so recognition.onend always reads the current value
  useEffect(() => { enabledRef.current = enabled }, [enabled])

  // Build name patterns dynamically from the agent list passed in from App
  const agentPatternsRef = useRef({})
  useEffect(() => {
    const patterns = {}
    for (const agent of agents) {
      // Match: full name ("miss behave"), id words ("miss-behave" → "miss" or "behave"), first word
      const words = agent.id.split('-').concat(agent.name.toLowerCase().split(/\s+/))
      const unique = [...new Set(words)].filter((w) => w.length > 2)
      patterns[agent.id] = new RegExp(`\\b(${unique.join('|')})\\b`, 'i')
    }
    agentPatternsRef.current = patterns
  }, [agents])

  const detectAgentName = useCallback((text) => {
    for (const [agentId, pattern] of Object.entries(agentPatternsRef.current)) {
      if (pattern.test(text)) return agentId
    }
    return null
  }, [])

  const startListening = useCallback(() => {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      setError('Speech recognition not supported. Use Chrome or Edge.')
      return
    }

    // Kill the old instance cleanly — null its onend so it doesn't trigger a restart
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      recognitionRef.current.abort()
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SR()

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.maxAlternatives = 1

    recognition.onstart = () => { console.log('[SR] started'); setIsListening(true) }
    recognition.onend = () => {
      setIsListening(false)
      // Only restart if THIS instance is still the active one — prevents abort loops
      if (enabledRef.current && recognitionRef.current === recognition) {
        setTimeout(() => recognition.start(), 300)
      }
    }
    recognition.onerror = (e) => {
      console.log('[SR] error:', e.error)
      if (e.error === 'no-speech') return
      if (e.error === 'aborted') return
      setError(`Mic error: ${e.error}`)
    }

    recognition.onresult = (event) => {
      console.log('[SR] got result')
      let interimText = ''
      let finalText = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalText += transcript
        } else {
          interimText += transcript
        }
      }

      const combined = finalTranscriptRef.current + finalText
      finalTranscriptRef.current = combined
      if (interimText) interimRef.current = interimText

      // Show interim text in UI
      if (interimText) onInterimRef.current?.(interimText)

      // Detect agent name in what's being said right now
      const nameInInterim = detectAgentName(interimText)
      const nameInFinal = detectAgentName(finalText)
      if (nameInInterim || nameInFinal) {
        onNameDetectedRef.current?.(nameInInterim || nameInFinal)
      }

      // After a pause (1.2s silence), fire the full utterance.
      // Use final text if available, fall back to interim — some browsers only
      // return interim results and never mark them final.
      clearTimeout(pauseTimerRef.current)
      if (combined.trim() || interimText.trim()) {
        pauseTimerRef.current = setTimeout(() => {
          const text = (finalTranscriptRef.current || interimRef.current).trim()
          if (text) {
            onUtteranceRef.current?.(text)
            finalTranscriptRef.current = ''
            interimRef.current = ''
            onInterimRef.current?.('')
          }
        }, 1200)
      }
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [detectAgentName])

  const stopListening = useCallback(() => {
    clearTimeout(pauseTimerRef.current)
    recognitionRef.current?.abort()
    setIsListening(false)
  }, [])

  useEffect(() => {
    if (enabled) startListening()
    else stopListening()
    return stopListening
  }, [enabled]) // eslint-disable-line

  return { isListening, error, stopListening, startListening }
}
