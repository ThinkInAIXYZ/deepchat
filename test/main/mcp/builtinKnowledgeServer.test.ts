import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Server } from '@modelcontextprotocol/server'
import { BuiltinKnowledgeServer } from '@/mcp/inMemoryServers/builtinKnowledgeServer'

const serverInstances = vi.hoisted(() => [] as Array<{ handlers: Map<string, Function> }>)
const mockGetKnowledgeConfigs = vi.hoisted(() => vi.fn())
const mockSimilarityQuery = vi.hoisted(() => vi.fn())

vi.mock('@modelcontextprotocol/server', () => ({
  Server: vi.fn()
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

const createServer = () =>
  new BuiltinKnowledgeServer(
    { getKnowledgeConfigs: mockGetKnowledgeConfigs } as any,
    { similarityQuery: mockSimilarityQuery } as any
  )

describe('BuiltinKnowledgeServer', () => {
  beforeEach(() => {
    serverInstances.length = 0
    ;(
      Server as unknown as {
        mockImplementation: (factory: () => unknown) => void
      }
    ).mockImplementation(() => {
      const instance = {
        handlers: new Map<string, Function>(),
        connect: vi.fn(),
        setRequestHandler: vi.fn((method: string, handler: Function) => {
          instance.handlers.set(method, handler)
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
    createServer()

    const handler = serverInstances[0].handlers.get('tools/list')
    await expect(handler?.()).resolves.toEqual({ tools: [] })
  })

  it('lists tools from enabled ProviderSettings knowledge configs', async () => {
    mockGetKnowledgeConfigs.mockReturnValue([
      createKnowledgeConfig('knowledge-1', true),
      createKnowledgeConfig('knowledge-2', false),
      createKnowledgeConfig('knowledge-3', true)
    ])
    createServer()

    const handler = serverInstances[0].handlers.get('tools/list')
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
    createServer()

    const handler = serverInstances[0].handlers.get('tools/call')
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
