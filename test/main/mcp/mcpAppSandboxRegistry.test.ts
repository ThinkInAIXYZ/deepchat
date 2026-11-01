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
  validateLive: () => boolean = () => true,
  creationId?: string
) =>
  registry.create({
    creationId:
      creationId ??
      registry.reserveCreation({ webContentsId: 7, windowId: 11 }, descriptor.serverId),
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
  it('owns one renderer lifetime through creation, consent and retirement', async () => {
    let destroy!: () => void
    const unsubscribe = vi.fn()
    const observe = vi.fn((_id: number, listener: () => void) => {
      destroy = listener
      return unsubscribe
    })
    const registry = new McpAppSandboxRegistry(observe)
    registry.setConsentPublisher(() => {})
    const context = { webContentsId: 7, windowId: 11 }
    const creation = registry.reserveCreation(context, descriptor.serverId)
    const instance = createInstance(registry)
    expect(observe).toHaveBeenCalledOnce()
    registry.cancelCreation(creation)
    expect(unsubscribe).not.toHaveBeenCalled()
    const pending = registry.requestBrowserPermission(instance.instanceId, context, ['camera'])
    destroy()
    expect(await pending).toBe(false)
    expect(registry.getForProtocol(instance.instanceId)).toBeNull()
    expect(unsubscribe).toHaveBeenCalledOnce()
    registry.close()
    expect(() => registry.reserveCreation(context, descriptor.serverId)).toThrow(
      'registry is closed'
    )

    const retired = new McpAppSandboxRegistry((_id, listener) => {
      listener()
      return unsubscribe
    })
    expect(() => retired.reserveCreation(context, descriptor.serverId)).toThrow('no longer active')
    expect(unsubscribe).toHaveBeenCalledTimes(2)
  })

  it('counts pending creation against both limits and releases canceled work', () => {
    const registry = new McpAppSandboxRegistry(() => () => {})
    const first = Array.from({ length: 32 }, () =>
      registry.reserveCreation({ webContentsId: 7, windowId: 11 }, descriptor.serverId)
    )
    expect(() =>
      registry.reserveCreation({ webContentsId: 7, windowId: 11 }, descriptor.serverId)
    ).toThrow('instance limit')
    const instance = createInstance(registry, () => true, first.pop()!)
    const second = Array.from({ length: 32 }, () =>
      registry.reserveCreation({ webContentsId: 8, windowId: 12 }, descriptor.serverId)
    )
    expect(() =>
      registry.reserveCreation({ webContentsId: 9, windowId: 13 }, descriptor.serverId)
    ).toThrow('instance limit')
    registry.cancelCreation(second.pop()!)
    const replacement = registry.reserveCreation(
      { webContentsId: 9, windowId: 13 },
      descriptor.serverId
    )
    registry.revokeByWebContents(7)
    expect(registry.getForProtocol(instance.instanceId)).toBeNull()
    for (const id of first)
      expect(() => registry.assertCreationCurrent(id)).toThrow('no longer active')
    expect(() => registry.assertCreationCurrent(replacement)).not.toThrow()
    registry.clear()
  })

  it.each(['owner', 'server', 'maintenance'] as const)(
    'invalidates pending creation on %s revocation',
    (reason) => {
      const registry = new McpAppSandboxRegistry(() => () => {})
      const id = registry.reserveCreation({ webContentsId: 7, windowId: 11 }, descriptor.serverId)
      const signal = registry.getCreationSignal(id)
      if (reason === 'owner') registry.revokeByWebContents(7)
      else if (reason === 'server') registry.revokeByServer(descriptor.serverId)
      else registry.clear()
      expect(signal.aborted).toBe(true)
      expect(() => createInstance(registry, () => true, id)).toThrow('no longer active')
    }
  )

  it('isolates protocol policy and rejects approval revoked before native dispatch', async () => {
    const registry = new McpAppSandboxRegistry(() => () => {})
    const instance = createInstance(registry)
    const policy = await registry.getProtocolPolicy(instance.instanceId)
    policy!.permissions!.camera = undefined
    expect(instance.permissions?.camera).toEqual({})
    let requestId = ''
    registry.setConsentPublisher((_windowId, payload) => {
      requestId = payload.request.requestId
    })
    const context = { webContentsId: 7, windowId: 11 }
    expect(
      await registry.requestBrowserPermission(instance.instanceId, { ...context, windowId: 12 }, [
        'camera'
      ])
    ).toBe(false)
    expect(
      await registry.requestBrowserPermission(instance.instanceId, context, ['tool-call'])
    ).toBe(false)
    const decision = registry.requestBrowserPermission(instance.instanceId, context, ['camera'])
    expect(requestId).not.toBe('')
    expect(registry.submitConsent(requestId, true, context)).toBe(true)
    registry.revoke(instance.instanceId)
    expect(await decision).toBe(false)
  })

  it('binds instances to the creating WebContents and revokes them', () => {
    const registry = new McpAppSandboxRegistry(() => () => {})
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
    const registry = new McpAppSandboxRegistry(() => () => {})
    const instance = createInstance(registry)

    registry.revokeByServer(descriptor.serverId)

    expect(registry.getForProtocol(instance.instanceId)).toBeNull()
  })

  it('rejects browser permission approval after the live App binding is lost', async () => {
    const registry = new McpAppSandboxRegistry(() => () => {})
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
})
