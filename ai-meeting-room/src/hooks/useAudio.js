/**
 * Audio playback hook.
 * Takes a base64 mp3 string and plays it via Web Audio API.
 * Returns { play, isPlaying }.
 */

import { useRef, useState, useCallback } from 'react'

export function useAudio() {
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef(null)

  const play = useCallback(async (base64, mime = 'audio/mpeg') => {
    // Stop anything currently playing
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    if (!base64) return

    const blob = b64ToBlob(base64, mime)
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audioRef.current = audio

    setIsPlaying(true)

    await new Promise((resolve, reject) => {
      audio.onended = () => {
        setIsPlaying(false)
        URL.revokeObjectURL(url)
        resolve()
      }
      audio.onerror = (e) => {
        setIsPlaying(false)
        URL.revokeObjectURL(url)
        reject(e)
      }
      audio.play().catch(reject)
    })
  }, [])

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setIsPlaying(false)
  }, [])

  return { play, stop, isPlaying }
}

function b64ToBlob(b64, mime) {
  const bytes = atob(b64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
