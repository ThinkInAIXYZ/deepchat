import { describe, expect, it, vi } from 'vitest'
import { McpAppSandboxRegistry } from '@/mcp/apps/sandboxRegistry'
import type { McpAppDescriptor } from '@shared/types/mcp'

const descriptor: McpAppDescriptor = {
  schemaVersion: 1,
  serverId: 'server-id',
  configGeneration: 1,
  bindingHash: 'binding-hash',
  serverName: 'apps-server',
  toolName: 'render',
  resourceUri: 'ui://render/index.html',
  resourceMimeType: 'text/html;profile=mcp-app'
}

const createInstance = (
  registry: McpAppSandboxRegistry,
  validateLive: () => boolean = () => true
) =>
  registry.create({
    context: { webContentsId: 7, windowId: 11 },
    conversationId: 'conversation-id',
    messageId: 'message-id',
    blockId: 'block-id',
    descriptor,
    toolInput: {},
    html: '<main>App</main>',
    permissions: { camera: {} },
    validateLive
  })

describe('MCP App sandbox registry', () => {
  it('binds instances to the creating WebContents and revokes them', () => {
    const registry = new McpAppSandboxRegistry()
    const instance = createInstance(registry)

    expect(registry.assertOwned(instance.instanceId, { webContentsId: 7, windowId: 11 })).toBe(
      instance
    )
    expect(() =>
      registry.assertOwned(instance.instanceId, { webContentsId: 8, windowId: 11 })
    ).toThrow('MCP App instance is unavailable')

    registry.revoke(instance.instanceId)
    expect(registry.getForProtocol(instance.instanceId)).toBeNull()
  })

  it('revokes every instance bound to a reconfigured server', () => {
    const registry = new McpAppSandboxRegistry()
    const instance = createInstance(registry)

    registry.revokeByServer(descriptor.serverId)

    expect(registry.getForProtocol(instance.instanceId)).toBeNull()
  })

  it('rejects browser permission approval after the live App binding is lost', async () => {
    const registry = new McpAppSandboxRegistry()
    let isLive = true
    const instance = createInstance(registry, () => isLive)
    let consentRequestId = ''
    registry.setConsentPublisher((_windowId, payload) => {
      consentRequestId = payload.request.requestId
    })

    const decision = registry.requestConsent(instance, {
      kind: 'camera',
      title: 'camera',
      detail: descriptor.toolName
    })
    await vi.waitFor(() => expect(consentRequestId).not.toBe(''))
    expect(
      registry.submitConsent(consentRequestId, true, {
        webContentsId: 7,
        windowId: 12
      })
    ).toBe(false)
    isLive = false

    expect(
      registry.submitConsent(consentRequestId, true, {
        webContentsId: 7,
        windowId: 11
      })
    ).toBe(false)
    await expect(decision).resolves.toBe(false)
    expect(registry.getForProtocol(instance.instanceId)).toBeNull()
  })

  it('preserves default-session permissions while isolating App frames', async () => {
    const registry = new McpAppSandboxRegistry()
    const instance = createInstance(registry)
    let permissionRequestHandler:
      | ((
          owner: { id: number; getURL(): string },
          permission: string,
          callback: (allowed: boolean) => void,
          details: {
            requestingUrl: string
            mediaTypes?: string[]
            isMainFrame: boolean
          }
        ) => void)
      | undefined
    let permissionCheckHandler:
      | ((
          owner: { id: number; getURL(): string } | null,
          permission: string,
          requestingOrigin: string,
          details: { securityOrigin: string; requestingUrl: string }
        ) => boolean)
      | undefined
    const targetSession = {
      setPermissionRequestHandler: vi.fn(
        (handler: NonNullable<typeof permissionRequestHandler>) => {
          permissionRequestHandler = handler
        }
      ),
      setPermissionCheckHandler: vi.fn((handler: NonNullable<typeof permissionCheckHandler>) => {
        permissionCheckHandler = handler
      })
    }
    registry.configureDefaultSessionPermissions(targetSession as never)

    const firstPartyDecision = vi.fn()
    permissionRequestHandler!(
      { id: 1, getURL: () => 'file:///deepchat/index.html' },
      'media',
      firstPartyDecision,
      {
        requestingUrl: 'file:///deepchat/index.html',
        mediaTypes: ['audio'],
        isMainFrame: true
      }
    )
    expect(firstPartyDecision).toHaveBeenCalledWith(true)

    for (const mediaTypes of [['video'], ['audio', 'video']]) {
      const firstPartyCameraDecision = vi.fn()
      permissionRequestHandler!(
        { id: 1, getURL: () => 'file:///deepchat/index.html' },
        'media',
        firstPartyCameraDecision,
        {
          requestingUrl: 'file:///deepchat/index.html',
          mediaTypes,
          isMainFrame: true
        }
      )
      expect(firstPartyCameraDecision).toHaveBeenCalledWith(true)
    }
    expect(
      permissionCheckHandler!(
        { id: 1, getURL: () => 'file:///deepchat/index.html' },
        'notifications',
        'file:///deepchat/index.html',
        {
          securityOrigin: 'file:///deepchat/index.html',
          requestingUrl: 'file:///deepchat/index.html'
        }
      )
    ).toBe(true)

    const browserDecision = vi.fn()
    permissionRequestHandler!(
      { id: 2, getURL: () => 'https://example.com' },
      'notifications',
      browserDecision,
      {
        requestingUrl: 'https://example.com',
        isMainFrame: true
      }
    )
    expect(browserDecision).toHaveBeenCalledWith(true)
    expect(
      permissionCheckHandler!(
        { id: 2, getURL: () => 'https://example.com' },
        'notifications',
        'https://example.com',
        {
          securityOrigin: 'https://example.com',
          requestingUrl: 'https://example.com'
        }
      )
    ).toBe(true)

    const nestedRemoteDecision = vi.fn()
    permissionRequestHandler!(
      { id: 1, getURL: () => 'file:///deepchat/index.html' },
      'notifications',
      nestedRemoteDecision,
      {
        requestingUrl: 'https://example.com',
        isMainFrame: false
      }
    )
    expect(nestedRemoteDecision).toHaveBeenCalledWith(false)
    expect(
      permissionCheckHandler!(
        { id: 1, getURL: () => 'file:///deepchat/index.html' },
        'notifications',
        'https://example.com',
        {
          securityOrigin: 'https://example.com',
          requestingUrl: 'https://example.com'
        }
      )
    ).toBe(false)

    const consentRequestIds: string[] = []
    registry.setConsentPublisher((_windowId, payload) => {
      consentRequestIds.push(payload.request.requestId)
    })
    const undeclaredMicrophoneDecision = vi.fn()
    permissionRequestHandler!(
      {
        id: 7,
        getURL: () => `mcp-app://${instance.instanceId}/sandbox.html`
      },
      'media',
      undeclaredMicrophoneDecision,
      {
        requestingUrl: `mcp-app://${instance.instanceId}/sandbox.html`,
        mediaTypes: ['audio'],
        isMainFrame: false
      }
    )
    expect(undeclaredMicrophoneDecision).toHaveBeenCalledWith(false)
    expect(consentRequestIds).toHaveLength(0)

    const appDecision = vi.fn()
    permissionRequestHandler!(
      {
        id: 7,
        getURL: () => `mcp-app://${instance.instanceId}/sandbox.html`
      },
      'media',
      appDecision,
      {
        requestingUrl: `mcp-app://${instance.instanceId}/sandbox.html`,
        mediaTypes: ['video'],
        isMainFrame: false
      }
    )
    await vi.waitFor(() => expect(consentRequestIds).toHaveLength(1))
    expect(
      registry.submitConsent(consentRequestIds[0], true, {
        webContentsId: 7,
        windowId: 11
      })
    ).toBe(true)
    await vi.waitFor(() => expect(appDecision).toHaveBeenCalledWith(true))

    const repeatedDecision = vi.fn()
    permissionRequestHandler!(
      {
        id: 7,
        getURL: () => `mcp-app://${instance.instanceId}/sandbox.html`
      },
      'media',
      repeatedDecision,
      {
        requestingUrl: `mcp-app://${instance.instanceId}/sandbox.html`,
        mediaTypes: ['video'],
        isMainFrame: false
      }
    )
    await vi.waitFor(() => expect(consentRequestIds).toHaveLength(2))
    expect(repeatedDecision).not.toHaveBeenCalled()
    expect(
      registry.submitConsent(consentRequestIds[1], true, {
        webContentsId: 7,
        windowId: 11
      })
    ).toBe(true)
    await vi.waitFor(() => expect(repeatedDecision).toHaveBeenCalledWith(true))
  })
})
