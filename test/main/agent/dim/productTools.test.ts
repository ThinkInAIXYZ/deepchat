import { describe, expect, it, vi } from 'vitest'
import { TOOL_EXECUTION } from '@shared/types/mcp'
import { DimProductTools, type DimDesktopTool } from '@/agent/dim/productTools'
import { DimScopes, type DimScopeDescription } from '@/agent/dim/scopes'
import type { DimPluginClient } from '@/agent/dim/pluginClient'
import { dimDatabase } from './fixtures/database'

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
