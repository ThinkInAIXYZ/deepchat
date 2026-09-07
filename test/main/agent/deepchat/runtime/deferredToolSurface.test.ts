import { describe, expect, it, vi } from 'vitest'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/core/mcp'
import {
  assertToolSurfaceDeferredDispatchAllowsDispatch,
  buildToolSurfaceDeferredDispatchBinding,
  consumeToolSurfaceDeferredDispatch,
  createFullToolSurfaceRunController,
  projectToolSurfaceTapeProvenance,
  registerToolSurfaceDeferredDispatch,
  releaseToolSurfaceDeferredDispatchClaim,
  revokeToolSurfaceDeferredDispatch
} from '@/agent/deepchat/runtime/toolSurface'
import { resolveDeferredToolSurfaceDispatch } from '@/agent/deepchat/runtime/deferredToolSurface'
import { buildExecutionContract } from '@/tape/domain/executionContract'
import {
  createTapeViewManifest,
  type TapeViewManifestBuildInput
} from '@/tape/domain/viewManifest'
import type { TapeToolSurfaceFact } from '@/tape/domain/toolSurfaceFacts'

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const REQUEST = {
  sessionId: 'session-1',
  messageId: 'message-1',
  runId: RUN_ID,
  requestSeq: 3
} as const
const TOOL: MCPToolDefinition = {
  type: 'function',
  source: 'agent',
  execution: TOOL_EXECUTION.write,
  function: {
    name: 'write_file',
    description: 'Write a file',
    parameters: { type: 'object', properties: {} }
  },
  server: { name: 'agent-filesystem', icons: '', description: 'Agent filesystem' }
}

function createFixture(
  toolCallId = 'call-1',
  contractBearing = true,
  skillContexts?: TapeViewManifestBuildInput['skillContexts']
) {
  const controller = createFullToolSurfaceRunController({
    ceilingDefinitions: [TOOL],
    initialActiveDefinitions: [TOOL],
    policyVersion: 'full-test'
  })
  const snapshot = controller.build({ request: REQUEST, eligibleDefinitions: [TOOL] })
  controller.admit(snapshot)
  const executionContract = buildExecutionContract({
    request: REQUEST,
    promptAssembly: { prompt: '', sections: [] },
    providerMessages: [{ role: 'user', content: 'Write a file' }],
    tools: [TOOL],
    providerId: 'openai',
    modelId: 'gpt-5',
    modelConfig: {} as any,
    temperature: 0.2,
    maxTokens: 100,
    workspace: { kind: 'path', path: '/workspace' },
    maxSubagentDepth: 0,
    dynamicControlSnapshot: {
      permissionMode: 'default',
      requestAdmitted: true,
      cancellationRequested: false
    },
    assemblerVersion: 'test-v1'
  })
  const manifest = createTapeViewManifest({
    sessionId: REQUEST.sessionId,
    messageId: REQUEST.messageId,
    requestSeq: REQUEST.requestSeq,
    taskType: 'tool_loop',
    policy: 'tool_loop_shadow',
    policyVersion: null,
    contextBuilderVersion: 'legacy-v1',
    messages: [{ role: 'user', content: 'Write a file' }],
    tools: [TOOL],
    latestEntryId: 7,
    anchorEntryIds: [1],
    included: [],
    excluded: [],
    tokenBudget: {
      contextLength: 1000,
      requestedMaxTokens: 100,
      effectiveMaxTokens: 100,
      reserveTokens: 100,
      toolReserveTokens: 0
    },
    providerId: 'openai',
    modelId: 'gpt-5',
    summaryCursorOrderSeq: 1,
    supportsVision: false,
    supportsAudioInput: false,
    traceDebugEnabled: false,
    ...(contractBearing ? { executionContract } : {}),
    ...(skillContexts?.length
      ? {
          runId: RUN_ID,
          tapeIncarnationId: 'tape-1',
          skillContexts
        }
      : {}),
    assembledAt: 123
  })
  const projection = projectToolSurfaceTapeProvenance(snapshot, contractBearing)
  const binding = buildToolSurfaceDeferredDispatchBinding({
    snapshot,
    toolCallId,
    toolName: TOOL.function.name,
    contractBearing
  })
  const fact = {
    contractBearing,
    request: REQUEST,
    manifestHash: manifest.hashes.manifestHash,
    activeEntries: projection.surface.activeEntries
  } as TapeToolSurfaceFact
  const manifestRecord = {
    sessionId: REQUEST.sessionId,
    messageId: REQUEST.messageId,
    requestSeq: REQUEST.requestSeq,
    entryId: 8,
    createdAt: 123,
    integrity: 'valid' as const,
    manifest
  }
  return { snapshot, executionContract, manifestRecord, fact, binding, toolCallId }
}

function createPorts(fixture: ReturnType<typeof createFixture>, facts = [fixture.fact]) {
  return {
    executionJournal: {
      hasAnyCommittedDispatchForMessageToolCall: vi.fn(() => false)
    },
    viewManifests: {
      listViewManifestsByMessageRequest: vi.fn(() => [fixture.manifestRecord])
    },
    toolSurfaces: {
      listToolSurfaceFactsByMessage: vi.fn(() =>
        facts.map((fact, index) => ({ entryId: 9 + index, fact }))
      ),
      listToolSurfaceFactsByMessageRequest: vi.fn(
        (_sessionId: string, _messageId: string, requestSeq: number) =>
          facts
            .filter((fact) => fact.request.requestSeq === requestSeq)
            .map((fact, index) => ({ entryId: 9 + index, fact }))
      )
    }
  }
}

function resolve(
  fixture: ReturnType<typeof createFixture>,
  ports: ReturnType<typeof createPorts>,
  rawBinding: unknown = JSON.stringify(fixture.binding)
) {
  return resolveDeferredToolSurfaceDispatch({
    sessionId: REQUEST.sessionId,
    messageId: REQUEST.messageId,
    toolCallId: fixture.toolCallId,
    toolName: TOOL.function.name,
    rawBinding,
    ...(fixture.binding.contractBearing ? { executionContract: fixture.executionContract } : {}),
    ...ports
  })
}

describe('deferred Tool Surface recovery', () => {
  it('uses the exact process-live call capability without reading Tape', () => {
    const fixture = createFixture('live-call')
    const ports = createPorts(fixture, [])
    const registered = registerToolSurfaceDeferredDispatch({
      snapshot: fixture.snapshot,
      toolCallId: fixture.toolCallId,
      toolName: TOOL.function.name,
      binding: fixture.binding
    })!

    try {
      expect(resolve(fixture, ports)).toBe(registered)
      expect(ports.viewManifests.listViewManifestsByMessageRequest).not.toHaveBeenCalled()
      expect(ports.toolSurfaces.listToolSurfaceFactsByMessage).not.toHaveBeenCalled()
    } finally {
      revokeToolSurfaceDeferredDispatch(REQUEST.sessionId, REQUEST.messageId, fixture.toolCallId)
    }
  })

  it('allows a pre-dispatch permission retry only after the exact claim is released', () => {
    const fixture = createFixture('live-permission-retry')
    const ports = createPorts(fixture, [])
    const registered = registerToolSurfaceDeferredDispatch({
      snapshot: fixture.snapshot,
      toolCallId: fixture.toolCallId,
      toolName: TOOL.function.name,
      binding: fixture.binding
    })!

    try {
      expect(resolve(fixture, ports)).toBe(registered)
      expect(() => resolve(fixture, ports)).toThrow(
        expect.objectContaining({ code: 'corruption' })
      )

      releaseToolSurfaceDeferredDispatchClaim(
        REQUEST.sessionId,
        REQUEST.messageId,
        fixture.toolCallId,
        registered
      )

      expect(resolve(fixture, ports)).toBe(registered)
      expect(ports.viewManifests.listViewManifestsByMessageRequest).not.toHaveBeenCalled()
      expect(ports.toolSurfaces.listToolSurfaceFactsByMessageRequest).not.toHaveBeenCalled()
    } finally {
      revokeToolSurfaceDeferredDispatch(
        REQUEST.sessionId,
        REQUEST.messageId,
        fixture.toolCallId,
        registered
      )
    }
  })

  it('rejects a durable binding that conflicts with process-live authority', () => {
    const fixture = createFixture('live-conflict')
    registerToolSurfaceDeferredDispatch({
      snapshot: fixture.snapshot,
      toolCallId: fixture.toolCallId,
      toolName: TOOL.function.name,
      binding: fixture.binding
    })
    const conflictingBinding = {
      ...fixture.binding,
      canonicalToolDefinitionHash: '0'.repeat(64)
    }

    try {
      expect(() =>
        resolve(fixture, createPorts(fixture), JSON.stringify(conflictingBinding))
      ).toThrow(expect.objectContaining({ code: 'corruption' }))
    } finally {
      revokeToolSurfaceDeferredDispatch(REQUEST.sessionId, REQUEST.messageId, fixture.toolCallId)
    }
  })

  it('recovers strict V5 authority from exactly one hash-linked surface fact', () => {
    const fixture = createFixture('restart-call')
    const ports = createPorts(fixture)

    const recovered = resolve(fixture, ports)

    expect(recovered?.authorityKind).toBe('durable-binding')
    expect(ports.toolSurfaces.listToolSurfaceFactsByMessageRequest).toHaveBeenCalledWith(
      REQUEST.sessionId,
      REQUEST.messageId,
      REQUEST.requestSeq
    )
    expect(() =>
      assertToolSurfaceDeferredDispatchAllowsDispatch(
        recovered,
        {
          sessionId: REQUEST.sessionId,
          messageId: REQUEST.messageId,
          toolCallId: fixture.toolCallId,
          toolName: TOOL.function.name
        },
        TOOL
      )
    ).not.toThrow()
  })

  it.each([
    {
      name: 'contract-bearing schema-v7',
      contractBearing: true,
      context: {
        activationScope: 'runtime_view' as const,
        agentId: 'deepchat',
        sourceType: 'builtin' as const,
        sourceId: 'builtin-skills',
        skillName: 'review',
        authoritativeRef: {
          kind: 'tool_result' as const,
          entryId: 6,
          contentHash: 'b'.repeat(64)
        },
        executionRef: {
          kind: 'materialization' as const,
          entryId: 7,
          tapeIncarnationId: 'tape-1',
          agentId: 'deepchat',
          sourceType: 'builtin' as const,
          sourceId: 'builtin-skills',
          skillName: 'review',
          effectiveContentHash: 'a'.repeat(64)
        },
        providerRole: 'tool' as const,
        sourceEntryIds: [],
        projectedContentHash: 'b'.repeat(64),
        projectionVersion: 1,
        deduplicationSource: 'runtime_view' as const
      },
      schemaVersion: 7
    },
    {
      name: 'non-contract schema-v6',
      contractBearing: false,
      context: {
        activationScope: 'session' as const,
        agentId: 'deepchat',
        sourceType: 'builtin' as const,
        sourceId: 'builtin-skills',
        skillName: 'review',
        authoritativeRef: {
          kind: 'materialization' as const,
          entryId: 7,
          tapeIncarnationId: 'tape-1',
          agentId: 'deepchat',
          sourceType: 'builtin' as const,
          sourceId: 'builtin-skills',
          skillName: 'review',
          effectiveContentHash: 'a'.repeat(64)
        },
        providerRole: 'system' as const,
        sourceEntryIds: [],
        projectedContentHash: 'a'.repeat(64),
        projectionVersion: 1,
        deduplicationSource: 'session' as const
      },
      schemaVersion: 6
    }
  ])('recovers $name Tool Surface authority', ({ contractBearing, context, schemaVersion }) => {
    const fixture = createFixture(`skill-schema-${schemaVersion}`, contractBearing, [context])

    expect(fixture.manifestRecord.manifest.schemaVersion).toBe(schemaVersion)
    const recovered = resolve(fixture, createPorts(fixture))

    expect(recovered?.authorityKind).toBe('durable-binding')
  })

  it('rejects restart recovery after the exact deferred tool call crossed T1', () => {
    const fixture = createFixture('spent-after-t1')
    const ports = createPorts(fixture)
    ports.executionJournal.hasAnyCommittedDispatchForMessageToolCall.mockReturnValue(true)

    expect(() => resolve(fixture, ports)).toThrow(
      expect.objectContaining({ code: 'spent_dispatch' })
    )
    expect(ports.executionJournal.hasAnyCommittedDispatchForMessageToolCall).toHaveBeenCalledWith(
      REQUEST.sessionId,
      REQUEST.messageId,
      fixture.toolCallId
    )
    expect(ports.toolSurfaces.listToolSurfaceFactsByMessageRequest).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'missing fact', factCount: 0 },
    { name: 'duplicate fact', factCount: 2 }
  ])('fails strict recovery on $name', ({ factCount }) => {
    const fixture = createFixture(`strict-${factCount}`)
    const facts = Array.from({ length: factCount }, () => fixture.fact)

    expect(() => resolve(fixture, createPorts(fixture, facts))).toThrow()
  })

  it('fails strict recovery when the durable surface does not prove the bound target', () => {
    const fixture = createFixture('strict-target-mismatch')
    const fact = { ...fixture.fact, activeEntries: [] }

    expect(() => resolve(fixture, createPorts(fixture, [fact]))).toThrow(
      expect.objectContaining({ code: 'corruption' })
    )
  })

  it('fails strict recovery when the surface points at a different manifest', () => {
    const fixture = createFixture('strict-manifest-mismatch')
    const fact = { ...fixture.fact, manifestHash: '0'.repeat(64) }

    expect(() => resolve(fixture, createPorts(fixture, [fact]))).toThrow(
      expect.objectContaining({ code: 'corruption' })
    )
  })

  it('fails strict recovery when the manifest does not precede the surface fact', () => {
    const fixture = createFixture('strict-causal-order')
    const ports = createPorts(fixture)
    ports.toolSurfaces.listToolSurfaceFactsByMessageRequest.mockReturnValue([
      { entryId: fixture.manifestRecord.entryId, fact: fixture.fact }
    ])

    expect(() => resolve(fixture, ports)).toThrow(
      expect.objectContaining({ code: 'corruption' })
    )
  })

  it('requires durable V4 evidence for a new bound pause and rejects replay', () => {
    const fixture = createFixture('v4-call', false)
    const ports = createPorts(fixture)
    const recovered = resolveDeferredToolSurfaceDispatch({
      sessionId: REQUEST.sessionId,
      messageId: REQUEST.messageId,
      toolCallId: fixture.toolCallId,
      toolName: TOOL.function.name,
      rawBinding: JSON.stringify(fixture.binding),
      ...ports
    })!

    expect(ports.viewManifests.listViewManifestsByMessageRequest).toHaveBeenCalledWith(
      REQUEST.sessionId,
      REQUEST.messageId,
      REQUEST.requestSeq
    )
    expect(ports.toolSurfaces.listToolSurfaceFactsByMessageRequest).toHaveBeenCalledWith(
      REQUEST.sessionId,
      REQUEST.messageId,
      REQUEST.requestSeq
    )
    const expected = {
      sessionId: REQUEST.sessionId,
      messageId: REQUEST.messageId,
      toolCallId: fixture.toolCallId,
      toolName: TOOL.function.name
    }
    consumeToolSurfaceDeferredDispatch(recovered, expected)
    expect(() =>
      assertToolSurfaceDeferredDispatchAllowsDispatch(recovered, expected, TOOL)
    ).toThrow()
  })

  it('fails recovery for a bound V4 pause without durable View evidence', () => {
    const fixture = createFixture('v4-missing', false)

    expect(() => resolve(fixture, createPorts(fixture, []))).toThrow(
      expect.objectContaining({ code: 'missing_surface' })
    )
  })

  it('rejects concurrent recovery claims for the same durable tool call', () => {
    const fixture = createFixture('recovered-race')
    const first = resolve(fixture, createPorts(fixture))

    try {
      expect(() => resolve(fixture, createPorts(fixture))).toThrow(
        expect.objectContaining({ code: 'corruption' })
      )
    } finally {
      revokeToolSurfaceDeferredDispatch(
        REQUEST.sessionId,
        REQUEST.messageId,
        fixture.toolCallId,
        first
      )
    }
  })

  it('allows a recovered pre-dispatch permission retry only after releasing its claim', () => {
    const fixture = createFixture('recovered-permission-retry')
    const first = resolve(fixture, createPorts(fixture))!

    try {
      expect(() => resolve(fixture, createPorts(fixture))).toThrow(
        expect.objectContaining({ code: 'corruption' })
      )
      releaseToolSurfaceDeferredDispatchClaim(
        REQUEST.sessionId,
        REQUEST.messageId,
        fixture.toolCallId,
        first
      )

      expect(resolve(fixture, createPorts(fixture))).toBe(first)
    } finally {
      revokeToolSurfaceDeferredDispatch(
        REQUEST.sessionId,
        REQUEST.messageId,
        fixture.toolCallId,
        first
      )
    }
  })

  it('rejects recovered V4 dispatch when only its execution policy changed', () => {
    const fixture = createFixture('v4-policy-drift', false)
    const recovered = resolve(fixture, createPorts(fixture))
    const changedTool = { ...TOOL, execution: TOOL_EXECUTION.read.parallel }

    try {
      expect(() =>
        assertToolSurfaceDeferredDispatchAllowsDispatch(
          recovered,
          {
            sessionId: REQUEST.sessionId,
            messageId: REQUEST.messageId,
            toolCallId: fixture.toolCallId,
            toolName: TOOL.function.name
          },
          changedTool
        )
      ).toThrow(expect.objectContaining({ code: 'conflicting_tool' }))
    } finally {
      revokeToolSurfaceDeferredDispatch(
        REQUEST.sessionId,
        REQUEST.messageId,
        fixture.toolCallId,
        recovered
      )
    }
  })

  it('keeps historical unbound V4 pauses on the legacy path', () => {
    const fixture = createFixture('legacy-v4')
    const ports = createPorts(fixture, [])

    expect(
      resolveDeferredToolSurfaceDispatch({
        sessionId: REQUEST.sessionId,
        messageId: REQUEST.messageId,
        toolCallId: fixture.toolCallId,
        toolName: TOOL.function.name,
        rawBinding: undefined,
        ...ports
      })
    ).toBeUndefined()
    expect(ports.toolSurfaces.listToolSurfaceFactsByMessage).toHaveBeenCalledWith(
      REQUEST.sessionId,
      REQUEST.messageId
    )
  })

  it('does not downgrade corrupt new bindings to the legacy V4 path', () => {
    const fixture = createFixture('corrupt-v4')

    expect(() =>
      resolveDeferredToolSurfaceDispatch({
        sessionId: REQUEST.sessionId,
        messageId: REQUEST.messageId,
        toolCallId: fixture.toolCallId,
        toolName: TOOL.function.name,
        rawBinding: '{',
        ...createPorts(fixture)
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_binding' }))
  })

  it('rejects a missing strict binding when durable surface evidence exists', () => {
    const fixture = createFixture('missing-binding')

    expect(() =>
      resolveDeferredToolSurfaceDispatch({
        sessionId: REQUEST.sessionId,
        messageId: REQUEST.messageId,
        toolCallId: fixture.toolCallId,
        toolName: TOOL.function.name,
        rawBinding: undefined,
        executionContract: fixture.executionContract,
        ...createPorts(fixture)
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_binding' }))
  })

  it('rejects stripping both bindings when durable Tool Surface evidence exists', () => {
    const fixture = createFixture('stripped-bindings')

    expect(() =>
      resolveDeferredToolSurfaceDispatch({
        sessionId: REQUEST.sessionId,
        messageId: REQUEST.messageId,
        toolCallId: fixture.toolCallId,
        toolName: TOOL.function.name,
        rawBinding: undefined,
        ...createPorts(fixture)
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_binding' }))
  })

  it('rejects changing a strict durable binding to non-contract recovery', () => {
    const fixture = createFixture('downgrade-binding')
    const downgraded = { ...fixture.binding, contractBearing: false }

    expect(() =>
      resolveDeferredToolSurfaceDispatch({
        sessionId: REQUEST.sessionId,
        messageId: REQUEST.messageId,
        toolCallId: fixture.toolCallId,
        toolName: TOOL.function.name,
        rawBinding: JSON.stringify(downgraded),
        ...createPorts(fixture)
      })
    ).toThrow(expect.objectContaining({ code: 'corruption' }))
  })

  it('keeps a legacy strict pause compatible when no Tool Surface View exists', () => {
    const fixture = createFixture('legacy-strict')
    const ports = createPorts(fixture, [])

    expect(
      resolveDeferredToolSurfaceDispatch({
        sessionId: REQUEST.sessionId,
        messageId: REQUEST.messageId,
        toolCallId: fixture.toolCallId,
        toolName: TOOL.function.name,
        rawBinding: undefined,
        executionContract: fixture.executionContract,
        ...ports
      })
    ).toBeUndefined()
    expect(ports.viewManifests.listViewManifestsByMessageRequest).not.toHaveBeenCalled()
    expect(ports.toolSurfaces.listToolSurfaceFactsByMessage).toHaveBeenCalledWith(
      REQUEST.sessionId,
      REQUEST.messageId
    )
  })
})
