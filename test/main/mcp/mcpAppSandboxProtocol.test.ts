import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { McpAppSandboxRegistry } from '@/mcp/apps/sandboxRegistry'
import type { McpAppDescriptor } from '@shared/types/mcp'
import {
  buildMcpAppContentSecurityPolicy,
  configureMcpAppSessionPermissions,
  registerMcpAppProtocol,
  buildMcpAppPermissionsPolicy
} from '@/mcp/apps/sandboxProtocol'

const native = vi.hoisted(() => ({
  fromId: vi.fn(),
  fromWebContents: vi.fn(),
  handle: vi.fn(),
  openExternal: vi.fn(),
  session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }
}))
vi.mock('electron', () => ({
  protocol: { handle: native.handle },
  session: { defaultSession: native.session },
  webContents: { fromId: native.fromId },
  BrowserWindow: { fromWebContents: native.fromWebContents },
  shell: { openExternal: native.openExternal }
}))

beforeEach(() => {
  vi.clearAllMocks()
  const owner = Object.assign(new EventEmitter(), { id: 7, isDestroyed: () => false })
  native.fromId.mockReturnValue(owner)
  native.fromWebContents.mockReturnValue({ id: 11 })
})

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
    creationId: registry.reserveCreation({ webContentsId: 7, windowId: 11 }, descriptor.serverId),
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

describe('MCP App sandbox policy', () => {
  it('settles a native permission callback once when its disposed caller throws', async () => {
    const registry = new McpAppSandboxRegistry()
    const instance = createInstance(registry)
    const setRequest = vi.fn()
    configureMcpAppSessionPermissions(registry, {
      setPermissionRequestHandler: setRequest,
      setPermissionCheckHandler: vi.fn()
    } as never)
    const callback = vi.fn(() => {
      throw new Error('Native caller disposed')
    })
    setRequest.mock.calls[0][0](
      { id: 7, getURL: () => 'file:///deepchat/index.html' },
      'media',
      callback,
      {
        requestingUrl: `mcp-app://${instance.instanceId}/sandbox.html`,
        mediaTypes: ['audio'],
        isMainFrame: false
      }
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(callback).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('revokes pending creation and views on native owner destruction', async () => {
    const owner = Object.assign(new EventEmitter(), { id: 7, isDestroyed: vi.fn(() => false) })
    native.fromId.mockReturnValue(owner)
    const registry = new McpAppSandboxRegistry()
    const desktop = registerMcpAppProtocol(registry)
    const context = { webContentsId: 7, windowId: 11 }
    const creationId = registry.reserveCreation(context, descriptor.serverId)
    await desktop.observeOwner(context)
    const instance = createInstance(registry)
    const handler = native.handle.mock.calls.at(-1)![1]
    const response = await handler(new Request(`mcp-app://${instance.instanceId}/sandbox.html`))
    expect(response.status).toBe(200)
    await desktop.openExternal('https://example.com/', context)
    expect(native.openExternal).toHaveBeenCalledTimes(1)
    owner.isDestroyed.mockReturnValue(true)
    owner.emit('destroyed')
    expect(registry.getForProtocol(instance.instanceId)).toBeNull()
    expect(() => registry.assertCreationCurrent(creationId)).toThrow('no longer active')
    await expect(desktop.observeOwner(context)).rejects.toThrow('owner is unavailable')
    await expect(desktop.openExternal('https://example.com/', context)).rejects.toThrow(
      'owner is unavailable'
    )
    expect(native.openExternal).toHaveBeenCalledTimes(1)
  })

  it('refuses a delayed protocol policy after the native owner is gone', async () => {
    const registry = new McpAppSandboxRegistry()
    registerMcpAppProtocol(registry)
    const handler = native.handle.mock.calls.at(-1)![1]
    let release!: (policy: Awaited<ReturnType<typeof registry.getProtocolPolicy>>) => void
    vi.spyOn(registry, 'getProtocolPolicy').mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const pending = handler(new Request('mcp-app://fixture/sandbox.html'))
    native.fromId.mockReturnValue(null)
    release({ context: { webContentsId: 7, windowId: 11 } })
    expect((await pending).status).toBe(410)
  })

  it('keeps network access deny-by-default and admits only declared origins', () => {
    const policy = buildMcpAppContentSecurityPolicy({
      connectDomains: ['https://api.example.com'],
      resourceDomains: ['https://static.example.com'],
      frameDomains: ['https://embed.example.com']
    })

    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain('connect-src https://api.example.com')
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("form-action 'none'")
    expect(policy).toContain('frame-src https://embed.example.com')
  })

  it('does not grant an implicit frame source when none is declared', () => {
    expect(buildMcpAppContentSecurityPolicy(undefined)).toContain("frame-src 'none'")
  })

  it('drops CSP sources containing directive separators or whitespace', () => {
    const policy = buildMcpAppContentSecurityPolicy({
      connectDomains: [
        'https://api.example.com',
        'https://safe.example; script-src *',
        'https://line.example\nscript-src *'
      ]
    })

    expect(policy).toContain('connect-src https://api.example.com')
    expect(policy).not.toContain('https://safe.example')
    expect(policy).not.toContain('https://line.example')
    expect(policy).not.toContain('script-src *')
  })

  it('uses declared base URI domains without implicitly adding the sandbox origin', () => {
    const policy = buildMcpAppContentSecurityPolicy({
      baseUriDomains: ['https://assets.example.com']
    })

    expect(policy).toContain('base-uri https://assets.example.com')
    expect(policy).not.toContain("base-uri 'self'")
  })

  it('denies undeclared device capabilities in the response policy', () => {
    expect(
      buildMcpAppPermissionsPolicy({
        camera: {},
        clipboardWrite: {}
      })
    ).toBe('camera=(self), microphone=(), geolocation=(), clipboard-write=(self)')
    expect(buildMcpAppPermissionsPolicy(undefined)).toBe(
      'camera=(), microphone=(), geolocation=(), clipboard-write=()'
    )
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
    configureMcpAppSessionPermissions(registry, targetSession as never)

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
    await vi.waitFor(() => expect(undeclaredMicrophoneDecision).toHaveBeenCalledWith(false))
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
