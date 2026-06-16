import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import agentRoutes from './routes/agents.js'

// Load personal agent files if they exist, otherwise fall back to the example versions.
// Copy *.example.js → *.js and customize to create your own agents.
const { alfred } = await import('./agents/alfred.js').catch(() => import('./agents/alfred.example.js'))
const { missBehave } = await import('./agents/miss-behave.js').catch(() => import('./agents/miss-behave.example.js'))

// ─── Agent Registry ───────────────────────────────────────────────────────────
// To add a new persona: import it here and add to the registry.
// No frontend changes needed — the UI fetches this list dynamically.
//
// Future: when Claude releases a Projects API, each agent entry here
// will include a `claudeProjectId` and the system prompt will be fetched
// from that project instead of defined inline.

export const registry = {
  [alfred.id]: alfred,
  [missBehave.id]: missBehave,
  // Add more agents here:
  // [dataB rain.id]: dataBrain,
  // [strategist.id]: strategist,
}

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express()

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }))
app.use(express.json())

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', agents: Object.keys(registry) }))

// Agent routes
app.use('/api/agents', agentRoutes)

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`\n🎙️  AI Meeting Room backend running on http://localhost:${PORT}`)
  console.log(`   Agents in registry: ${Object.keys(registry).join(', ')}`)
  console.log(`   Health: http://localhost:${PORT}/health\n`)
})
