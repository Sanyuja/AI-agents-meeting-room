/**
 * Claude API wrapper.
 * Handles: single agent response, agent-to-agent consultation, interjection check.
 */

import Anthropic from '@anthropic-ai/sdk'
import { CLICKUP_TOOL_DEFINITIONS, executeTool } from './clickup.js'
import { registry } from '../index.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-6'

// Tools that Alfred specifically has access to
const ALFRED_TOOLS = CLICKUP_TOOL_DEFINITIONS

// Agent-to-agent consultation tool (all agents can use this)
const CONSULT_TOOL = {
  name: 'consult_colleague',
  description: 'Quietly consult a teammate for their input before responding. Use when the task has a dimension outside your primary expertise. The colleague\'s response is for your context only — you synthesize it into your own reply.',
  input_schema: {
    type: 'object',
    properties: {
      colleague_id: {
        type: 'string',
        description: 'ID of the colleague to consult. Available: miss-behave (creative/brand), alfred (tech/ops).',
      },
      question: {
        type: 'string',
        description: 'The specific question you\'re asking your colleague. Be concise.',
      },
      context: {
        type: 'string',
        description: 'Brief context so the colleague understands what\'s being discussed.',
      },
    },
    required: ['colleague_id', 'question', 'context'],
  },
}

// ─── Main agent response ──────────────────────────────────────────────────────

export async function getAgentResponse({ agentId, transcript, conversationHistory = [] }) {
  const agent = registry[agentId]
  if (!agent) throw new Error(`Unknown agent: ${agentId}`)

  // Determine tools for this agent — all agents get ClickUp access
  const tools = [...ALFRED_TOOLS]
  if (agent.canConsult?.length) tools.push(CONSULT_TOOL)

  const messages = [
    ...conversationHistory,
    { role: 'user', content: transcript },
  ]

  const response = await runWithTools({
    systemPrompt: agent.systemPrompt,
    messages,
    tools,
    agentId,
  })

  return response
}

// ─── Interjection check ───────────────────────────────────────────────────────
// After an agent responds, ask other in-meeting agents if they want to add anything.
// Returns array of { agentId, text } — empty if nobody wants to interject.

export async function checkInterjections({ excludeAgentId, inMeetingAgentIds, lastExchange }) {
  if (inMeetingAgentIds.length <= 1) return []

  const candidates = inMeetingAgentIds.filter((id) => id !== excludeAgentId)

  const checks = candidates.map(async (agentId) => {
    const agent = registry[agentId]
    if (!agent) return null

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: `${agent.systemPrompt}

SPECIAL INSTRUCTION FOR THIS CHECK:
You are deciding whether to interject into the current conversation.
Read what was just said. If you have something genuinely valuable, urgent, or insightful to add RIGHT NOW — respond with your interjection (1–2 sentences max, natural, in your voice).
If you don't have something worth saying, respond with exactly: PASS
Do not force an interjection. Only interject if it would be rude NOT to.`,
      messages: [
        {
          role: 'user',
          content: `The conversation just had this exchange:\n\n${lastExchange}\n\nDo you want to add anything?`,
        },
      ],
    })

    const text = res.content[0]?.text?.trim()
    if (!text || text === 'PASS') return null
    return { agentId, text }
  })

  const results = await Promise.all(checks)
  return results.filter(Boolean)
}

// ─── Agent-to-agent consultation (called when consult_colleague tool fires) ───

export async function consultColleague({ colleagueId, question, context, consultingAgentId }) {
  const agent = registry[colleagueId]
  if (!agent) return { error: `Agent ${colleagueId} not found` }

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: `${agent.systemPrompt}

SPECIAL INSTRUCTION:
You are being consulted internally by your colleague ${registry[consultingAgentId]?.name || 'a teammate'}.
This is a back-channel conversation — Sanyuja will not hear your direct response.
Your colleague will synthesize your input into their own reply.
Be concise and direct. 2–4 sentences max.`,
    messages: [
      {
        role: 'user',
        content: `Context: ${context}\n\nQuestion from ${registry[consultingAgentId]?.name}: ${question}`,
      },
    ],
  })

  return { text: res.content[0]?.text?.trim() }
}

// ─── Tool loop (handles multi-turn tool use) ─────────────────────────────────

async function runWithTools({ systemPrompt, messages, tools, agentId, depth = 0 }) {
  if (depth > 5) return '[max tool depth reached]' // safety valve

  const params = {
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  }
  if (tools.length) params.tools = tools

  const res = await client.messages.create(params)

  // If the model wants to use a tool
  if (res.stop_reason === 'tool_use') {
    const toolUseBlocks = res.content.filter((b) => b.type === 'tool_use')
    const toolResults = []

    for (const block of toolUseBlocks) {
      let result

      if (block.name === 'consult_colleague') {
        result = await consultColleague({
          ...block.input,
          consultingAgentId: agentId,
        })
      } else {
        // ClickUp tool
        result = await executeTool(block.name, block.input)
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      })
    }

    // Continue the conversation with tool results
    const updatedMessages = [
      ...messages,
      { role: 'assistant', content: res.content },
      { role: 'user', content: toolResults },
    ]

    return runWithTools({ systemPrompt, messages: updatedMessages, tools, agentId, depth: depth + 1 })
  }

  // Final text response
  return res.content.find((b) => b.type === 'text')?.text?.trim() ?? ''
}
