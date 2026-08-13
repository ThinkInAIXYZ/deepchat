import { describe, expect, it, vi } from 'vitest'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/core/mcp'
import {
  buildExecutionContract,
  buildExecutionContractBinding
} from '@/tape/domain/executionContract'
import { createTapeViewManifest } from '@/tape/domain/viewManifest'
import { resolveDeferredExecutionContract } from '@/agent/deepchat/runtime/deferredExecutionContract'

const RUN_ID = '11111111-1111-4111-8111-111111111111'
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

function createFixture(permissionMode: 'default' | 'full_access' = 'default') {
  const messages = [{ role: 'user' as const, content: 'Write a.txt' }]
  const executionContract = buildExecutionContract({
    request: {
      sessionId: 'session-1',
      messageId: 'message-1',
      runId: RUN_ID,
      requestSeq: 3
    },
    promptAssembly: { prompt: '', sections: [] },
    providerMessages: messages,
    tools: [TOOL],
    providerId: 'openai',
    modelId: 'gpt-5',
    modelConfig: {} as any,
    temperature: 0.2,
    maxTokens: 100,
    workspace: { kind: 'path', path: '/workspace' },
    maxSubagentDepth: 0,
    dynamicControlSnapshot: {
      permissionMode,
      requestAdmitted: true,
      cancellationRequested: false
    },
    assemblerVersion: 'test-v1'
  })
  const manifest = createTapeViewManifest({
    sessionId: 'session-1',
    messageId: 'message-1',
    requestSeq: 3,
    taskType: 'tool_loop',
    policy: 'tool_loop_shadow',
    policyVersion: null,
    contextBuilderVersion: 'legacy-v1',
    messages,
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
    executionContract,
    assembledAt: 123
  })
  const record = {
    sessionId: 'session-1',
    messageId: 'message-1',
    requestSeq: 3,
    entryId: 8,
    createdAt: 123,
    integrity: 'valid' as const,
    manifest
  }
  return {
    executionContract,
    manifest,
    record,
    rawBinding: JSON.stringify(buildExecutionContractBinding(executionContract))
  }
}

function createReader(
  records: ReturnType<typeof createFixture>['record'][] = [],
  executionRecord: ReturnType<typeof createFixture>['record'] | null = null
) {
  return {
    listViewManifestsByMessage: vi.fn(() => records),
    getViewManifestByExecutionBinding: vi.fn(() => executionRecord)
  }
}

describe('deferred ExecutionContract recovery', () => {
  it('uses the exact live projection without reading Tape', () => {
    const fixture = createFixture()
    const viewManifests = createReader()

    const resolved = resolveDeferredExecutionContract({
      sessionId: 'session-1',
      messageId: 'message-1',
      rawBinding: fixture.rawBinding,
      runtimeContract: fixture.executionContract,
      viewManifests
    })

    expect(resolved).toBe(fixture.executionContract)
    expect(viewManifests.listViewManifestsByMessage).not.toHaveBeenCalled()
  })

  it('recovers a frozen projection from the single hash-verified v5 View', () => {
    const fixture = createFixture()
    const storedRecord = JSON.parse(JSON.stringify(fixture.record)) as typeof fixture.record
    const viewManifests = createReader([storedRecord])

    const resolved = resolveDeferredExecutionContract({
      sessionId: 'session-1',
      messageId: 'message-1',
      rawBinding: fixture.rawBinding,
      viewManifests
    })

    expect(resolved).toEqual(fixture.executionContract)
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(viewManifests.listViewManifestsByMessage).toHaveBeenCalledWith(
      'session-1',
      'message-1'
    )
  })

  it('recovers Skill-bearing contracts only through their exact execution binding', () => {
    const fixture = createFixture()
    const manifest = createTapeViewManifest({
      ...fixture.record.manifest,
      messages: [{ role: 'user', content: 'Write a.txt' }],
      tools: [TOOL],
      providerId: 'openai',
      modelId: 'gpt-5',
      summaryCursorOrderSeq: 1,
      supportsVision: false,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      runId: RUN_ID,
      tapeIncarnationId: 'tape-1',
      skillContexts: [
        {
          activationScope: 'message',
          agentId: 'deepchat',
          sourceType: 'builtin',
          sourceId: 'builtin-skills',
          skillName: 'review',
          authoritativeRef: {
            kind: 'materialization',
            entryId: 6,
            tapeIncarnationId: 'tape-1',
            agentId: 'deepchat',
            sourceType: 'builtin',
            sourceId: 'builtin-skills',
            skillName: 'review',
            effectiveContentHash: 'a'.repeat(64)
          },
          providerRole: 'user',
          sourceEntryIds: [5],
          projectedContentHash: 'a'.repeat(64),
          projectionVersion: 1,
          deduplicationSource: 'message'
        }
      ],
      executionContract: fixture.executionContract
    })
    const record = { ...fixture.record, manifest }
    const viewManifests = createReader([], record)

    expect(
      resolveDeferredExecutionContract({
        sessionId: 'session-1',
        messageId: 'message-1',
        rawBinding: fixture.rawBinding,
        viewManifests
      })
    ).toEqual(fixture.executionContract)
    expect(viewManifests.getViewManifestByExecutionBinding).toHaveBeenCalledWith({
      sessionId: 'session-1',
      runId: RUN_ID,
      requestSeq: 3
    })
    expect(viewManifests.listViewManifestsByMessage).not.toHaveBeenCalled()

    const executableManifest = createTapeViewManifest({
      ...manifest,
      messages: [{ role: 'user', content: 'Write a.txt' }],
      tools: [TOOL],
      providerId: 'openai',
      modelId: 'gpt-5',
      summaryCursorOrderSeq: 1,
      supportsVision: false,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      skillContexts: [
        ...manifest.skillContexts,
        {
          activationScope: 'runtime_view',
          agentId: 'deepchat',
          sourceType: 'builtin',
          sourceId: 'builtin-skills',
          skillName: 'runner',
          authoritativeRef: {
            kind: 'tool_result',
            entryId: 7,
            contentHash: 'b'.repeat(64)
          },
          executionRef: {
            kind: 'materialization',
            entryId: 6,
            tapeIncarnationId: 'tape-1',
            agentId: 'deepchat',
            sourceType: 'builtin',
            sourceId: 'builtin-skills',
            skillName: 'runner',
            effectiveContentHash: 'c'.repeat(64)
          },
          providerRole: 'tool',
          sourceEntryIds: [],
          projectedContentHash: 'b'.repeat(64),
          projectionVersion: 1,
          deduplicationSource: 'runtime_view'
        }
      ]
    })
    expect(executableManifest.schemaVersion).toBe(7)
    viewManifests.getViewManifestByExecutionBinding.mockReturnValue({
      ...record,
      manifest: executableManifest
    })
    expect(
      resolveDeferredExecutionContract({
        sessionId: 'session-1',
        messageId: 'message-1',
        rawBinding: fixture.rawBinding,
        viewManifests
      })
    ).toEqual(fixture.executionContract)
  })

  it('keeps legacy unbound interactions compatible without reading Tape', () => {
    const viewManifests = createReader()

    expect(
      resolveDeferredExecutionContract({
        sessionId: 'session-1',
        messageId: 'message-1',
        rawBinding: undefined,
        viewManifests
      })
    ).toBeUndefined()
    expect(viewManifests.listViewManifestsByMessage).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'missing View', records: () => [] },
    {
      name: 'duplicate View',
      records: (fixture: ReturnType<typeof createFixture>) => [
        fixture.record,
        { ...fixture.record, entryId: fixture.record.entryId + 1 }
      ]
    },
    {
      name: 'invalid manifest hash',
      records: (fixture: ReturnType<typeof createFixture>) => [
        {
          ...fixture.record,
          manifest: { ...fixture.manifest, viewId: 'tampered' }
        }
      ]
    },
    {
      name: 'conflicting contract',
      records: () => [createFixture('full_access').record]
    }
  ])('fails closed on $name', (scenario) => {
    const fixture = createFixture()
    const records = scenario.records(fixture) as typeof fixture.record[]

    expect(() =>
      resolveDeferredExecutionContract({
        sessionId: 'session-1',
        messageId: 'message-1',
        rawBinding: fixture.rawBinding,
        viewManifests: createReader(records)
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_contract' }))
  })

  it('rejects a binding for another message before reading Tape', () => {
    const fixture = createFixture()
    const binding = buildExecutionContractBinding(fixture.executionContract)
    const viewManifests = createReader([fixture.record])

    expect(() =>
      resolveDeferredExecutionContract({
        sessionId: 'session-1',
        messageId: 'other-message',
        rawBinding: JSON.stringify(binding),
        viewManifests
      })
    ).toThrow(expect.objectContaining({ code: 'identity_mismatch' }))
    expect(viewManifests.listViewManifestsByMessage).not.toHaveBeenCalled()
  })

  it.each(['{', 'x'.repeat(4097)])('rejects malformed or oversized binding data', (rawBinding) => {
    const viewManifests = createReader()

    expect(() =>
      resolveDeferredExecutionContract({
        sessionId: 'session-1',
        messageId: 'message-1',
        rawBinding,
        viewManifests
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_contract' }))
    expect(viewManifests.listViewManifestsByMessage).not.toHaveBeenCalled()
  })
})
