import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { BuiltinKnowledgeServer } from '../../../../src/main/presenter/mcpPresenter/inMemoryServers/builtinKnowledgeServer'

const serverInstances = vi.hoisted(() => [] as Array<{ handlers: Map<unknown, Function> }>)
const mockGetKnowledgeConfigs = vi.hoisted(() => vi.fn())
const mockSimilarityQuery = vi.hoisted(() => vi.fn())

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn()
}))

vi.mock('@/presenter', () => ({
  presenter: {
    configPresenter: {
      getKnowledgeConfigs: mockGetKnowledgeConfigs
    },
    knowledgePresenter: {
      similarityQuery: mockSimilarityQuery
    }
  }
}))

const createKnowledgeConfig = (id: string, enabled = true) => ({
  id,
  description: `Search ${id}`,
  embedding: {
    providerId: 'openai',
    modelId: 'text-embedding-3-small'
  },
  dimensions: 1536,
  normalized: true,
  fragmentsNumber: 6,
  enabled
})

describe('BuiltinKnowledgeServer', () => {
  beforeEach(() => {
    serverInstances.length = 0
    ;(
      Server as unknown as {
        mockImplementation: (factory: () => unknown) => void
      }
    ).mockImplementation(() => {
      const instance = {
        handlers: new Map<unknown, Function>(),
        connect: vi.fn(),
        setRequestHandler: vi.fn((schema: unknown, handler: Function) => {
          instance.handlers.set(schema, handler)
        })
      }
      serverInstances.push(instance)
      return instance
    })
    mockGetKnowledgeConfigs.mockReset()
    mockSimilarityQuery.mockReset()
    mockGetKnowledgeConfigs.mockReturnValue([])
  })

  it('starts without env configs', async () => {
    new BuiltinKnowledgeServer()

    const handler = serverInstances[0].handlers.get(ListToolsRequestSchema)
    await expect(handler?.()).resolves.toEqual({ tools: [] })
  })

  it('lists tools from enabled ConfigPresenter knowledge configs', async () => {
    mockGetKnowledgeConfigs.mockReturnValue([
      createKnowledgeConfig('knowledge-1', true),
      createKnowledgeConfig('knowledge-2', false),
      createKnowledgeConfig('knowledge-3', true)
    ])
    new BuiltinKnowledgeServer()

    const handler = serverInstances[0].handlers.get(ListToolsRequestSchema)
    const result = await handler?.()

    expect(result.tools).toEqual([
      expect.objectContaining({
        name: 'builtin_knowledge_search_1',
        description: 'Search knowledge-1'
      }),
      expect.objectContaining({
        name: 'builtin_knowledge_search_2',
        description: 'Search knowledge-3'
      })
    ])
  })

  it('calls similarityQuery for the selected enabled knowledge config', async () => {
    mockGetKnowledgeConfigs.mockReturnValue([createKnowledgeConfig('knowledge-1', true)])
    mockSimilarityQuery.mockResolvedValue([
      {
        id: 'result-1',
        metadata: {
          content: 'Matched content',
          filePath: 'doc.md'
        },
        distance: 0.2
      }
    ])
    new BuiltinKnowledgeServer()

    const handler = serverInstances[0].handlers.get(CallToolRequestSchema)
    const result = await handler?.({
      params: {
        name: 'builtin_knowledge_search',
        arguments: {
          query: 'hello'
        }
      }
    })

    expect(mockSimilarityQuery).toHaveBeenCalledWith('knowledge-1', 'hello')
    expect(result.content[0].text).toContain('Matched content')
  })
})
