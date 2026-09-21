import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { JevAnswer } from '@shared/jevProtocol'
import {
  buildJevPruningQuestions,
  fitJevPruningState,
  JEV_PRUNING_KEEP_THRESHOLD
} from '@/agent/deepchat/runtime/jevToolResultPruning'
import { pruningInvocationSignature } from '@/agent/deepchat/runtime/jevPruningFeedback'

/**
 * TEMPORARY evaluation probe — untracked, not a durable test.
 *
 * Answers the one question the in-process feedback loop cannot: is `keepThreshold` 0.5 anywhere near
 * right for real usage?
 *
 * The loop only fires when the agent re-runs a pruned tool, but our own noul criteria say the results
 * worth keeping are exactly the ones where re-running would NOT recover the contents — so the loop is
 * blind in the class where being wrong costs most. This measures that class offline instead, against
 * real Session Tape, with no human labeller anywhere. That matters: the `.env` hole in the permission
 * criteria came from grading criteria against labels written by the same person who wrote them.
 *
 * Ground truth comes from what actually happened later in the same session:
 *   - a re-run of the same (tool, args) — objective, and the only precise signal available
 *   - distinctive tokens from the pruned content appearing in a later assistant message — coarse
 *
 * Both are LOWER bounds. A result that was needed and neither re-run nor quoted is invisible here,
 * which is the blind spot itself. So a low false-drop rate is weak evidence; a high one is decisive.
 *
 * Tape layout note: `source_seq` is NOT a session-wide order — it is a small counter for tool rows and
 * a timestamp for messages, so ordering by it interleaves them wrongly and yields zero turns. The real
 * order is `orderSeq` inside the payload: one group per message, with a message's tool calls and
 * results sharing its sequence.
 */

const API_KEY = process.env.TYPESAFE_API_KEY
const MODEL = process.env.TYPESAFE_MODEL ?? 'jev-1.13.0'
const DB_PATH = path.join(os.homedir(), 'Library/Application Support/DeepChat/app_db/agent.db')
const SESSION_LIMIT = Number(process.env.JEV_EVAL_SESSIONS ?? 6)
const TURN_LIMIT = Number(process.env.JEV_EVAL_TURNS ?? 4)

type TapeRow = { kind: string; payload_json: string }

function readSessions(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      `SELECT session_id, COUNT(*) AS n FROM deepchat_tape_entries
       WHERE kind='tool_result' GROUP BY session_id ORDER BY n DESC LIMIT ?`
    )
    .all(SESSION_LIMIT) as { session_id: string }[]
  return rows.map((row) => row.session_id)
}

function loadRows(db: DatabaseSync, sessionId: string): TapeRow[] {
  return db
    .prepare(
      `SELECT kind, payload_json FROM deepchat_tape_entries
       WHERE session_id=? AND kind IN ('message','tool_call','tool_result')`
    )
    .all(sessionId) as TapeRow[]
}

type Group = {
  orderSeq: number
  userText?: string
  assistantText?: string
  calls: { id: string; name: string; params: string }[]
  results: Map<string, string>
}

/** Rebuilds a message list from tape rows, grouped by the payload's own `orderSeq`. */
function reconstruct(rows: TapeRow[]): ChatMessage[] {
  const groups = new Map<number, Group>()
  const groupFor = (orderSeq: number): Group => {
    let group = groups.get(orderSeq)
    if (!group) {
      group = { orderSeq, calls: [], results: new Map() }
      groups.set(orderSeq, group)
    }
    return group
  }

  for (const row of rows) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(row.payload_json) as Record<string, unknown>
    } catch {
      continue
    }

    if (row.kind === 'message') {
      const record = payload.record as
        | { role?: string; content?: string; orderSeq?: number }
        | undefined
      if (!record?.orderSeq) continue
      const group = groupFor(record.orderSeq)
      if (record.role === 'user') group.userText ??= extractText(record.content)
      else if (record.role === 'assistant') group.assistantText ??= extractText(record.content)
      continue
    }

    const orderSeq = Number(payload.orderSeq ?? 0)
    if (!orderSeq) continue
    const group = groupFor(orderSeq)

    if (row.kind === 'tool_call') {
      const call = payload.toolCall as { id?: string; name?: string; params?: string } | undefined
      if (call?.id) group.calls.push({ id: call.id, name: call.name ?? '', params: call.params ?? '' })
      continue
    }

    const toolCallId = payload.toolCallId as string | undefined
    const response = payload.response
    if (toolCallId && typeof response === 'string') group.results.set(toolCallId, response)
  }

  const messages: ChatMessage[] = []
  for (const group of [...groups.values()].sort((a, b) => a.orderSeq - b.orderSeq)) {
    if (group.userText !== undefined) {
      messages.push({ role: 'user', content: group.userText } as ChatMessage)
      continue
    }
    if (group.calls.length === 0) continue

    messages.push({
      role: 'assistant',
      content: group.assistantText ?? '',
      tool_calls: group.calls.map((call) => ({
        id: call.id,
        function: { name: call.name, arguments: call.params }
      }))
    } as unknown as ChatMessage)

    for (const call of group.calls) {
      const content = group.results.get(call.id)
      if (content === undefined) continue
      messages.push({ role: 'tool', tool_call_id: call.id, content } as unknown as ChatMessage)
    }
  }

  return messages
}

function extractText(content: string | undefined): string {
  if (!content) return ''
  try {
    const parsed = JSON.parse(content) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const text = (parsed as { text?: unknown }).text
      if (typeof text === 'string') return text
      return ''
    }
    if (Array.isArray(parsed)) {
      return parsed
        .map((block) => {
          if (!block || typeof block !== 'object') return ''
          const value = (block as { content?: unknown }).content
          return typeof value === 'string' ? value : ''
        })
        .filter(Boolean)
        .join('\n')
    }
  } catch {
    return content
  }
  return ''
}

/** Every turn: a user message up to the next one, keeping only turns that did tool work. */
function turnsOf(messages: ChatMessage[]): ChatMessage[][] {
  const starts: number[] = []
  messages.forEach((message, index) => {
    if (message.role === 'user') starts.push(index)
  })

  return starts
    .map((start, i) => messages.slice(start, starts[i + 1] ?? messages.length))
    .filter((turn) => turn.some((message) => message.role === 'tool'))
}

const askJev = async (
  state: unknown,
  questions: Record<string, unknown>
): Promise<Record<string, JevAnswer>> => {
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, model: MODEL, questions })
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return ((await response.json()) as { answers: Record<string, JevAnswer> }).answers
}

function distinctiveTokens(content: string): string[] {
  return Array.from(new Set(content.match(/[A-Za-z0-9_./-]{12,}/g) ?? [])).slice(0, 12)
}

describe.skipIf(!API_KEY)('Jev pruning threshold evaluation', () => {
  it('measures false drops and wasted keeps against real sessions', async () => {
    const db = new DatabaseSync(DB_PATH, { readOnly: true })
    const sessions = readSessions(db)

    let turnsEvaluated = 0
    let pruned = 0
    let kept = 0
    let falseDrops = 0
    let wastedKeeps = 0
    let freedChars = 0
    const droppedRows: string[] = []

    for (const sessionId of sessions) {
      const messages = reconstruct(loadRows(db, sessionId))
      const allTurns = turnsOf(messages)

      for (const [turnIndex, turn] of allTurns.slice(0, TURN_LIMIT).entries()) {
        const fitted = fitJevPruningState({ messages: turn })
        if (!fitted) continue

        // Forward-looking ground truth: everything the session did after this turn.
        const turnEnd = messages.indexOf(turn[turn.length - 1])
        const later = messages.slice(turnEnd + 1)
        const laterSignatures = new Set(
          later
            .filter((message) => message.role === 'assistant' && message.tool_calls?.length)
            .flatMap((message) =>
              (message.tool_calls ?? []).map((call) =>
                pruningInvocationSignature(call.function.name, call.function.arguments)
              )
            )
        )
        const laterText = later
          .filter((message) => message.role === 'assistant')
          .map((message) => (typeof message.content === 'string' ? message.content : ''))
          .join('\n')

        let answers: Record<string, JevAnswer>
        try {
          answers = await askJev(fitted.state, buildJevPruningQuestions(fitted.candidates))
        } catch (error) {
          console.log(`skip ${sessionId} turn ${turnIndex}: ${String(error)}`)
          continue
        }

        turnsEvaluated += 1

        for (const candidate of fitted.candidates) {
          const answer = answers[`keep_${candidate.toolCallId}`]
          const probability = answer && answer.type === 'noul' ? answer.noul : null
          if (probability === null) continue

          const signature = pruningInvocationSignature(candidate.toolName, candidate.toolArgs)
          const rerun = laterSignatures.has(signature)
          const quoted = distinctiveTokens(candidate.content).some((token) =>
            laterText.includes(token)
          )
          const neededLater = rerun || quoted

          if (probability < JEV_PRUNING_KEEP_THRESHOLD) {
            pruned += 1
            freedChars += candidate.content.length
            if (neededLater) {
              falseDrops += 1
              droppedRows.push(
                `${candidate.toolName} p=${probability.toFixed(2)} ${
                  rerun ? 'RERUN' : 'quoted'
                } chars=${candidate.content.length}`
              )
            }
          } else {
            kept += 1
            if (!neededLater) wastedKeeps += 1
          }
        }
      }
    }

    db.close()

    const rate = (n: number, d: number) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`)

    console.log('\n=== Jev pruning evaluation ===')
    console.log(`sessions:        ${sessions.length}`)
    console.log(`turns evaluated: ${turnsEvaluated}`)
    console.log(`candidates:      ${pruned + kept} (pruned ${pruned}, kept ${kept})`)
    console.log(`chars freed:     ${freedChars}`)
    console.log(
      `FALSE DROPS:     ${falseDrops} / ${pruned}  (${rate(falseDrops, pruned)})  [lower bound]`
    )
    console.log(`wasted keeps:    ${wastedKeeps} / ${kept}  (${rate(wastedKeeps, kept)})`)
    console.log('\nfalse-drop detail (dropped but needed later):')
    for (const row of droppedRows.slice(0, 25)) console.log('  ', row)

    expect(turnsEvaluated).toBeGreaterThanOrEqual(0)
  }, 900_000)
})
