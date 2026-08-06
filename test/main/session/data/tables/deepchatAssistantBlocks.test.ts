import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { McpAppDescriptor } from '@shared/types/mcp'
import { expect, it } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../../../nativeSqliteHarness'
import { createDeepSeekReplayJson } from '../../../../fixtures/deepseekResponses'
import { createDeepSeekResponsesReplayProjector } from '@/provider/deepseekResponsesAdapter'

const tableModule = Database ? await import('@/session/data/tables/deepchatAssistantBlocks') : null

const DeepChatAssistantBlocksTable = tableModule?.DeepChatAssistantBlocksTable
const DatabaseCtor = Database!
const DeepChatAssistantBlocksTableCtor = DeepChatAssistantBlocksTable!
const describeIfSqlite = nativeSqliteDescribeIf(
  Boolean(DeepChatAssistantBlocksTable),
  'DeepChatAssistantBlocksTable native module is unavailable'
)

describeIfSqlite('DeepChatAssistantBlocksTable MCP App source binding', () => {
  const descriptor: McpAppDescriptor = {
    schemaVersion: 1,
    serverId: '6a8f9230-8ff8-4a64-b6a3-91fba8a3fa37',
    configGeneration: 2,
    bindingHash: 'binding',
    serverName: 'fixture',
    toolName: 'render_chart',
    resourceUri: 'ui://chart/index.html',
    resourceMimeType: 'text/html;profile=mcp-app'
  }

  function createTable() {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatAssistantBlocksTableCtor(db)
    table.createTable()
    return { db, table }
  }

  function createBlock(
    overrides: Partial<NonNullable<AssistantMessageBlock['tool_call']>> = {}
  ): AssistantMessageBlock {
    return {
      id: 'block-1',
      type: 'tool_call',
      status: 'success',
      timestamp: 100,
      tool_call: {
        id: 'call-1',
        name: 'mcp_fixture_render_chart',
        params: JSON.stringify({ series: [1, 2, 3] }),
        response: 'done',
        mcpResult: {
          schemaVersion: 1,
          serverId: descriptor.serverId,
          configGeneration: descriptor.configGeneration,
          bindingHash: descriptor.bindingHash,
          toolName: descriptor.toolName,
          app: descriptor
        },
        ...overrides
      }
    }
  }

  it('matches only the exact persisted descriptor and tool input', () => {
    const { db, table } = createTable()
    table.replaceForMessage('message-1', [createBlock()])

    expect(
      table.matchesMcpAppSource('message-1', 'block-1', descriptor, {
        series: [1, 2, 3]
      })
    ).toBe(true)
    expect(
      table.matchesMcpAppSource(
        'message-1',
        'block-1',
        { ...descriptor, bindingHash: 'different' },
        { series: [1, 2, 3] }
      )
    ).toBe(false)
    expect(
      table.matchesMcpAppSource('message-1', 'block-1', descriptor, {
        series: [3, 2, 1]
      })
    ).toBe(false)

    db.close()
  })

  it('fails closed for a different block or malformed persisted input', () => {
    const { db, table } = createTable()
    table.replaceForMessage('message-1', [createBlock()])

    expect(
      table.matchesMcpAppSource('message-1', 'block-2', descriptor, {
        series: [1, 2, 3]
      })
    ).toBe(false)

    db.prepare(
      `UPDATE deepchat_assistant_blocks
       SET tool_params = ?
       WHERE message_id = ? AND block_index = ?`
    ).run('{', 'message-1', 0)

    expect(
      table.matchesMcpAppSource('message-1', 'block-1', descriptor, {
        series: [1, 2, 3]
      })
    ).toBe(false)

    db.close()
  })

  it('uses the tool call ID when the persisted block has no block ID', () => {
    const { db, table } = createTable()
    const block = createBlock()
    delete block.id
    table.replaceForMessage('message-1', [block])
    const toolInput = { series: [1, 2, 3] }

    expect(table.matchesMcpAppSource('message-1', 'call-1', descriptor, toolInput)).toBe(true)
    expect(
      table.updateMcpAppModelContext('message-1', 'call-1', descriptor, toolInput, {
        approvedHash: 'approved'
      })
    ).toBe(true)

    db.close()
  })

  it('updates model context only for the exact persisted source', () => {
    const { db, table } = createTable()
    table.replaceForMessage('message-1', [createBlock()])
    const modelContext = {
      content: [{ type: 'text' as const, text: 'Approved chart summary' }],
      approvedHash: 'approved'
    }

    expect(
      table.updateMcpAppModelContext(
        'message-1',
        'block-1',
        { ...descriptor, bindingHash: 'different' },
        { series: [1, 2, 3] },
        modelContext
      )
    ).toBe(false)
    expect(
      table.updateMcpAppModelContext(
        'message-1',
        'block-1',
        descriptor,
        { series: [3, 2, 1] },
        modelContext
      )
    ).toBe(false)
    expect(
      table.updateMcpAppModelContext(
        'message-1',
        'block-1',
        descriptor,
        { series: [1, 2, 3] },
        modelContext
      )
    ).toBe(true)

    const [persisted] = table.listByMessageId('message-1')
    const extra = JSON.parse(persisted.extra_json ?? '{}') as {
      toolCallExtra?: {
        mcpResult?: {
          modelContext?: typeof modelContext
        }
      }
    }
    expect(extra.toolCallExtra?.mcpResult?.modelContext).toEqual(modelContext)

    db.close()
  })
})

describeIfSqlite('DeepChatAssistantBlocksTable provider replay persistence', () => {
  it('round-trips an opaque replay envelope through extra_json into the real projector', () => {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatAssistantBlocksTableCtor(db)
    table.createTable()
    const providerReplayJson = createDeepSeekReplayJson('persisted query')
    table.replaceForMessage('message-1', [
      {
        id: 'ws_1',
        type: 'search',
        content: 'persisted query',
        status: 'success',
        timestamp: 100,
        extra: {
          actionType: 'search',
          providerReplayJson
        }
      }
    ])

    const [row] = table.listByMessageId('message-1')
    const persisted = JSON.parse(row?.extra_json ?? '{}') as {
      extra?: { providerReplayJson?: string }
    }
    const projector = createDeepSeekResponsesReplayProjector({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1'
    })

    expect(persisted.extra?.providerReplayJson).toBe(providerReplayJson)
    expect(projector?.(persisted.extra?.providerReplayJson ?? '')).toEqual({
      markerId: 'ws_1',
      payload: providerReplayJson
    })
    db.close()
  })
})
