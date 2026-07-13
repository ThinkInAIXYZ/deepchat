import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: publishDeepchatEventMock
}))

import { McpOAuthManager } from '../../../../src/main/presenter/mcpPresenter/mcpOAuthManager'
import type { McpOAuthCredentialStore } from '../../../../src/main/presenter/mcpPresenter/oauthCredentialStore'

const createStore = (entry: unknown): McpOAuthCredentialStore =>
  ({
    getStorageState: vi.fn(() => 'file'),
    load: vi.fn(() => entry),
    saveEntry: vi.fn(),
    clearEntry: vi.fn(),
    clearEntryScope: vi.fn()
  }) as unknown as McpOAuthCredentialStore

describe('McpOAuthManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps authenticated credentials ahead of stale non-pending errors', async () => {
    const manager = new McpOAuthManager(
      createStore({
        tokens: {
          access_token: 'access-token'
        },
        updatedAt: 123
      })
    )
    const config = {
      type: 'http',
      baseUrl: 'https://mcp.linear.app/mcp'
    }

    manager.handleConnectionError('linear', config, new Error('401 unauthorized'))

    const status = await manager.completeAuthFromCallbackUrl(
      'linear',
      config,
      'http://localhost:3333/callback?code=used&state=used'
    )

    expect(status.state).toBe('authenticated')
    expect(status.authenticated).toBe(true)
    expect(status.error).toBeUndefined()
    expect(publishDeepchatEventMock).toHaveBeenCalledTimes(1)
  })

  it('classifies HTTP status shaped OAuth failures', () => {
    const config = {
      type: 'http',
      baseUrl: 'https://mcp.linear.app/mcp'
    } as const
    const errors = [{ status: 401 }, { httpStatus: 401 }, { response: { status: '401' } }]

    for (const error of errors) {
      const manager = new McpOAuthManager(createStore(null))

      expect(manager.handleConnectionError('linear', config, error)).toBe(true)
      expect(manager.getStatus('linear', config).state).toBe('required')
    }
  })

  it('ignores stale authenticated flows after a newer auth attempt starts', () => {
    const closeStaleSession = vi.fn()
    const closeActiveSession = vi.fn()
    const onAuthenticated = vi.fn()
    const manager = new McpOAuthManager(
      createStore({
        tokens: {
          access_token: 'access-token'
        },
        updatedAt: 123
      }),
      onAuthenticated
    )
    const staleFlow = {
      serverName: 'linear',
      serverUrl: 'https://mcp.linear.app/mcp',
      credentialKey: 'linear-key',
      state: 'old',
      provider: {},
      callbackSession: {
        close: closeStaleSession
      }
    }
    const activeFlow = {
      ...staleFlow,
      state: 'new',
      callbackSession: {
        close: closeActiveSession
      }
    }
    const managerInternals = manager as unknown as {
      pendingFlows: Map<string, unknown>
      finishAuthenticatedFlow: (flow: unknown) => void
    }

    managerInternals.pendingFlows.set('linear', activeFlow)
    managerInternals.finishAuthenticatedFlow(staleFlow)

    expect(closeStaleSession).not.toHaveBeenCalled()
    expect(closeActiveSession).not.toHaveBeenCalled()
    expect(onAuthenticated).not.toHaveBeenCalled()
    expect(publishDeepchatEventMock).not.toHaveBeenCalled()
  })
})
