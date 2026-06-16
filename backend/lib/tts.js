/**
 * ElevenLabs TTS proxy.
 * Returns audio buffer for the given text + agent voice settings.
 */

const ELEVEN_BASE = 'https://api.elevenlabs.io/v1'
const KEY = process.env.ELEVENLABS_API_KEY

export async function synthesize({ text, voiceId, voiceSettings = {} }) {
  const url = `${ELEVEN_BASE}/text-to-speech/${voiceId}/stream`

  const body = {
    text,
    model_id: 'eleven_turbo_v2_5', // fastest + cheapest, still great quality
    voice_settings: {
      stability: voiceSettings.stability ?? 0.7,
      similarity_boost: voiceSettings.similarity_boost ?? 0.8,
      style: voiceSettings.style ?? 0.2,
      use_speaker_boost: voiceSettings.use_speaker_boost ?? true,
    },
    output_format: 'mp3_44100_128',
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`ElevenLabs error ${res.status}: ${err}`)
  }

  // Return the audio as a buffer
  const buffer = await res.arrayBuffer()
  return Buffer.from(buffer)
}
