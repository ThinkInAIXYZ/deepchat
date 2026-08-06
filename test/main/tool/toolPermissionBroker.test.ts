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

  it('does not lose an MCP App decision resolved inside the request callback', async () => {
    const broker = new ToolPermissionBroker()
    const context = {
      conversationId: 'conversation',
      serverId: 'server',
      serverName: 'fixture',
      toolName: 'read',
      arguments: { path: '/tmp/example' },
      permissionType: 'read' as const,
      permissionMode: 'default' as const
    }

    await expect(
      broker.requestAppDecision(context, (request) => {
        expect(broker.approve(request.requestId!, context.conversationId)).toBe(true)
      })
    ).resolves.toEqual({ allowed: true })
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

  it('reuses approval for equivalent arguments with different key insertion order', () => {
    const broker = new ToolPermissionBroker()
    const base = {
      conversationId: 'conversation',
      serverId: 'server',
      serverName: 'fixture',
      toolName: 'read',
      arguments: { z: 1, a: 2 },
      source: 'model' as const,
      permissionType: 'read' as const,
      permissionMode: 'default' as const
    }
    const request = broker.evaluateModel(base)

    expect(request).not.toBeNull()
    expect(broker.approve(request!.requestId, base.conversationId)).toBe(true)
    expect(
      broker.authorizeExecution({
        ...base,
        arguments: { a: 2, z: 1 }
      })
    ).toEqual({ allowed: true })
  })

  it('requires an exact one-shot user confirmation even in full access mode', () => {
    const broker = new ToolPermissionBroker()
    const ordinaryContext = {
      conversationId: 'conversation',
      serverId: 'agent-live-delegation',
      serverName: 'agent-live-delegation',
      toolName: 'deepchat_subagents',
      arguments: { operation: 'spawn', slotId: 'reviewer' },
      source: 'model' as const,
      permissionType: 'write' as const,
      permissionMode: 'default' as const
    }
    const ordinaryRequest = broker.evaluateModel(ordinaryContext)
    expect(broker.approve(ordinaryRequest!.requestId, ordinaryContext.conversationId)).toBe(true)

    const explicitContext = {
      ...ordinaryContext,
      executionId: 'tool-call-1',
      permissionMode: 'full_access' as const,
      approvalMode: 'explicit_user' as const,
      description: 'Start this Subagent task?'
    }
    const firstAuthorization = broker.authorizeExecution(explicitContext)
    expect(firstAuthorization).toMatchObject({
      allowed: false,
      request: {
        description: 'Start this Subagent task?',
        requiresUserConfirmation: true,
        rememberable: false
      }
    })
    if (firstAuthorization.allowed) throw new Error('Expected user confirmation')

    expect(
      broker.approve(firstAuthorization.request.requestId!, ordinaryContext.conversationId)
    ).toBe(true)
    expect(broker.authorizeExecution(explicitContext)).toEqual({ allowed: true })
    expect(broker.authorizeExecution(explicitContext).allowed).toBe(false)
    broker.clear()
  })

  it('keeps identical arguments isolated by execution ID', () => {
    const broker = new ToolPermissionBroker()
    const context = {
      conversationId: 'conversation',
      serverId: 'agent-live-delegation',
      serverName: 'agent-live-delegation',
      toolName: 'deepchat_subagents',
      arguments: { operation: 'spawn', slotId: 'reviewer' },
      source: 'model' as const,
      permissionType: 'write' as const,
      permissionMode: 'full_access' as const,
      approvalMode: 'explicit_user' as const
    }
    const first = broker.evaluateModel({ ...context, executionId: 'tool-call-1' })
    const second = broker.evaluateModel({ ...context, executionId: 'tool-call-2' })

    expect(first?.requestId).not.toBe(second?.requestId)
    expect(broker.approve(first!.requestId!, context.conversationId)).toBe(true)
    expect(broker.authorizeExecution({ ...context, executionId: 'tool-call-2' }).allowed).toBe(
      false
    )
    expect(broker.authorizeExecution({ ...context, executionId: 'tool-call-1' })).toEqual({
      allowed: true
    })
    broker.clear()
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

  it('limits pending requests per conversation without blocking other conversations', () => {
    const broker = new ToolPermissionBroker()
    const createContext = (conversationId: string, value: number) => ({
      conversationId,
      serverId: 'server',
      serverName: 'fixture',
      toolName: 'write',
      arguments: { value },
      source: 'model' as const,
      permissionType: 'write' as const,
      permissionMode: 'default' as const
    })

    for (let index = 0; index < 64; index += 1) {
      expect(broker.evaluateModel(createContext('busy', index))).not.toBeNull()
    }
    expect(() => broker.evaluateModel(createContext('busy', 64))).toThrow(
      'Too many pending tool permission requests'
    )
    expect(broker.evaluateModel(createContext('other', 0))).not.toBeNull()
    broker.clear()
  })
})
