import { describe, expect, it, vi } from 'vitest'

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
})
