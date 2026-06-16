# The AI Meeting Room

A voice-first meeting space where AI agents with distinct personalities sit in the room with you. Speak naturally, address an agent by name, and they respond in their own voice — and sometimes jump in uninvited.

Built with Claude (tool use), ElevenLabs TTS, and the browser's Web Speech API.

---

## What it does

- **Always-on mic** — the room is always listening. Say an agent's name and they activate.
- **Natural conversation** — agents remember the conversation, respond in character, and can interject after each other.
- **Voices** — each agent speaks in their own ElevenLabs voice. The mic pauses while audio plays so agents don't talk over you.
- **ClickUp integration** — agents can create, assign, and update tasks directly from the conversation. No copy-paste.
- **Text input fallback** — type instead of speaking at any time (required on Firefox/Safari; Chrome/Edge for mic).

---

## Agents

Agents are defined in `backend/agents/`. Two examples are included:

| Agent | Personality | Domain |
|---|---|---|
| **Alfred** 🎩 | British, calm, precise | Tech, ops, execution |
| **Miss Behave** 👑 | Bold, creative, unapologetic | Brand, content, aesthetics |

Both have full ClickUp access. Alfred is always in the room on load. Invite Miss Behave from the sidebar.

---

## Quick start

**Prerequisites:** Node 18+, API keys for Anthropic, ElevenLabs, and ClickUp.

```bash
# Install all dependencies (root + backend + frontend)
npm run setup

# Start both servers with one command
npm run dev
```

Then open **http://localhost:5173**

---

## Manual setup (if you prefer)

**Terminal 1 — backend:**
```bash
cd backend
npm install
cp .env.example .env
# Fill in your keys (see below)
npm run dev
```

**Terminal 2 — frontend:**
```bash
cd ai-meeting-room
npm install
npm run dev
```

---

## Environment variables

Create `backend/.env` from `backend/.env.example`:

```
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...
CLICKUP_API_KEY=pk_...
CLICKUP_TEAM_ID=...           # visible in your ClickUp workspace URL

# ClickUp user IDs for task assignment — find yours in ClickUp → Settings → My Profile
CLICKUP_USER_ID_SANYUJA=...   # replace with your name and ID
CLICKUP_USER_ID_ALFRED=...    # agent IDs if you've added them as ClickUp members
CLICKUP_USER_ID_MISS_BEHAVE=...

PORT=3001                     # optional, defaults to 3001
```

> ElevenLabs free plan only supports the 9 premade voices via API. The app falls back to browser `speechSynthesis` automatically if ElevenLabs fails.

---

## Adding your own agent

1. Copy `backend/agents/alfred.example.js` → `backend/agents/your-agent.js`
2. Edit the name, personality, voice ID, and system prompt
3. Register it in `backend/index.js`:
   ```js
   import { yourAgent } from './agents/your-agent.js'
   export const registry = { alfred, missBehave, yourAgent }
   ```
4. The frontend fetches agents dynamically — no frontend changes needed

Your agent file is gitignored by default (only `.example.js` files are committed), so your personal prompt and voice stay local.

---

## Architecture

```
Browser
  └── Web Speech API (mic → text, continuous)
  └── React frontend (localhost:5173)
        └── POST /api/agents/:id/chat
              └── Express backend (localhost:3001)
                    └── Claude API (tool use)
                          └── ClickUp API (create/update tasks)
                    └── ElevenLabs API (text → audio)
              └── base64 audio → browser Audio()
```

**Key files:**

| File | What it does |
|---|---|
| `backend/index.js` | Loads agents into the registry |
| `backend/lib/claude.js` | Claude API wrapper, tool loop, agent-to-agent consultation |
| `backend/lib/tts.js` | ElevenLabs synthesis |
| `backend/lib/clickup.js` | ClickUp tool definitions + execution |
| `ai-meeting-room/src/App.jsx` | Main UI, conversation state, audio playback |
| `ai-meeting-room/src/hooks/useSpeechRecognition.js` | Always-on mic with name detection |
| `ai-meeting-room/src/hooks/useAudio.js` | Audio playback (awaits `onended` before resolving) |

---

## What's gitignored

- `backend/.env` — your API keys
- `backend/agents/alfred.js`, `miss-behave.js` — your personal agent configs (system prompts, voice IDs)
- `ai-meeting-room/public/*.png`, `*.tiff` — your brand images

The `.example.js` agent files and `.env.example` are committed so anyone can clone and personalise without touching your private setup.
