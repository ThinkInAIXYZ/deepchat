import { nanoid } from 'nanoid'

type StatementLike = {
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  run(...params: unknown[]): unknown
}

export type DebugMockChatDatabase = {
  prepare(sql: string): StatementLike
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T
}

export type DebugMockChatSessionResult = {
  created: boolean
  sessionId: string | null
  title: string | null
  messageCount: number
}

type SampleRow = {
  role: 'user' | 'assistant'
  content: string
}

type ModelRow = {
  provider_id?: string
  model_id?: string
}

type AssistantBlock = {
  id: string
  type:
    | 'content'
    | 'search'
    | 'reasoning_content'
    | 'error'
    | 'tool_call'
    | 'action'
    | 'image'
    | 'artifact-thinking'
  content?: string
  status: 'success' | 'error' | 'granted'
  timestamp: number
  extra?: Record<string, unknown>
  artifact?: {
    identifier: string
    title: string
    type: 'text/markdown' | 'application/vnd.ant.mermaid'
    language?: string
  }
  tool_call?: {
    id: string
    name: string
    params: string
    response: string
    server_name: string
  }
  action_type?: 'question_request'
  image_data?: { data: string; mimeType: string }
  reasoning_time?: { start: number; end: number }
}

const PAIR_COUNT = 100
const DEFAULT_AGENT_ID = 'deepchat'
const SEARCH_NEEDLE = 'mock-long-chat-alpha'
const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
const ASSISTANT_BLOCK_TYPES: AssistantBlock['type'][] = [
  'content',
  'reasoning_content',
  'search',
  'tool_call',
  'action',
  'image',
  'artifact-thinking',
  'error'
]

export function createDebugMockChatSession(db: DebugMockChatDatabase): DebugMockChatSessionResult {
  const now = Date.now()
  const sessionId = `debug-long-chat-${nanoid()}`
  const title = `Debug long chat ${new Date(now).toISOString().slice(0, 19).replace('T', ' ')}`
  const samples = readMessageSamples(db)
  const model = readModelSample(db)
  const messages = buildMessages(now, samples)

  const insertSession = db.prepare(
    `INSERT INTO new_sessions (
      id,
      agent_id,
      title,
      project_dir,
      is_pinned,
      is_draft,
      active_skills,
      disabled_agent_tools,
      subagent_enabled,
      session_kind,
      parent_session_id,
      subagent_meta_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertDeepchatSession = db.prepare(
    `INSERT INTO deepchat_sessions (
      id,
      provider_id,
      model_id,
      permission_mode,
      system_prompt
    ) VALUES (?, ?, ?, ?, ?)`
  )
  const insertMessage = db.prepare(
    `INSERT INTO deepchat_messages (
      id,
      session_id,
      order_seq,
      role,
      content,
      status,
      is_context_edge,
      metadata,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const run = db.transaction(() => {
    insertSession.run(
      sessionId,
      DEFAULT_AGENT_ID,
      title,
      null,
      0,
      0,
      '[]',
      '[]',
      0,
      'regular',
      null,
      null,
      now,
      now
    )
    insertDeepchatSession.run(
      sessionId,
      model.provider_id ?? 'debug-provider',
      model.model_id ?? 'debug-model',
      'full_access',
      'Synthetic debug session for virtualized chat rendering and search validation.'
    )

    for (const message of messages) {
      insertMessage.run(
        message.id,
        sessionId,
        message.orderSeq,
        message.role,
        message.content,
        'sent',
        0,
        message.metadata,
        message.createdAt,
        message.createdAt
      )
    }
  })

  run()

  return {
    created: true,
    sessionId,
    title,
    messageCount: messages.length
  }
}

function readMessageSamples(db: DebugMockChatDatabase) {
  try {
    const rows = db
      .prepare(
        `SELECT role, content
         FROM deepchat_messages
         WHERE session_id NOT LIKE 'debug-long-chat-%'
         ORDER BY updated_at DESC
         LIMIT 80`
      )
      .all() as SampleRow[] | undefined

    return {
      user: (rows ?? []).filter((row) => row.role === 'user'),
      assistant: (rows ?? []).filter((row) => row.role === 'assistant')
    }
  } catch (error) {
    console.warn('[DebugMockChatSession] Failed to read message samples:', error)
    return { user: [], assistant: [] }
  }
}

function readModelSample(db: DebugMockChatDatabase): ModelRow {
  try {
    return (
      (db
        .prepare('SELECT provider_id, model_id FROM deepchat_sessions ORDER BY rowid DESC LIMIT 1')
        .get() as ModelRow | undefined) ?? {}
    )
  } catch (error) {
    console.warn('[DebugMockChatSession] Failed to read model sample:', error)
    return {}
  }
}

function buildMessages(now: number, samples: { user: SampleRow[]; assistant: SampleRow[] }) {
  const messages: Array<{
    id: string
    orderSeq: number
    role: 'user' | 'assistant'
    content: string
    metadata: string
    createdAt: number
  }> = []

  for (let index = 1; index <= PAIR_COUNT; index += 1) {
    const createdAt = now + index * 1000
    messages.push({
      id: `debug-user-${index}-${nanoid(8)}`,
      orderSeq: index * 2 - 1,
      role: 'user',
      content: JSON.stringify(buildUserContent(index, samples.user[index % samples.user.length])),
      metadata: '{}',
      createdAt
    })
    messages.push({
      id: `debug-assistant-${index}-${nanoid(8)}`,
      orderSeq: index * 2,
      role: 'assistant',
      content: JSON.stringify(buildAssistantBlocks(index, createdAt + 200, samples.assistant)),
      metadata: JSON.stringify({
        model: 'debug-model',
        provider: 'debug-provider',
        totalTokens: 800 + index * 17,
        outputTokens: 320 + index * 9
      }),
      createdAt: createdAt + 200
    })
  }

  return messages
}

function buildUserContent(index: number, sample?: SampleRow) {
  const marker = markerFor(index)
  const text = [
    `Debug query ${index}: validate virtualized rendering around ${marker}.`,
    `Please include ${SEARCH_NEEDLE}, markdown tables, code, and mixed assistant blocks.`,
    index % 7 === 0 ? 'Also mention spacer height and search counting edge cases.' : ''
  ]
    .filter(Boolean)
    .join('\n')

  const parsed = parseJsonRecord(sample?.content)
  const sampledBlocks = Array.isArray(parsed?.content) ? parsed.content : null

  return {
    files: [],
    links: index % 10 === 0 ? [`https://example.test/debug/${index}`] : [],
    think: index % 3 === 0,
    search: index % 4 === 0,
    text,
    content: sampledBlocks
      ? sampledBlocks
          .slice(0, 4)
          .map((block, blockIndex) => rewriteUserBlock(block, index, blockIndex))
      : [
          { type: 'text', content: text },
          ...(index % 6 === 0
            ? [{ type: 'code', language: 'ts', content: `const round = ${index}` }]
            : [])
        ]
  }
}

function rewriteUserBlock(block: unknown, index: number, blockIndex: number) {
  if (!block || typeof block !== 'object') {
    return { type: 'text', content: `Debug user block ${index}.${blockIndex}` }
  }
  const type = String((block as { type?: unknown }).type ?? 'text')
  if (type === 'code') {
    return {
      type: 'code',
      language: 'ts',
      content: `const searchMarker = '${markerFor(index)}'`
    }
  }
  if (type === 'mention') {
    return {
      type: 'mention',
      id: `debug-mention-${index}`,
      category: 'debug',
      content: `Debug mention ${index}`
    }
  }
  return {
    type: 'text',
    content: `Rewritten sampled query block ${index}.${blockIndex} with ${SEARCH_NEEDLE}.`
  }
}

function buildAssistantBlocks(
  index: number,
  timestamp: number,
  assistantSamples: SampleRow[]
): AssistantBlock[] {
  const sample = assistantSamples[index % assistantSamples.length]
  const sampleTypes = readAssistantBlockTypes(sample?.content)
  const forcedType = ASSISTANT_BLOCK_TYPES[(index - 1) % ASSISTANT_BLOCK_TYPES.length]
  const types = [...new Set<AssistantBlock['type']>([forcedType, ...sampleTypes, 'content'])].slice(
    0,
    4
  )
  return types.map((type, blockIndex) => buildAssistantBlock(type, index, blockIndex, timestamp))
}

function readAssistantBlockTypes(content?: string): AssistantBlock['type'][] {
  const parsed = parseJson(content)
  if (!Array.isArray(parsed)) return []

  return parsed
    .map((block) =>
      block && typeof block === 'object' ? (block as { type?: unknown }).type : null
    )
    .filter((type): type is AssistantBlock['type'] =>
      ASSISTANT_BLOCK_TYPES.includes(type as AssistantBlock['type'])
    )
}

function buildAssistantBlock(
  type: AssistantBlock['type'],
  index: number,
  blockIndex: number,
  timestamp: number
): AssistantBlock {
  const id = `debug-block-${index}-${blockIndex}-${type}`
  const marker = markerFor(index)
  const base = { id, type, status: 'success' as const, timestamp: timestamp + blockIndex }

  if (type === 'reasoning_content') {
    return {
      ...base,
      content: `Checked scroll window boundaries, top spacer math, bottom spacer math, and ${marker}.`,
      reasoning_time: { start: timestamp - 1200, end: timestamp - 100 }
    }
  }

  if (type === 'search') {
    return {
      ...base,
      content: `Synthetic search completed for ${marker}.`,
      extra: {
        total: 2,
        pages: [
          {
            title: `Debug result ${index}`,
            url: `https://example.test/search/${index}`,
            content: `Result body contains ${SEARCH_NEEDLE} and ${marker}.`
          }
        ]
      }
    }
  }

  if (type === 'tool_call') {
    return {
      ...base,
      tool_call: {
        id: `debug-tool-${index}`,
        name: 'debug_fixture.inspect_virtual_window',
        params: JSON.stringify({ round: index, marker }, null, 2),
        response: JSON.stringify(
          { renderedWindow: true, topSpacer: index * 13, bottomSpacer: (PAIR_COUNT - index) * 11 },
          null,
          2
        ),
        server_name: 'debug-fixture'
      }
    }
  }

  if (type === 'action') {
    return {
      ...base,
      action_type: 'question_request',
      content: `Synthetic resolved question for ${marker}.`,
      extra: {
        questionText: `Which validation path should this mock round represent for ${marker}?`,
        questionOptions: [
          { label: 'Scroll window' },
          { label: 'Search count' },
          { label: 'Markdown blocks' }
        ],
        answerText: 'Use all validation paths.'
      }
    }
  }

  if (type === 'image') {
    return {
      ...base,
      content: `One-pixel debug image for ${marker}.`,
      image_data: { data: ONE_PIXEL_PNG, mimeType: 'image/png' }
    }
  }

  if (type === 'artifact-thinking') {
    return {
      ...base,
      content: `Prepared a markdown artifact outline for ${marker}.`,
      artifact: {
        identifier: `debug-artifact-${index}`,
        title: `Debug artifact ${index}`,
        type: 'text/markdown',
        language: 'markdown'
      }
    }
  }

  if (type === 'error') {
    return {
      ...base,
      status: 'error',
      content: `Synthetic recoverable error block for ${marker}.`
    }
  }

  return {
    ...base,
    content: buildMarkdown(index)
  }
}

function buildMarkdown(index: number) {
  const marker = markerFor(index)
  if (index % 5 !== 0) {
    return `Short assistant response ${index}. It includes ${SEARCH_NEEDLE} and ${marker}.`
  }

  return [
    `## Debug response ${index}`,
    '',
    `This long markdown response includes ${SEARCH_NEEDLE} and ${marker}.`,
    '',
    '| Area | Expected |',
    '| --- | --- |',
    '| Visible messages | Only the active window is mounted |',
    '| Search count | Full dataset is matched |',
    '',
    '```ts',
    `const marker = '${marker}'`,
    'const visibleOnly = true',
    '```',
    '',
    '- Mixed markdown paragraph',
    '- List content for height variance',
    '- Final line to make this message taller'
  ].join('\n')
}

function markerFor(index: number) {
  return `windowing-search-target-${String(index).padStart(3, '0')}`
}

function parseJsonRecord(content?: string): Record<string, unknown> | null {
  const parsed = parseJson(content)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null
}

function parseJson(content?: string): unknown {
  if (!content) return null
  try {
    return JSON.parse(content) as unknown
  } catch {
    return null
  }
}
