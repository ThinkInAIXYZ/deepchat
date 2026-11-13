import { expect, it, vi } from 'vitest'
import type { DimContent } from '@/agent/dim/content'
import { DimProductContext } from '@/agent/dim/productContext'
import { dimDatabase } from './fixtures/database'

it('requires the current native step before reading product context and fences a changed generation', async () => {
  const database = dimDatabase()
  const binding = database.data.dimSessionBindingsTable.bind('product', 'native')
  const request = {
    sessionId: 'native',
    turnId: 'turn',
    requestId: 'request',
    through: '9007199254740993',
    providerId: 'provider',
    modelId: 'model',
    query: 'question'
  }
  const latest = vi.fn<DimContent['latest']>(async () => ({
    through: '9007199254740994',
    event: {
      id: 'event',
      sequence: '9007199254740994',
      create_at: 1,
      type: 'model',
      name: 'start',
      data: { turn_id: 'turn', request_id: 'request' }
    }
  }))
  const prepare = vi.fn(async () => ({
    messages: [{ role: 'user' as const, content: 'authorized context' }]
  }))
  const authorize = vi.fn()
  const context = new DimProductContext({
    database: database.data,
    content: { latest },
    authorize,
    prepare
  })
  const signal = new AbortController().signal
  try {
    await expect(
      context.prepare({ ...request, requestId: 'other-branch-request' }, signal)
    ).rejects.toThrow('no longer current')
    expect(prepare).not.toHaveBeenCalled()
    expect(await context.prepare(request, signal)).toEqual({
      messages: [{ role: 'user', content: 'authorized context' }]
    })
    expect(latest.mock.calls[0][0]).toEqual({ sessionId: 'native', branchId: 'main' })
    const ownedPaths = [
      '/current/dimcode.sqlite.session-files/11111111-1111-4111-8111-111111111111',
      '/current/dimcode.sqlite.session-files/22222222-2222-4222-8222-222222222222',
      'C:\\data\\dimcode.sqlite.session-files\\33333333-3333-4333-8333-333333333333',
      '/current/command-output/44444444-4444-4444-8444-444444444444/task.log',
      '/workspace/output.txt'
    ]
    const fileContext = new DimProductContext({
      database: database.data,
      content: { latest },
      authorize,
      prepare,
      resolve: async () => ({
        binding,
        description: {
          sessionId: 'native',
          origin: 'client',
          parentSessionId: null,
          cwd: '/current',
          model: { providerId: 'provider', modelId: 'model' },
          role: 'leader',
          tools: null,
          title: null,
          titleRevision: '0',
          ownedPaths
        },
        ref: { sessionId: 'native', branchId: 'main' },
        acceptedInput: {
          query: 'accepted input',
          hookPrompt: 'accepted input',
          hookPromptTooLarge: false
        },
        assertCurrent: () => {}
      })
    })
    const withFiles = await fileContext.prepare(request, signal)
    expect(prepare).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ query: 'accepted input', hookPrompt: 'accepted input' }),
      signal
    )
    expect(withFiles.messages).toHaveLength(2)
    expect(withFiles.messages[0]).toEqual({ role: 'user', content: 'authorized context' })
    expect(withFiles.messages[1]).toMatchObject({
      role: 'user',
      content: expect.stringContaining(
        JSON.stringify([
          '/current/dimcode.sqlite.session-files',
          'C:\\data\\dimcode.sqlite.session-files',
          '/current/command-output'
        ])
      )
    })

    prepare.mockImplementation(async () => {
      database.data.dimSessionBindingsTable.replace(binding, {
        ...binding,
        dimSessionId: 'replacement',
        generation: 2
      })
      return { messages: [{ role: 'user', content: 'old scope context' }] }
    })
    await expect(context.prepare(request, signal)).rejects.toThrow('replaced session')
    await expect(context.prepare(request, signal)).rejects.toThrow('no current desktop binding')
  } finally {
    database.sqlite.close()
  }
})
