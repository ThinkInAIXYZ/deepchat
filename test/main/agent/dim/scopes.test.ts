import { expect, it, vi } from 'vitest'
import { DimScopes, type DimScopeDescription } from '@/agent/dim/scopes'
import type { DimPluginClient } from '@/agent/dim/pluginClient'
import { dimDatabase } from './fixtures/database'

const description = (sessionId: string, parentSessionId: string | null): DimScopeDescription => ({
  sessionId,
  origin: parentSessionId ? 'internal' : 'client',
  parentSessionId,
  cwd: '/workspace',
  model: { providerId: 'provider', modelId: 'model' },
  role: parentSessionId ? 'member' : 'leader',
  tools: null,
  title: null,
  titleRevision: '0'
})
const request = {
  sessionId: 'child',
  turnId: 'turn',
  requestId: 'request',
  through: '18446744073709551614',
  providerId: 'provider',
  modelId: 'model',
  query: 'task'
}

it('fences a bound root preference without starting or reading native sessions', () => {
  const { data, sqlite } = dimDatabase()
  const start = vi.fn()
  try {
    data.dimSessionBindingsTable.bind('desktop', 'root')
    const scopes = new DimScopes({ database: data, host: { start } })
    const signal = new AbortController().signal
    expect(scopes.bound('unknown', signal)).toBeNull()
    const owner = scopes.bound('root', signal)!
    expect(owner.binding.sessionId).toBe('desktop')
    data.dimSessionBindingsTable.delete('desktop')
    expect(() => owner.assertCurrent()).toThrow('replaced desktop scope')
    expect(start).not.toHaveBeenCalled()
  } finally {
    sqlite.close()
  }
})

it('authorizes native descendants from stored parentage and the actual request branch', async () => {
  const { data, sqlite } = dimDatabase()
  try {
    const root = data.dimSessionBindingsTable.bind('desktop', 'root')
    const call = vi.fn(async (method: string, params: { sessionId: string }) => {
      if (method === 'deepchat.storage.scope')
        return description(params.sessionId, params.sessionId === 'child' ? 'root' : null)
      return {
        branchId: 'work',
        through: '18446744073709551615',
        sequence: '18446744073709551615',
        inputQuery: 'accepted task',
        hookPrompt: 'accepted task',
        hookPromptTooLarge: false
      }
    })
    const scopes = new DimScopes({
      database: data,
      host: { start: async () => ({ call }) as unknown as DimPluginClient }
    })
    const authorized = await scopes.context(request, new AbortController().signal)
    expect(authorized.binding).toEqual(root)
    expect(authorized.ref).toEqual({ sessionId: 'child', branchId: 'work' })
    expect(authorized.acceptedInput).toEqual({
      query: 'accepted task',
      hookPrompt: 'accepted task',
      hookPromptTooLarge: false
    })
    expect(call).toHaveBeenLastCalledWith('session.deepchat_scope.frame', {
      sessionId: 'child',
      turnId: 'turn',
      requestId: 'request'
    })
    data.dimSessionBindingsTable.delete('desktop')
    expect(() => authorized.assertCurrent()).toThrow('replaced desktop scope')
  } finally {
    sqlite.close()
  }
})

it('denies unowned client sessions, cyclic links and retired native ancestors', async () => {
  const { data, sqlite } = dimDatabase()
  try {
    let parent: string | null = null
    const call = vi.fn(async (_method: string, params: { sessionId: string }) =>
      description(params.sessionId, parent)
    )
    const scopes = new DimScopes({
      database: data,
      host: { start: async () => ({ call }) as unknown as DimPluginClient }
    })
    await expect(scopes.context(request, new AbortController().signal)).rejects.toThrow(
      'no current desktop owner'
    )
    parent = 'child'
    await expect(scopes.context(request, new AbortController().signal)).rejects.toThrow('cycle')
    parent = 'retired-root'
    call.mockImplementation(async (_method, params) =>
      description(params.sessionId, params.sessionId === 'child' ? parent : null)
    )
    data.dimSessionBindingsTable.bind('desktop', 'new-root')
    await expect(scopes.context(request, new AbortController().signal)).rejects.toThrow(
      'no current desktop owner'
    )
  } finally {
    sqlite.close()
  }
})
