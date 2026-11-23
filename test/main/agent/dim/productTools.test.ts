import { describe, expect, it, vi } from 'vitest'
import { TOOL_EXECUTION } from '@shared/types/mcp'
import { DimProductTools, type DimDesktopTool } from '@/agent/dim/productTools'
import { DimScopes, type DimScopeDescription } from '@/agent/dim/scopes'
import type { DimPluginClient } from '@/agent/dim/pluginClient'
import { createDimDesktopTools } from '@/app/dimDesktopTools'
import { dimDatabase } from './fixtures/database'

it.each([true, false])('bridges browser screenshots as images for vision=%s', async (vision) => {
  const data = Buffer.from('fixture screenshot bytes').toString('base64')
  const supportsVision = vi.fn(async () => vision)
  const catalog = createDimDesktopTools({
    desktop: {
      getAllToolDefinitions: async () => [
        {
          type: 'function',
          execution: TOOL_EXECUTION.write,
          function: {
            name: 'cdp_send',
            description: '',
            parameters: { type: 'object', properties: {} }
          },
          server: { name: 'yobrowser', icons: '', description: '' }
        }
      ],
      callTool: async () => ({ content: JSON.stringify({ data }) })
    },
    mcp: { getAllToolDefinitions: async () => [], callTool: vi.fn() },
    cacheImage: vi.fn(async () => 'imgcache://screenshot.webp'),
    supportsVision,
    selection: async () => ({ agentId: 'deepchat', disabled: [], bridgeServerNames: [] })
  })
  const { data: database, sqlite } = dimDatabase()
  try {
    const binding = database.dimSessionBindingsTable.bind('desktop', 'native')
    const [tool] = await catalog(binding)
    const result = await tool.execute(
      {
        sessionId: 'native',
        branchId: binding.branchId,
        turnId: 'turn',
        callId: 'capture',
        name: 'cdp_send',
        arguments: { method: 'Page.captureScreenshot', params: { format: 'webp' } }
      },
      new AbortController().signal
    )
    expect(supportsVision).toHaveBeenCalledWith('native')
    expect(result.content).toEqual(
      vision
        ? [{ type: 'image', source: { type: 'base64', mediaType: 'image/webp', data } }]
        : 'Screenshot captured. The current model cannot view images.'
    )
    expect(result.structuredContent).toEqual({
      deepchatDisplay: {
        response: 'Screenshot captured.',
        imagePreviews: [
          {
            id: 'screenshot-1',
            data: 'imgcache://screenshot.webp',
            mimeType: 'image/webp',
            title: 'Page.captureScreenshot',
            source: 'screenshot'
          }
        ]
      }
    })
  } finally {
    sqlite.close()
  }
})

describe('desktop capability scope', () => {
  it('rejects a retired scope after asynchronous authorization', async () => {
    const { data, sqlite } = dimDatabase()
    try {
      data.dimSessionBindingsTable.bind('desktop', 'native')
      let release!: () => void
      const authorized = new Promise<void>((resolve) => {
        release = resolve
      })
      const catalog = vi.fn(async () => [])
      const tools = new DimProductTools({
        database: data,
        authorize: () => authorized,
        catalog
      })
      const resolving = tools.resolve('native')
      data.dimSessionBindingsTable.delete('desktop')
      release()
      await expect(resolving).rejects.toThrow('replaced native scope')
      expect(catalog).not.toHaveBeenCalled()
    } finally {
      sqlite.close()
    }
  })

  it('inherits desktop capabilities only through native parentage and the current root generation', async () => {
    const { data, sqlite } = dimDatabase()
    try {
      data.dimSessionBindingsTable.bind('desktop', 'root')
      const execute = vi.fn(async () => ({ content: 'child result' }))
      const scopes = new DimScopes({
        database: data,
        host: {
          start: async () =>
            ({
              call: async (_method: string, input: { sessionId: string }) =>
                ({
                  sessionId: input.sessionId,
                  origin: input.sessionId === 'child' ? 'internal' : 'client',
                  parentSessionId: input.sessionId === 'child' ? 'root' : null,
                  cwd: '/workspace',
                  model: { providerId: 'provider', modelId: 'model' },
                  role: 'member',
                  tools: null,
                  title: null,
                  titleRevision: '0'
                }) satisfies DimScopeDescription
            }) as unknown as DimPluginClient
        }
      })
      const tools = new DimProductTools({
        database: data,
        owner: scopes.owner,
        authorize: () => {},
        catalog: async () => [
          {
            definition: {
              type: 'function',
              execution: TOOL_EXECUTION.write,
              function: {
                name: 'desktop_echo',
                description: '',
                parameters: { type: 'object', properties: {} }
              },
              server: { name: 'desktop', icons: '', description: '' }
            },
            risk: 'session',
            execute
          }
        ]
      })
      const child = await tools.resolve('child')
      expect(child.version).not.toBe((await tools.resolve('root')).version)
      const call = {
        sessionId: 'child',
        branchId: 'work',
        turnId: 'turn',
        callId: 'call',
        name: 'desktop_echo',
        arguments: {}
      }
      await expect(child.execute(call, new AbortController().signal)).resolves.toEqual({
        content: 'child result'
      })
      await expect(
        child.execute({ ...call, sessionId: 'root' }, new AbortController().signal)
      ).rejects.toThrow('another native execution scope')
      await expect(tools.resolve('unowned')).rejects.toThrow('no current desktop owner')
      data.dimSessionBindingsTable.delete('desktop')
      await expect(child.execute(call, new AbortController().signal)).rejects.toThrow(
        'replaced desktop scope'
      )
      expect(execute).toHaveBeenCalledOnce()
    } finally {
      sqlite.close()
    }
  })

  it('versions a changed desktop MCP binding and fences execution to its native branch', async () => {
    const { data, sqlite } = dimDatabase()
    try {
      data.dimSessionBindingsTable.bind('desktop', 'native')
      const execute = vi.fn(async () => ({ content: 'desktop result' }))
      let generation = 1
      const entry = (): DimDesktopTool => ({
        definition: {
          type: 'function',
          execution: TOOL_EXECUTION.write,
          function: {
            name: 'deepchat_fixture',
            description: 'Desktop fixture',
            parameters: { type: 'object', properties: {} }
          },
          server: { name: 'plugin', icons: '', description: '', configGeneration: generation }
        },
        risk: 'session',
        execute
      })
      const tools = new DimProductTools({
        database: data,
        authorize: () => {},
        catalog: async () => [entry()]
      })
      const first = await tools.resolve('native')
      generation++
      expect((await tools.resolve('native')).version).not.toBe(first.version)
      const call = {
        sessionId: 'native',
        branchId: 'foreign',
        turnId: 'turn',
        callId: 'call',
        name: 'deepchat_fixture',
        arguments: {}
      }
      await expect(first.execute(call, new AbortController().signal)).rejects.toThrow(
        'another native execution scope'
      )
      expect(execute).not.toHaveBeenCalled()
      data.dimSessionBindingsTable.delete('desktop')
      await expect(
        first.execute({ ...call, branchId: 'main' }, new AbortController().signal)
      ).rejects.toThrow('replaced native scope')
      expect(execute).not.toHaveBeenCalled()
    } finally {
      sqlite.close()
    }
  })
})
