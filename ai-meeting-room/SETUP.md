# AI Meeting Room — Setup

## Prerequisites

- Node 18+
- An [Anthropic API key](https://console.anthropic.com)
- An [ElevenLabs API key](https://elevenlabs.io) (for agent voices)
- A ClickUp personal API token + your team ID (Alfred uses this to create tasks)

---

## First-time setup

**Terminal 1 — backend:**
```bash
cd backend
npm install
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, CLICKUP_API_KEY, CLICKUP_TEAM_ID
npm run dev
```

**Terminal 2 — frontend:**
```bash
cd ai-meeting-room
npm install
npm run dev
```

Then open http://localhost:5173

---

## How it works

- **Alfred** (🎩) is always in the room. He handles tech, ops, scheduling, and creates ClickUp tasks.
- **Miss Behave** (👑) covers brand, content, and creative. Invite her from the sidebar.
- Agents listen for their name in the mic stream and activate automatically.
- After Alfred responds, Miss Behave (if in the meeting) decides whether to interject.
- Each agent speaks in their own ElevenLabs voice. The mic pauses while audio plays.

### Text input
There's a text bar at the bottom — use it anytime, or if your browser doesn't support the mic (Chrome/Edge only for Web Speech API).

### Adding a new agent
1. Create `backend/agents/your-agent.js` — copy `alfred.js` as a template
2. Import it in `backend/index.js` and add to the `registry`
3. That's it — the frontend fetches the agent list dynamically, name detection updates automatically

---

## Env file reference (`backend/.env`)

```
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...
CLICKUP_API_KEY=pk_...
CLICKUP_TEAM_ID=...      # visible in your ClickUp workspace URL
PORT=3001                # optional, defaults to 3001
```
