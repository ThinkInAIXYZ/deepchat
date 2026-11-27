import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { JsonValue } from '@shared/contracts/json'
import { DimMethodError } from '@/agent/dim/pluginClient'
import { DimSessionRuntime } from '@/agent/dim/sessionRuntime'
import { SessionBusyError } from '@/session/turn'

function createRuntimeHarness(callImpl: (method: string, params: JsonValue) => Promise<unknown>) {
  const binding = {
    sessionId: 'session-1',
    dimSessionId: 'dim-session-1',
    branchId: 'main',
    cursor: '0',
    projectionVersion: 1,
    activeTurnId: null,
    createdAt: 1,
    updatedAt: 1
  }
  const client = Object.assign(new EventEmitter(), {
    call: vi.fn(async (method: string, params: JsonValue = {}) => {
      if (method === 'deepchat.host.subscribe') return { watchId: 'watch-1' }
      if (method === 'deepchat.storage.history') return { through: 0, events: [] }
      return await callImpl(method, params)
    })
  })
  const intents = {
    begin: vi.fn((input: Record<string, unknown>) => ({
      created: true,
      intent: { ...input, state: 'pending', receipt: null }
    })),
    pending: vi.fn(() => []),
    get: vi.fn(() => null),
    settle: vi.fn()
  }
  const database = {
    dimSessionBindingsTable: {
      get: vi.fn(() => binding),
      upsert: vi.fn(),
      updateCursor: vi.fn()
    },
    dimInputIntentsTable: intents
  }
  const runtime = new DimSessionRuntime({
    database: database as never,
    host: {
      usesNativePlugins: true,
      start: vi.fn(async () => client)
    } as never,
    launch: vi.fn(async () => ({})),
    projected: vi.fn(),
    failed: vi.fn()
  })
  return { runtime, client, intents }
}

describe('DimSessionRuntime busy and submission cancellation', () => {
  it('maps session_busy RPC error to SessionBusyError and settles intent as rejected', async () => {
    const { runtime, client, intents } = createRuntimeHarness(async (method) => {
      if (method === 'session.deepchat_inputs.submit') {
        throw new DimMethodError(-32000, 'Session is currently busy', {
          appError: 'session_busy'
        })
      }
      return {}
    })

    await expect(
      runtime.submit('session-1', [{ type: 'text', text: 'Cron prompt' }], {
        submissionId: 'cron-run-1',
        requireIdle: true
      })
    ).rejects.toBeInstanceOf(SessionBusyError)

    expect(client.call).toHaveBeenCalledWith(
      'session.deepchat_inputs.submit',
      expect.objectContaining({
        sessionId: 'dim-session-1',
        branchId: 'main',
        requireIdle: true
      })
    )
    expect(intents.settle).toHaveBeenCalledWith('cron-run-1', 'rejected')
  })

  it('forwards namespaced submissionId to cancel_submission and returns host result', async () => {
    let cancelled = true
    const { runtime, client } = createRuntimeHarness(async (method) => {
      if (method === 'session.deepchat_inputs.cancel_submission') {
        return { cancelled }
      }
      return {}
    })

    await expect(runtime.cancelSubmission('session-1', 'cron-run-1', 'timeout')).resolves.toBe(true)
    expect(client.call).toHaveBeenCalledWith('session.deepchat_inputs.cancel_submission', {
      sessionId: 'dim-session-1',
      branchId: 'main',
      submissionId: 'desktop:"session-1":cron-run-1',
      reason: 'timeout'
    })

    cancelled = false
    await expect(runtime.cancelSubmission('session-1', 'cron-run-1')).resolves.toBe(false)
  })
})
