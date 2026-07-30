import { describe, expect, it, vi } from 'vitest'
import { ToolPermissionBroker } from '@/tool/permission'

describe('ToolPermissionBroker', () => {
  it('settles every identical concurrent MCP App request with one approval', async () => {
    const broker = new ToolPermissionBroker()
    const onRequest = vi.fn()
    const context = {
      conversationId: 'conversation',
      serverId: 'server',
      serverName: 'fixture',
      toolName: 'read',
      arguments: { path: '/tmp/example' },
      permissionType: 'read' as const,
      permissionMode: 'default' as const
    }

    const first = broker.requestAppDecision(context, onRequest)
    const second = broker.requestAppDecision(context, onRequest)
    const requestId = onRequest.mock.calls[0][0].requestId

    expect(broker.approve(requestId, context.conversationId)).toBe(true)
    await expect(first).resolves.toEqual({ allowed: true })
    await expect(second).resolves.toEqual({ allowed: true })
  })

  it('does not reuse a model approval for changed arguments or an MCP App source', () => {
    const broker = new ToolPermissionBroker()
    const base = {
      conversationId: 'conversation',
      serverId: 'server',
      serverName: 'fixture',
      toolName: 'write',
      arguments: { value: 1 },
      source: 'model' as const,
      permissionType: 'write' as const,
      permissionMode: 'default' as const
    }
    const request = broker.evaluateModel(base)
    expect(request).not.toBeNull()
    expect(request?.description).toBe('components.messageBlockPermissionRequest.description.write')
    expect(broker.approve(request!.requestId, base.conversationId)).toBe(true)

    expect(
      broker.authorizeExecution({
        ...base,
        arguments: { value: 2 }
      }).allowed
    ).toBe(false)
    expect(
      broker.authorizeExecution({
        ...base,
        source: 'mcp-app'
      }).allowed
    ).toBe(false)
  })

  it.each([
    ['generation', { configGeneration: 2 }],
    ['binding', { bindingHash: 'binding-b' }],
    ['permission type', { permissionType: 'write' as const }]
  ])('does not reuse an approval after the %s changes', (_label, change) => {
    const broker = new ToolPermissionBroker()
    const base = {
      conversationId: 'conversation',
      serverId: 'server',
      configGeneration: 1,
      bindingHash: 'binding-a',
      serverName: 'fixture',
      toolName: 'read',
      arguments: { value: 1 },
      source: 'model' as const,
      permissionType: 'read' as const,
      permissionMode: 'default' as const
    }
    const request = broker.evaluateModel(base)

    expect(request).not.toBeNull()
    expect(broker.approve(request!.requestId, base.conversationId)).toBe(true)
    expect(broker.authorizeExecution({ ...base, ...change }).allowed).toBe(false)
  })

  it('cancels approved model requests on abort and settles explicit App denials', async () => {
    const broker = new ToolPermissionBroker()
    const controller = new AbortController()
    const modelContext = {
      conversationId: 'conversation',
      serverId: 'server',
      serverName: 'fixture',
      toolName: 'read',
      arguments: {},
      source: 'model' as const,
      permissionType: 'read' as const,
      permissionMode: 'default' as const
    }
    const modelRequest = broker.evaluateModel(modelContext, controller.signal)
    expect(modelRequest).not.toBeNull()
    expect(broker.approve(modelRequest!.requestId, modelContext.conversationId)).toBe(true)
    controller.abort()
    expect(() => broker.authorizeExecution(modelContext, controller.signal)).toThrow()

    const onRequest = vi.fn()
    const appDecision = broker.requestAppDecision(
      {
        conversationId: modelContext.conversationId,
        serverId: modelContext.serverId,
        serverName: modelContext.serverName,
        toolName: modelContext.toolName,
        arguments: modelContext.arguments,
        permissionType: modelContext.permissionType,
        permissionMode: 'default'
      },
      onRequest
    )
    const appRequestId = onRequest.mock.calls[0][0].requestId
    expect(broker.deny(appRequestId, modelContext.conversationId)).toBe(true)
    await expect(appDecision).resolves.toEqual({ allowed: false, reason: 'denied' })
  })
})
