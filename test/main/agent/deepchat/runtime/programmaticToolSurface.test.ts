import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/core/mcp'
import {
  MAX_PROGRAMMATIC_TOOL_AUTHORITY_PROJECTION_BYTES,
  MAX_PROGRAMMATIC_TOOL_BATCH_STEPS,
  MAX_PROGRAMMATIC_TOOL_CHILDREN,
  MAX_PROGRAMMATIC_TOOL_INPUT_BYTES,
  PROGRAMMATIC_TOOL_ADAPTER_MODE,
  attachProgrammaticToolDeferredResumeCapability,
  assertIssuedProgrammaticToolCapability,
  assertIssuedProgrammaticToolSurface,
  assertProgrammaticToolCapabilityViewActive,
  buildProgrammaticToolCapabilityV1,
  buildProgrammaticToolSurfaceV1,
  createProgrammaticToolSurfaceRunControllerV1,
  projectProgrammaticExecDefinition,
  markProgrammaticToolCapabilityProvenanceCommitted,
  preflightProgrammaticToolRunCeilingV1,
  projectProgrammaticToolTapeProvenanceV1,
  requireProgrammaticToolDeferredResumeCapability,
  type ProgrammaticToolCapabilityCeilingsV1,
  type ProgrammaticToolCapabilityQuotasV1
} from '@/agent/deepchat/runtime/programmaticToolSurface'
import {
  ToolSurfaceError,
  buildToolSurfaceDeferredDispatchBinding,
  buildToolSurfaceRunCeiling,
  consumeToolSurfaceDeferredDispatch,
  createToolSurfaceActivationLedger,
  createToolSurfaceSnapshot,
  issueRecoveredToolSurfaceDeferredDispatch,
  registerToolSurfaceDeferredDispatch,
  revokeToolSurfaceDeferredDispatchesForSession,
  revokeToolSurfaceExecutionEligibility
} from '@/agent/deepchat/runtime/toolSurface'
import { buildTaskContract } from '@/tape/domain/taskContract'
import { createTapeProgrammaticToolSurfaceFact } from '@/tape/domain/toolSurfaceFacts'

const SERVER_ID = '22222222-2222-4222-8222-222222222222'
const BINDING_HASH = 'a'.repeat(64)

function agentTool(name: string): MCPToolDefinition {
  const isExec = name === 'exec'
  return {
    source: 'agent',
    execution: isExec ? TOOL_EXECUTION.write : TOOL_EXECUTION.read.parallel,
    type: 'function',
    function: {
      name,
      description: `${name} description`,
      parameters: { type: 'object', properties: {} }
    },
    server: {
      name: isExec ? 'agent-filesystem' : 'agent-tools',
      icons: '',
      description: 'Agent tools'
    }
  }
}

function mcpTool(
  name: string,
  effect: 'read' | 'write' = 'read',
  rawMeta?: Record<string, unknown>
): MCPToolDefinition {
  return {
    source: 'mcp',
    execution: effect === 'read' ? TOOL_EXECUTION.read.parallel : TOOL_EXECUTION.write,
    type: 'function',
    function: {
      name,
      description: `${name} description`,
      parameters: { type: 'object', properties: { value: { type: 'string' } } }
    },
    server: {
      id: SERVER_ID,
      name: 'remote',
      icons: '',
      description: 'Remote tools',
      configGeneration: 1,
      bindingHash: BINDING_HASH
    },
    raw: {
      name,
      inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
      ...(rawMeta ? { _meta: rawMeta } : {})
    }
  }
}

function buildSnapshot(input: {
  definitions: readonly MCPToolDefinition[]
  activeNames: readonly string[]
  eligibleDefinitions?: readonly MCPToolDefinition[]
  requestSeq?: number
  policyVersion?: string
  directSnapshot?: boolean
  requestOverrides?: Partial<{
    sessionId: string
    messageId: string
    runId: string
  }>
}) {
  const request = {
    sessionId: input.requestOverrides?.sessionId ?? 'session-1',
    messageId: input.requestOverrides?.messageId ?? 'message-1',
    runId: input.requestOverrides?.runId ?? 'run-1',
    requestSeq: input.requestSeq ?? 1
  }
  const policyVersion = input.policyVersion ?? 'programmatic-test-v1'
  const providerActiveDefinitions = input.definitions.filter((definition) =>
    input.activeNames.includes(definition.function.name)
  )
  if (!input.directSnapshot) {
    const controller = createProgrammaticToolSurfaceRunControllerV1({
      ceilingDefinitions: input.definitions,
      providerActiveDefinitions,
      policyVersion
    })
    return controller.build({
      request,
      eligibleDefinitions: input.eligibleDefinitions ?? input.definitions
    })
  }
  const ceiling = buildToolSurfaceRunCeiling(input.definitions)
  const activeEntries = ceiling.catalog.entries.filter((entry) =>
    input.activeNames.includes(entry.target.providerVisibleName)
  )
  return createToolSurfaceSnapshot({
    request,
    policyVersion,
    adapterMode: PROGRAMMATIC_TOOL_ADAPTER_MODE,
    virtualizationTriggered: true,
    ceiling,
    eligibleDefinitions: input.eligibleDefinitions ?? input.definitions,
    activationLedger: createToolSurfaceActivationLedger(activeEntries),
    selectionReasons: activeEntries.map((entry) => ({
      stableTargetKey: entry.stableTargetKey,
      reason: 'core' as const
    }))
  })
}

function buildTaskContext(
  overrides: {
    sessionId?: string
    workspace?: string
    maxToolEffect?: 'read' | 'write'
    maxSubagentDepth?: number
    contractHash?: string
  } = {}
) {
  const contract = buildTaskContract({
    delegationId: 'delegation-1',
    turnId: 'turn-1',
    turnSeq: 1,
    turnKind: 'initial',
    parentSessionId: 'parent-1',
    slotId: 'reviewer',
    targetAgentId: 'agent-1',
    title: 'Review boundaries',
    prompt: 'Inspect the contract boundary.',
    workspace: { kind: 'path', path: overrides.workspace ?? path.resolve('task-workspace') },
    handoffFormat: [],
    maxToolEffect: overrides.maxToolEffect ?? 'write',
    maxSubagentDepth: overrides.maxSubagentDepth ?? 1
  })
  return {
    contract,
    localRef: {
      schemaVersion: 1 as const,
      sessionId: overrides.sessionId ?? 'session-1',
      tapeIdentity: 'b'.repeat(64),
      entryId: 7,
      contractHash: overrides.contractHash ?? contract.contractHash
    }
  }
}

const ceilings: ProgrammaticToolCapabilityCeilingsV1 = {
  maxToolEffect: 'write',
  workspace: { kind: 'runtime_default' },
  maxSubagentDepth: 0
}

const quotas: ProgrammaticToolCapabilityQuotasV1 = {
  maxChildren: MAX_PROGRAMMATIC_TOOL_CHILDREN,
  maxBatchSteps: MAX_PROGRAMMATIC_TOOL_BATCH_STEPS,
  maxInputBytes: 1024,
  maxOutputBytes: 2048,
  maxDurationMs: 30_000
}

function expectSurfaceError(run: () => unknown, code: ToolSurfaceError['code']): void {
  try {
    run()
    throw new Error('Expected ToolSurfaceError')
  } catch (error) {
    expect(error).toBeInstanceOf(ToolSurfaceError)
    expect((error as ToolSurfaceError).code).toBe(code)
  }
}

describe('Programmatic Tool Surface', () => {
  it('projects the attached exec contract only onto the Programmatic provider surface', () => {
    const exec = {
      ...agentTool('exec'),
      function: {
        ...agentTool('exec').function,
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            timeoutMs: { type: 'number' },
            background: { type: 'boolean' },
            yieldMs: { type: 'number' }
          },
          required: ['command']
        }
      }
    } satisfies MCPToolDefinition
    const remote = mcpTool('remote_read')
    const exposed = projectProgrammaticExecDefinition([exec, remote])
    const exposedExec = exposed[0]

    expect(exec.function.parameters.properties.stdin).toBeUndefined()
    expect(exposedExec).not.toBe(exec)
    expect(exposedExec.function.description).toContain('DeepChat Programmatic Tool commands')
    expect(exposedExec.function.description).toContain(
      'Omit timeoutMs, background, and yieldMs entirely'
    )
    expect(exposedExec.function.description).toContain('--target <name>')
    expect(exposedExec.function.description).toContain(
      'Describe targets may use exact double quotes'
    )
    expect(exposedExec.function.description).toContain('never use single quotes or escapes')
    expect(exposedExec.function.parameters.properties.stdin).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: MAX_PROGRAMMATIC_TOOL_INPUT_BYTES
    })
    expect(exposedExec.function.parameters.properties.timeoutMs).toEqual({ type: 'number' })
    expect(exposedExec.function.parameters.properties.background).toEqual({ type: 'boolean' })
    expect(exposedExec.function.parameters.properties.yieldMs).toEqual({ type: 'number' })
    expect(exposedExec.function.parameters.required).toEqual(['command'])
    expect(exposed[1]).toBe(remote)
    const reprojected = projectProgrammaticExecDefinition(exposed)
    expect(reprojected[0]).toBe(exposedExec)
    expect(reprojected[1]).toBe(remote)

    expectSurfaceError(
      () =>
        projectProgrammaticExecDefinition([
          {
            ...exec,
            function: {
              ...exec.function,
              parameters: {
                ...exec.function.parameters,
                properties: { ...exec.function.parameters.properties, stdin: { type: 'number' } }
              }
            }
          }
        ]),
      'conflicting_tool'
    )
  })

  it('derives a frozen MCP-only surface disjoint from the provider-active surface', () => {
    const native = agentTool('exec')
    const pinned = mcpTool('remote_read')
    const hiddenRead = mcpTool('remote_search')
    const hiddenWrite = mcpTool('remote_send', 'write')
    const snapshot = buildSnapshot({
      definitions: [hiddenWrite, native, hiddenRead, pinned],
      activeNames: ['exec', 'remote_read']
    })

    const surface = buildProgrammaticToolSurfaceV1(snapshot)

    expect(surface.entries.map((entry) => entry.target.providerVisibleName)).toEqual([
      'remote_search',
      'remote_send'
    ])
    expect(surface.entries.every((entry) => entry.target.source === 'mcp')).toBe(true)
    expect(surface.entries.some((entry) => entry.target.providerVisibleName === 'exec')).toBe(false)
    expect(
      surface.entries.some((entry) => entry.target.providerVisibleName === 'remote_read')
    ).toBe(false)
    expect(surface.catalogHash).toBe(snapshot.eligibleCatalog.fullCatalogHash)
    expect(surface.surfaceHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(Object.isFrozen(surface)).toBe(true)
    expect(Object.isFrozen(surface.entries)).toBe(true)
    expect(Object.isFrozen(surface.entries[0])).toBe(true)
    expect(Object.isFrozen(surface.entries[0].definition)).toBe(true)
    expect(() => assertIssuedProgrammaticToolSurface(surface)).not.toThrow()
  })

  it('keeps surface identity canonical when provider order and input order differ', () => {
    const exec = agentTool('exec')
    const read = mcpTool('remote_read')
    const write = mcpTool('remote_write', 'write')
    const first = buildSnapshot({
      definitions: [write, exec, read],
      activeNames: ['exec']
    })
    const second = buildSnapshot({
      definitions: [read, write, exec],
      activeNames: ['exec']
    })

    expect(buildProgrammaticToolSurfaceV1(first).surfaceHash).toBe(
      buildProgrammaticToolSurfaceV1(second).surfaceHash
    )
  })

  it('binds exact request, surfaces, ceilings, quotas, and TaskContract provenance', () => {
    const snapshot = buildSnapshot({
      definitions: [agentTool('exec'), mcpTool('remote_read')],
      activeNames: ['exec'],
      requestSeq: 3
    })
    const taskContractContext = buildTaskContext()
    const taskContractRef = taskContractContext.localRef

    const capability = buildProgrammaticToolCapabilityV1({
      snapshot,
      taskContractContext,
      ceilings: { ...ceilings, workspace: { kind: 'path', path: path.resolve('task-workspace') } },
      quotas
    })

    expect(capability.adapterMode).toBe(PROGRAMMATIC_TOOL_ADAPTER_MODE)
    expect(capability.request).toEqual(snapshot.request)
    expect(capability.entries).toHaveLength(1)
    expect(capability.catalogHash).toBe(snapshot.eligibleCatalog.fullCatalogHash)
    expect(capability.programmaticSurfaceHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(capability.capabilityHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(capability.taskContractRef).toEqual(taskContractRef)
    expect(capability.ceilings).toEqual({
      ...ceilings,
      workspace: { kind: 'path', path: path.resolve('task-workspace') }
    })
    expect(capability.quotas).toEqual(quotas)
    expect(Object.isFrozen(capability)).toBe(true)
    expect(Object.isFrozen(capability.request)).toBe(true)
    expect(Object.isFrozen(capability.taskContractRef)).toBe(true)
    expect(Object.isFrozen(capability.ceilings.workspace)).toBe(true)
    expect(() => assertIssuedProgrammaticToolCapability(capability)).not.toThrow()
  })

  it('rejects effect expansion, cross-Session provenance, and invalid quotas', () => {
    const snapshot = buildSnapshot({
      definitions: [agentTool('exec'), mcpTool('remote_send', 'write')],
      activeNames: ['exec']
    })

    expectSurfaceError(
      () =>
        buildProgrammaticToolCapabilityV1({
          snapshot,
          taskContractContext: null,
          ceilings: { ...ceilings, maxToolEffect: 'read' },
          quotas
        }),
      'ineligible_exposure'
    )
    expectSurfaceError(
      () =>
        buildProgrammaticToolCapabilityV1({
          snapshot,
          taskContractContext: buildTaskContext({ sessionId: 'another-session' }),
          ceilings,
          quotas
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        buildProgrammaticToolCapabilityV1({
          snapshot,
          taskContractContext: null,
          ceilings: {
            ...ceilings,
            workspace: {
              kind: 'path',
              path: `${path.resolve('workspace')}${String.fromCharCode(0)}suffix`
            }
          },
          quotas
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        buildProgrammaticToolCapabilityV1({
          snapshot,
          taskContractContext: null,
          ceilings,
          quotas: { ...quotas, maxChildren: 1, maxBatchSteps: 2 }
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        buildProgrammaticToolCapabilityV1({
          snapshot,
          taskContractContext: null,
          ceilings,
          quotas: { ...quotas, maxChildren: MAX_PROGRAMMATIC_TOOL_CHILDREN + 1 }
        }),
      'limit_exceeded'
    )
    const inactiveWriteSnapshot = buildSnapshot({
      definitions: [agentTool('exec'), mcpTool('remote_read'), mcpTool('remote_send', 'write')],
      eligibleDefinitions: [agentTool('exec'), mcpTool('remote_read')],
      activeNames: ['exec']
    })
    expectSurfaceError(
      () =>
        buildProgrammaticToolCapabilityV1({
          snapshot: inactiveWriteSnapshot,
          taskContractContext: null,
          ceilings: { ...ceilings, maxToolEffect: 'read' },
          quotas
        }),
      'ineligible_exposure'
    )
  })

  it('binds policy and all runtime authority inputs into capability identity', () => {
    const definitions = [agentTool('exec'), mcpTool('remote_read')]
    const baseInput = {
      taskContractContext: null,
      ceilings,
      quotas
    } as const
    const build = (
      snapshotOverrides: Parameters<typeof buildSnapshot>[0],
      capabilityOverrides: Partial<typeof baseInput> = {}
    ) =>
      buildProgrammaticToolCapabilityV1({
        snapshot: buildSnapshot(snapshotOverrides),
        ...baseInput,
        ...capabilityOverrides
      }).capabilityHash
    const baseSnapshot = { definitions, activeNames: ['exec'] }
    const baseHash = build(baseSnapshot)
    const variants = [
      build({ ...baseSnapshot, policyVersion: 'programmatic-test-v2' }),
      build({ ...baseSnapshot, requestSeq: 2 }),
      build({
        ...baseSnapshot,
        requestOverrides: { sessionId: 'session-2' }
      }),
      build({
        ...baseSnapshot,
        requestOverrides: { messageId: 'message-2' }
      }),
      build({
        ...baseSnapshot,
        requestOverrides: { runId: 'run-2' }
      }),
      build(baseSnapshot, { ceilings: { ...ceilings, maxSubagentDepth: 1 } }),
      build(baseSnapshot, {
        ceilings: { ...ceilings, workspace: { kind: 'path', path: path.resolve('workspace') } }
      }),
      build(baseSnapshot, {
        quotas: {
          ...quotas,
          maxChildren: quotas.maxChildren - 1,
          maxBatchSteps: quotas.maxBatchSteps - 1
        }
      }),
      build(baseSnapshot, { quotas: { ...quotas, maxBatchSteps: quotas.maxBatchSteps - 1 } }),
      build(baseSnapshot, { quotas: { ...quotas, maxInputBytes: quotas.maxInputBytes - 1 } }),
      build(baseSnapshot, { quotas: { ...quotas, maxOutputBytes: quotas.maxOutputBytes - 1 } }),
      build(baseSnapshot, { quotas: { ...quotas, maxDurationMs: quotas.maxDurationMs - 1 } }),
      build({
        definitions: [
          agentTool('exec'),
          mcpTool('remote_read', 'write')
        ],
        activeNames: ['exec']
      }),
      build({
        definitions: [agentTool('exec'), mcpTool('remote_read', 'read', { revision: 2 })],
        activeNames: ['exec']
      })
    ]

    expect(new Set(variants).size).toBe(variants.length)
    expect(variants.every((hash) => hash !== baseHash)).toBe(true)
  })

  it('validates TaskContract ceilings and canonical workspace paths in memory', () => {
    const snapshot = buildSnapshot({
      definitions: [agentTool('exec'), mcpTool('remote_read')],
      activeNames: ['exec']
    })
    const taskWorkspace = path.resolve('task-workspace')
    const taskContext = buildTaskContext({
      workspace: taskWorkspace,
      maxToolEffect: 'read',
      maxSubagentDepth: 0
    })
    const build = (overrides: Partial<ProgrammaticToolCapabilityCeilingsV1>) =>
      buildProgrammaticToolCapabilityV1({
        snapshot,
        taskContractContext: taskContext,
        ceilings: {
          maxToolEffect: 'read',
          workspace: { kind: 'path', path: path.join(taskWorkspace, 'child', '..', 'child') },
          maxSubagentDepth: 0,
          ...overrides
        },
        quotas
      })

    expect(build({}).ceilings.workspace).toEqual({
      kind: 'path',
      path: path.join(taskWorkspace, 'child')
    })
    expectSurfaceError(
      () => build({ maxToolEffect: 'write' }),
      'ineligible_exposure'
    )
    expectSurfaceError(
      () => build({ workspace: { kind: 'path', path: path.resolve('outside') } }),
      'ineligible_exposure'
    )
    expectSurfaceError(
      () => build({ maxSubagentDepth: 1 }),
      'ineligible_exposure'
    )
    expectSurfaceError(
      () =>
        buildProgrammaticToolCapabilityV1({
          snapshot,
          taskContractContext: null,
          ceilings: { ...ceilings, workspace: { kind: 'path', path: 'relative/path' } },
          quotas
        }),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        buildProgrammaticToolCapabilityV1({
          snapshot,
          taskContractContext: buildTaskContext({ contractHash: 'c'.repeat(64) }),
          ceilings,
          quotas
        }),
      'invalid_definition'
    )
    const secondTaskContext = {
      ...taskContext,
      localRef: { ...taskContext.localRef, entryId: taskContext.localRef.entryId + 1 }
    }
    const firstTaskCapability = build({})
    const secondTaskCapability = buildProgrammaticToolCapabilityV1({
      snapshot,
      taskContractContext: secondTaskContext,
      ceilings: firstTaskCapability.ceilings,
      quotas
    })
    expect(secondTaskCapability.capabilityHash).not.toBe(firstTaskCapability.capabilityHash)
  })

  it('preflights the maximum Run programmatic projection before adapter admission', () => {
    const exec = agentTool('exec')
    const remoteTools = Array.from({ length: 300 }, (_, index) => {
      const identity = String(index).padStart(3, '0')
      const definition = mcpTool(`remote_${identity}_${'x'.repeat(450)}`)
      definition.server.name = `server_${identity}_${'y'.repeat(900)}`
      return definition
    })
    const snapshot = buildSnapshot({
      definitions: [exec, ...remoteTools],
      eligibleDefinitions: [exec, remoteTools[0]],
      activeNames: ['exec'],
      directSnapshot: true
    })
    expect(buildProgrammaticToolSurfaceV1(snapshot).entries).toHaveLength(1)
    expectSurfaceError(
      () =>
        preflightProgrammaticToolRunCeilingV1({
          ceiling: snapshot.ceiling
        }),
      'limit_exceeded'
    )
    expectSurfaceError(
      () =>
        createProgrammaticToolSurfaceRunControllerV1({
          ceilingDefinitions: [exec, ...remoteTools],
          providerActiveDefinitions: [exec],
          policyVersion: 'programmatic-test-v1'
        }),
      'limit_exceeded'
    )
    expect(MAX_PROGRAMMATIC_TOOL_AUTHORITY_PROJECTION_BYTES).toBe(1024 * 1024)
  })

  it('separates capability issuance from active provider-View authority', () => {
    const snapshot = buildSnapshot({
      definitions: [agentTool('exec'), mcpTool('remote_read')],
      activeNames: ['exec']
    })
    const capability = buildProgrammaticToolCapabilityV1({
      snapshot,
      taskContractContext: null,
      ceilings,
      quotas
    })

    expect(() => assertIssuedProgrammaticToolCapability(capability)).not.toThrow()
    expectSurfaceError(
      () => assertProgrammaticToolCapabilityViewActive(capability, snapshot),
      'invalid_definition'
    )
  })

  it('activates capabilities only with their admitted View and revokes superseded Views', () => {
    const exec = agentTool('exec')
    const pinned = mcpTool('remote_read')
    const hidden = mcpTool('remote_search')
    const controller = createProgrammaticToolSurfaceRunControllerV1({
      ceilingDefinitions: [hidden, exec, pinned],
      providerActiveDefinitions: [exec, pinned],
      policyVersion: 'programmatic-test-v1'
    })
    const request = (requestSeq: number) => ({
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: 'run-1',
      requestSeq
    })
    const firstSnapshot = controller.build({
      request: request(1),
      eligibleDefinitions: [hidden, exec, pinned]
    })
    const firstCapability = buildProgrammaticToolCapabilityV1({
      snapshot: firstSnapshot,
      taskContractContext: null,
      ceilings,
      quotas
    })

    expect(firstSnapshot.adapterMode).toBe('cli-programmatic')
    expect(firstSnapshot.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'exec',
      'remote_read'
    ])
    expect(firstCapability.entries.map((entry) => entry.target.providerVisibleName)).toEqual([
      'remote_search'
    ])
    expectSurfaceError(
      () => assertProgrammaticToolCapabilityViewActive(firstCapability, firstSnapshot),
      'invalid_definition'
    )

    controller.admit(firstSnapshot)
    expectSurfaceError(
      () => assertProgrammaticToolCapabilityViewActive(firstCapability, firstSnapshot),
      'invalid_definition'
    )
    markProgrammaticToolCapabilityProvenanceCommitted(firstCapability, firstSnapshot)
    expect(() =>
      assertProgrammaticToolCapabilityViewActive(firstCapability, firstSnapshot)
    ).not.toThrow()
    expect(() =>
      assertProgrammaticToolCapabilityViewActive(firstCapability, firstSnapshot)
    ).not.toThrow()

    const secondSnapshot = controller.build({
      request: request(2),
      eligibleDefinitions: [hidden]
    })
    const secondCapability = buildProgrammaticToolCapabilityV1({
      snapshot: secondSnapshot,
      taskContractContext: null,
      ceilings,
      quotas
    })
    markProgrammaticToolCapabilityProvenanceCommitted(secondCapability, secondSnapshot)
    controller.admit(secondSnapshot)

    expectSurfaceError(
      () => assertProgrammaticToolCapabilityViewActive(firstCapability, firstSnapshot),
      'invalid_definition'
    )
    expect(() =>
      assertProgrammaticToolCapabilityViewActive(secondCapability, secondSnapshot)
    ).not.toThrow()
    expect(secondSnapshot.toolDefinitions).toEqual([])
    expect(secondCapability.entries.map((entry) => entry.target.providerVisibleName)).toEqual([
      'remote_search'
    ])

    const driftedExec = {
      ...exec,
      function: {
        ...exec.function,
        description: 'A drifted exec contract',
        parameters: {
          ...exec.function.parameters,
          properties: { ...exec.function.parameters.properties, stdin: { type: 'number' } }
        }
      }
    }
    const spoofedExec = {
      ...exec,
      server: { ...exec.server, name: 'agent-tools' }
    }
    const driftedSnapshot = controller.build({
      request: request(3),
      eligibleDefinitions: [hidden, driftedExec, spoofedExec]
    })
    const driftedCapability = buildProgrammaticToolCapabilityV1({
      snapshot: driftedSnapshot,
      taskContractContext: null,
      ceilings,
      quotas
    })
    markProgrammaticToolCapabilityProvenanceCommitted(driftedCapability, driftedSnapshot)
    controller.admit(driftedSnapshot)

    expect(driftedSnapshot.toolDefinitions).toEqual([])
    expect(driftedCapability.entries.map((entry) => entry.target.providerVisibleName)).toEqual([
      'remote_search'
    ])
    expectSurfaceError(
      () => assertProgrammaticToolCapabilityViewActive(secondCapability, secondSnapshot),
      'invalid_definition'
    )

    const restoredSnapshot = controller.build({
      request: request(4),
      eligibleDefinitions: [hidden, pinned, exec]
    })
    const restoredCapability = buildProgrammaticToolCapabilityV1({
      snapshot: restoredSnapshot,
      taskContractContext: null,
      ceilings,
      quotas
    })
    expectSurfaceError(
      () => assertProgrammaticToolCapabilityViewActive(restoredCapability, restoredSnapshot),
      'invalid_definition'
    )
    markProgrammaticToolCapabilityProvenanceCommitted(restoredCapability, restoredSnapshot)
    controller.admit(restoredSnapshot)
    expectSurfaceError(
      () => assertProgrammaticToolCapabilityViewActive(secondCapability, secondSnapshot),
      'invalid_definition'
    )
    expect(restoredSnapshot.toolDefinitions.map((definition) => definition.function.name)).toEqual([
      'exec',
      'remote_read'
    ])
    expect(restoredCapability.entries.map((entry) => entry.target.providerVisibleName)).toEqual([
      'remote_search'
    ])
    revokeToolSurfaceExecutionEligibility(restoredSnapshot)
    expectSurfaceError(
      () => assertProgrammaticToolCapabilityViewActive(restoredCapability, restoredSnapshot),
      'invalid_definition'
    )
  })

  it('bridges a revoked View only through its exact process-live deferred approval', () => {
    const exec = agentTool('exec')
    const hidden = mcpTool('remote_search')
    const controller = createProgrammaticToolSurfaceRunControllerV1({
      ceilingDefinitions: [exec, hidden],
      providerActiveDefinitions: [exec],
      policyVersion: 'programmatic-test-v1'
    })
    const snapshot = controller.build({
      request: { sessionId: 'session-1', messageId: 'message-1', runId: 'run-1', requestSeq: 1 },
      eligibleDefinitions: [exec, hidden]
    })
    const capability = buildProgrammaticToolCapabilityV1({
      snapshot,
      taskContractContext: null,
      ceilings,
      quotas
    })
    markProgrammaticToolCapabilityProvenanceCommitted(capability, snapshot)
    controller.admit(snapshot)
    const binding = buildToolSurfaceDeferredDispatchBinding({
      snapshot,
      toolCallId: 'exec-call-1',
      toolName: 'exec',
      contractBearing: false
    })
    const deferred = registerToolSurfaceDeferredDispatch({
      snapshot,
      toolCallId: 'exec-call-1',
      toolName: 'exec',
      binding
    })
    attachProgrammaticToolDeferredResumeCapability(deferred, capability)
    revokeToolSurfaceExecutionEligibility(snapshot)

    expectSurfaceError(
      () => assertProgrammaticToolCapabilityViewActive(capability, snapshot),
      'invalid_definition'
    )
    expect(requireProgrammaticToolDeferredResumeCapability(deferred)).toBe(capability)

    consumeToolSurfaceDeferredDispatch(deferred, {
      sessionId: 'session-1',
      messageId: 'message-1',
      toolCallId: 'exec-call-1',
      toolName: 'exec'
    })
    expectSurfaceError(
      () => requireProgrammaticToolDeferredResumeCapability(deferred),
      'invalid_definition'
    )

    const recovered = issueRecoveredToolSurfaceDeferredDispatch(binding, exec.execution)
    expectSurfaceError(
      () => requireProgrammaticToolDeferredResumeCapability(recovered),
      'ineligible_exposure'
    )
    revokeToolSurfaceDeferredDispatchesForSession('session-1')
  })

  it('rejects a live capability outside its exact current provider View', () => {
    const definitions = [agentTool('exec'), mcpTool('remote_search')]
    const createController = () =>
      createProgrammaticToolSurfaceRunControllerV1({
        ceilingDefinitions: definitions,
        providerActiveDefinitions: [definitions[0]],
        policyVersion: 'programmatic-test-v1'
      })
    const firstController = createController()
    const secondController = createController()
    const request = {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: 'run-1',
      requestSeq: 1
    }
    const firstSnapshot = firstController.build({ request, eligibleDefinitions: definitions })
    const secondSnapshot = secondController.build({ request, eligibleDefinitions: definitions })
    const firstCapability = buildProgrammaticToolCapabilityV1({
      snapshot: firstSnapshot,
      taskContractContext: null,
      ceilings,
      quotas
    })
    markProgrammaticToolCapabilityProvenanceCommitted(firstCapability, firstSnapshot)
    firstController.admit(firstSnapshot)
    secondController.admit(secondSnapshot)

    expect(() =>
      assertProgrammaticToolCapabilityViewActive(firstCapability, firstSnapshot)
    ).not.toThrow()
    expectSurfaceError(
      () => assertProgrammaticToolCapabilityViewActive(firstCapability, secondSnapshot),
      'invalid_definition'
    )
  })

  it('keeps the provider path fixed and rejects unsafe Programmatic Run admission', () => {
    const exec = agentTool('exec')
    const spoofedExec = {
      ...agentTool('question'),
      function: { ...agentTool('question').function, name: 'exec' }
    }
    const question = agentTool('question')
    const hidden = mcpTool('remote_search')
    const pinned = mcpTool('remote_read')

    expectSurfaceError(
      () =>
        createProgrammaticToolSurfaceRunControllerV1({
          ceilingDefinitions: [question, hidden],
          providerActiveDefinitions: [question],
          policyVersion: 'programmatic-test-v1'
        }),
      'ineligible_exposure'
    )
    expectSurfaceError(
      () =>
        createProgrammaticToolSurfaceRunControllerV1({
          ceilingDefinitions: [spoofedExec, hidden],
          providerActiveDefinitions: [spoofedExec],
          policyVersion: 'programmatic-test-v1'
        }),
      'ineligible_exposure'
    )
    expectSurfaceError(
      () =>
        createProgrammaticToolSurfaceRunControllerV1({
          ceilingDefinitions: [exec, question, hidden],
          providerActiveDefinitions: [exec],
          policyVersion: 'programmatic-test-v1'
        }),
      'ineligible_exposure'
    )

    const controller = createProgrammaticToolSurfaceRunControllerV1({
      ceilingDefinitions: [exec, hidden, pinned],
      providerActiveDefinitions: [exec, pinned],
      policyVersion: 'programmatic-test-v1'
    })
    expectSurfaceError(
      () =>
        controller.build({
          request: {
            sessionId: 'session-1',
            messageId: 'message-1',
            runId: 'run-1',
            requestSeq: 1
          },
          eligibleDefinitions: [exec, hidden]
        }),
      'ineligible_exposure'
    )
    expectSurfaceError(
      () =>
        controller.build({
          request: {
            sessionId: 'session-1',
            messageId: 'message-1',
            runId: 'run-1',
            requestSeq: 1
          },
          eligibleDefinitions: [hidden, pinned]
        }),
      'ineligible_exposure'
    )
    const first = controller.build({
      request: { sessionId: 'session-1', messageId: 'message-1', runId: 'run-1', requestSeq: 1 },
      eligibleDefinitions: [exec, hidden, pinned]
    })
    const competing = controller.build({
      request: { sessionId: 'session-1', messageId: 'message-1', runId: 'run-1', requestSeq: 2 },
      eligibleDefinitions: [exec, hidden, pinned]
    })
    controller.admit(first)

    expectSurfaceError(() => controller.admit(competing), 'conflicting_tool')
    const firstCapability = buildProgrammaticToolCapabilityV1({
      snapshot: first,
      taskContractContext: null,
      ceilings,
      quotas
    })
    markProgrammaticToolCapabilityProvenanceCommitted(firstCapability, first)
    const revokedBeforeAdmission = controller.build({
      request: { sessionId: 'session-1', messageId: 'message-1', runId: 'run-1', requestSeq: 3 },
      eligibleDefinitions: [exec, hidden, pinned]
    })
    revokeToolSurfaceExecutionEligibility(revokedBeforeAdmission)
    expectSurfaceError(() => controller.admit(revokedBeforeAdmission), 'invalid_definition')
    expect(() =>
      assertProgrammaticToolCapabilityViewActive(firstCapability, first)
    ).not.toThrow()
    expectSurfaceError(
      () => controller.stageActivationBatch([{} as never]),
      'invalid_definition'
    )
    expectSurfaceError(
      () =>
        controller.build({
          request: {
            sessionId: 'other-session',
            messageId: 'message-1',
            runId: 'run-1',
            requestSeq: 3
          },
          eligibleDefinitions: [exec, hidden, pinned]
        }),
      'invalid_definition'
    )
  })

  it('does not charge fixed native MCP tools against Programmatic effect authority', () => {
    const exec = agentTool('exec')
    const nativeWrite = mcpTool('remote_send', 'write')
    const programmaticRead = mcpTool('remote_search')
    const controller = createProgrammaticToolSurfaceRunControllerV1({
      ceilingDefinitions: [exec, nativeWrite, programmaticRead],
      providerActiveDefinitions: [exec, nativeWrite],
      policyVersion: 'programmatic-test-v1'
    })
    const snapshot = controller.build({
      request: { sessionId: 'session-1', messageId: 'message-1', runId: 'run-1', requestSeq: 1 },
      eligibleDefinitions: [exec, nativeWrite, programmaticRead]
    })

    const capability = buildProgrammaticToolCapabilityV1({
      snapshot,
      taskContractContext: null,
      ceilings: { ...ceilings, maxToolEffect: 'read' },
      quotas
    })

    expect(capability.entries.map((entry) => entry.target.providerVisibleName)).toEqual([
      'remote_search'
    ])
    expect(capability.ceilings.maxToolEffect).toBe('read')
  })

  it('projects bounded Tape provenance without raw definitions or workspace paths', () => {
    const exec = agentTool('exec')
    const hidden = mcpTool('remote_search')
    const controller = createProgrammaticToolSurfaceRunControllerV1({
      ceilingDefinitions: [exec, hidden],
      providerActiveDefinitions: [exec],
      policyVersion: 'programmatic-test-v1'
    })
    const snapshot = controller.build({
      request: { sessionId: 'session-1', messageId: 'message-1', runId: 'run-1', requestSeq: 1 },
      eligibleDefinitions: [exec, hidden]
    })
    const capability = buildProgrammaticToolCapabilityV1({
      snapshot,
      taskContractContext: null,
      ceilings: {
        ...ceilings,
        workspace: { kind: 'path', path: path.resolve('private-workspace') }
      },
      quotas
    })

    const projection = projectProgrammaticToolTapeProvenanceV1(capability)
    const serialized = JSON.stringify(projection)

    expect(serialized).not.toContain(path.resolve('private-workspace'))
    expect(serialized).not.toContain('parameters')
    expect(projection.entries[0]).not.toHaveProperty('definition')
    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.entries)).toBe(true)
    expect(() =>
      createTapeProgrammaticToolSurfaceFact({
        ...projection,
        manifestHash: 'd'.repeat(64),
        catalog: {
          sessionId: 'session-1',
          tapeIncarnationId: '22222222-2222-4222-8222-222222222222',
          entryId: 7,
          fullCatalogHash: capability.catalogHash,
          catalogFactHash: 'e'.repeat(64)
        },
        contractBearing: false
      })
    ).not.toThrow()
  })

  it('rejects forged snapshots, surfaces, and capabilities', () => {
    expectSurfaceError(
      () => buildProgrammaticToolSurfaceV1({} as never),
      'invalid_definition'
    )
    expectSurfaceError(
      () => assertIssuedProgrammaticToolSurface({}),
      'invalid_definition'
    )
    expectSurfaceError(
      () => assertIssuedProgrammaticToolCapability({}),
      'invalid_definition'
    )
    expectSurfaceError(
      () => buildProgrammaticToolCapabilityV1({} as never),
      'invalid_definition'
    )
    const nativeSnapshot = createToolSurfaceSnapshot({
      request: { sessionId: 'session-1', messageId: 'message-1', runId: 'run-1', requestSeq: 1 },
      policyVersion: 'native-test-v1',
      virtualizationTriggered: true,
      ceiling: buildToolSurfaceRunCeiling([]),
      eligibleDefinitions: [],
      activationLedger: createToolSurfaceActivationLedger([])
    })
    expectSurfaceError(
      () =>
        buildProgrammaticToolCapabilityV1({
          snapshot: nativeSnapshot,
          taskContractContext: null,
          ceilings,
          quotas
        }),
      'ineligible_exposure'
    )
    const unboundProgrammaticSnapshot = buildSnapshot({
      definitions: [agentTool('exec'), mcpTool('remote_read')],
      activeNames: ['exec'],
      directSnapshot: true
    })
    expectSurfaceError(
      () =>
        buildProgrammaticToolCapabilityV1({
          snapshot: unboundProgrammaticSnapshot,
          taskContractContext: null,
          ceilings,
          quotas
        }),
      'ineligible_exposure'
    )
  })
})
