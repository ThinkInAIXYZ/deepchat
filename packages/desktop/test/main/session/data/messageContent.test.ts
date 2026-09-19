import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import { Database, nativeSqliteDescribeIf } from '../../nativeSqliteHarness'
import {
  assembleUserContent,
  canonicalizeMessageContent,
  parseAssistantBlocks,
  toAssistantBlock,
  toMessageFile,
  toUserMessageFileRowInput
} from '@/session/data/messageContent'

const tables = Database
  ? {
      DeepChatUserMessagesTable: (await import('@/session/data/tables/deepchatUserMessages'))
        .DeepChatUserMessagesTable,
      DeepChatUserMessageFilesTable: (
        await import('@/session/data/tables/deepchatUserMessageFiles')
      ).DeepChatUserMessageFilesTable,
      DeepChatUserMessageLinksTable: (
        await import('@/session/data/tables/deepchatUserMessageLinks')
      ).DeepChatUserMessageLinksTable,
      DeepChatAssistantBlocksTable: (await import('@/session/data/tables/deepchatAssistantBlocks'))
        .DeepChatAssistantBlocksTable
    }
  : null

const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(tables),
  'transcript table modules need the native SQLite module'
)

const MESSAGE_ID = 'm1'
const UPDATED_AT = 1_700_000_000_000

const USER_CONTENT = JSON.stringify({
  text: 'summarise the attached report',
  files: [
    {
      name: 'report.pdf',
      path: '/tmp/report.pdf',
      type: 'application/pdf',
      size: 2048,
      content: 'extracted text',
      token: 512,
      thumbnail: 'data:image/png;base64,AAA',
      requestedRepresentation: 'text',
      pdfTextCoverage: { sampledPages: 2, pagesWithText: 2, textCharacterCount: 900 },
      metadata: { fileName: 'report.pdf', fileSize: 2048, pageCount: 3 }
    },
    { name: '', path: '/tmp/no-metadata.bin' }
  ],
  links: ['https://example.com/a', 'https://example.com/b'],
  search: true,
  think: false,
  activeSkills: ['  pdf ', 'pdf', 'write', ''],
  inlineItems: [{ type: 'skill', offset: 0, skillName: 'pdf' }]
})

const ASSISTANT_BLOCKS: AssistantMessageBlock[] = [
  {
    type: 'reasoning_content',
    content: 'thinking',
    status: 'success',
    timestamp: 1,
    reasoning_time: { start: 1, end: 5 }
  },
  {
    type: 'reasoning_content',
    content: 'more',
    status: 'success',
    timestamp: 2,
    reasoning_time: 4 as never
  },
  { type: 'content', content: 'Here is the answer.', status: 'success', timestamp: 3, id: 'b3' },
  {
    type: 'tool_call',
    status: 'success',
    timestamp: 4,
    tool_call: {
      id: 'tc1',
      name: 'search',
      params: '{"q":"x"}',
      response: 'result',
      rtkApplied: true,
      rtkMode: 'rewrite',
      imagePreviews: [{ mimeType: 'image/png', data: 'AAA' }] as never,
      server_name: 'web',
      server_icons: 'icon',
      server_description: 'search the web'
    }
  },
  {
    type: 'image',
    status: 'success',
    timestamp: 5,
    image_data: { data: 'BBB', mimeType: 'image/png' }
  },
  {
    type: 'action',
    status: 'pending',
    timestamp: 6,
    action_type: 'tool_call_permission',
    tool_call: { id: 'tc2', name: 'write_file' },
    extra: { needsUserAction: true, permissionType: 'write', toolName: 'write_file' }
  },
  { type: 'error', content: 'boom', status: 'error' } as AssistantMessageBlock
]

describeIfSqlite('canonicalizeMessageContent matches the transcript tables', () => {
  let db: InstanceType<NonNullable<typeof Database>>

  beforeEach(() => {
    db = new Database!(':memory:')
    vi.useFakeTimers()
    vi.setSystemTime(UPDATED_AT)
  })

  afterEach(() => {
    vi.useRealTimers()
    db.close()
  })

  it('reproduces user content after the user tables persist and read it back', () => {
    const users = new tables!.DeepChatUserMessagesTable(db)
    const files = new tables!.DeepChatUserMessageFilesTable(db)
    const links = new tables!.DeepChatUserMessageLinksTable(db)
    for (const table of [users, files, links]) table.createTable()

    const parsed = JSON.parse(USER_CONTENT)
    users.upsert({
      messageId: MESSAGE_ID,
      text: parsed.text,
      searchEnabled: parsed.search === true,
      thinkEnabled: parsed.think === true
    })
    files.replaceForMessage(MESSAGE_ID, parsed.files.map(toUserMessageFileRowInput))
    links.replaceForMessage(MESSAGE_ID, parsed.links)

    const userRow = users.get(MESSAGE_ID)!
    const stored = assembleUserContent({
      text: userRow.text,
      files: files.listByMessageIds([MESSAGE_ID]).map(toMessageFile),
      links: links.listByMessageIds([MESSAGE_ID]).map((row) => row.url),
      search: userRow.search_enabled === 1,
      think: userRow.think_enabled === 1,
      activeSkills: ['pdf', 'write'],
      inlineItems: parsed.inlineItems
    })

    const canonical = canonicalizeMessageContent('user', USER_CONTENT, UPDATED_AT)
    expect(canonical).toBe(stored)
    expect(canonicalizeMessageContent('user', canonical, UPDATED_AT)).toBe(canonical)
    expect(JSON.parse(canonical).activeSkills).toEqual(['pdf', 'write'])
  })

  it('reproduces assistant content after the block table persists and reads it back', () => {
    const blocks = new tables!.DeepChatAssistantBlocksTable(db)
    blocks.createTable()
    const raw = JSON.stringify(ASSISTANT_BLOCKS)

    blocks.replaceForMessage(MESSAGE_ID, parseAssistantBlocks(raw))
    const stored = JSON.stringify(blocks.listByMessageId(MESSAGE_ID).map(toAssistantBlock))

    const canonical = canonicalizeMessageContent('assistant', raw, UPDATED_AT)
    expect(canonical).toBe(stored)
    expect(canonicalizeMessageContent('assistant', canonical, UPDATED_AT)).toBe(canonical)
    // A block that arrived without a timestamp reports the write time once persisted.
    expect(JSON.parse(canonical).at(-1).timestamp).toBe(UPDATED_AT)
  })
})

describe('canonicalizeMessageContent without structured rows', () => {
  it('returns content the tables would not structure unchanged', () => {
    expect(canonicalizeMessageContent('user', 'plain text', 1)).toBe('plain text')
    expect(canonicalizeMessageContent('assistant', '[]', 1)).toBe('[]')
    expect(canonicalizeMessageContent('assistant', '{"not":"an array"}', 1)).toBe(
      '{"not":"an array"}'
    )
  })
})
