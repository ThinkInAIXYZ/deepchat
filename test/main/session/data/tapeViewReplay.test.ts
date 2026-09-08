import type { TapeViewManifestBuildInput } from '@/tape/domain/viewManifest'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { DeepChatTapeSkillMaterializationRef } from '@shared/types/tape-view-manifest'
import {
  buildTapeSkillMaterializationRef,
  hashSkillEffectiveContent
} from '@/tape/domain/skillMaterialization'
import { hashJsonData } from '@/tape/domain/canonicalJson'
import {
  describe,
  expect,
  it,
  vi,
  SessionTape,
  createTapeViewManifest,
  appendMessageRecordToTape,
  appendMessageRetractionToTape,
  appendToolFactsToTape,
  buildRequestRefs,
  createTapeTableMock,
  createRecord,
  createTranscriptProjectionMock,
  createObservationManifest,
  createTapeService
} from './tapeTestHarness'

const RUNTIME_SKILL_OPERATION = {
  runId: '11111111-1111-4111-8111-111111111111',
  requestSeq: 1,
  providerToolCallId: 'tool-call-1'
}

function commitRuntimeSkillOutcome(
  service: ReturnType<typeof createTapeService>,
  responseText: string,
  skillName = 'review'
) {
  service.commitRunStarted({
    sessionId: 's1',
    runId: RUNTIME_SKILL_OPERATION.runId,
    messageId: 'a1',
    runKind: 'loop'
  })
  service.commitDispatch({
    sessionId: 's1',
    messageId: 'a1',
    operation: RUNTIME_SKILL_OPERATION,
    toolName: 'skill_view',
    toolSource: 'agent',
    normalizedArguments: { name: skillName },
    target: { serverName: 'agent-skills', originalName: 'skill_view' }
  })
  const outcome = service.commitToolOutcome({
    sessionId: 's1',
    messageId: 'a1',
    operation: RUNTIME_SKILL_OPERATION,
    responseText,
    isError: false
  })
  return { operation: RUNTIME_SKILL_OPERATION, outcomeEntryId: outcome.entryId }
}

function materializeRuntimeExecutionPackage(
  service: ReturnType<typeof createTapeService>,
  tapeIncarnationId: string,
  effectiveContent: string,
  builderVersion = 'skill-effective-content-v2',
  skillName = 'review'
): DeepChatTapeSkillMaterializationRef {
  const [receipt] = service.materializeSkillContexts([
    {
      sessionId: 's1',
      expectedTapeIncarnationId: tapeIncarnationId,
      agentId: 'deepchat',
      sourceType: 'builtin',
      sourceId: 'builtin-skills',
      skillName,
      effectiveContent,
      builderVersion,
      renderedManifestHash: hashSkillEffectiveContent(`manifest:${builderVersion}`),
      scriptInventoryHash: hashSkillEffectiveContent('scripts'),
      executionPackage: {
        files: [],
        executables: [],
        runtimePolicy: { python: 'auto', node: 'auto' },
        environmentBindingId: null
      }
    }
  ])
  const { sessionId: _sessionId, ...ref } = buildTapeSkillMaterializationRef(receipt)
  return ref
}

function appendRuntimeExecutionManifest(input: {
  service: ReturnType<typeof createTapeService>
  tapeIncarnationId: string
  responseText: string
  toolResult: { entryId: number; contentHash: string }
  executionRef: DeepChatTapeSkillMaterializationRef
  requestSeq: number
  runId?: string
  skillName?: string
}): void {
  input.service.appendViewManifest(
    createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: input.requestSeq,
      taskType: 'tool_loop',
      policy: 'tool_loop_shadow',
      policyVersion: null,
      messages: [{ role: 'tool', content: input.responseText, tool_call_id: 'tool-call-1' }],
      tools: [],
      latestEntryId: input.executionRef.entryId,
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
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: false,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      runId: input.runId ?? 'runtime-recovery-run',
      tapeIncarnationId: input.tapeIncarnationId,
      skillContexts: [
        {
          activationScope: 'runtime_view',
          agentId: 'deepchat',
          sourceType: 'builtin',
          sourceId: 'builtin-skills',
          skillName: input.skillName ?? 'review',
          authoritativeRef: {
            kind: 'tool_result',
            entryId: input.toolResult.entryId,
            contentHash: input.toolResult.contentHash
          },
          executionRef: input.executionRef,
          providerRole: 'tool',
          sourceEntryIds: [],
          projectedContentHash: input.toolResult.contentHash,
          projectionVersion: 1,
          deduplicationSource: 'runtime_view'
        }
      ],
      assembledAt: 300 + input.requestSeq
    })
  )
}

describe('SessionTape view and replay', () => {
  it('resolves an effective user-message source through the indexed message history', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const user = createRecord({ id: 'u1', orderSeq: 1, role: 'user', status: 'sent' })
    const pending = createRecord({ id: 'u2', orderSeq: 2, role: 'user', status: 'pending' })
    const assistant = createRecord({
      id: 'a1',
      orderSeq: 3,
      role: 'assistant',
      status: 'sent'
    })
    appendMessageRecordToTape(table as any, user, 'live')
    appendMessageRecordToTape(table as any, pending, 'live')
    appendMessageRecordToTape(table as any, assistant, 'live')

    const userEntryId = entries.find(
      (entry) => entry.kind === 'message' && entry.source_id === user.id
    )!.entry_id
    const pendingEntryId = entries.find(
      (entry) => entry.kind === 'message' && entry.source_id === pending.id
    )!.entry_id
    expect(service.getEffectiveUserMessageSourceEntryId('s1', user.id)).toBe(userEntryId)
    // Pending steer messages are valid active-turn sources until the claim is settled.
    expect(service.getEffectiveUserMessageSourceEntryId('s1', pending.id)).toBe(pendingEntryId)
    expect(service.getEffectiveUserMessageSourceEntryId('s1', assistant.id)).toBeNull()
    expect(table.getBySessionExcludingContext).not.toHaveBeenCalled()

    appendMessageRetractionToTape(table as any, user, 'deleted')
    expect(service.getEffectiveUserMessageSourceEntryId('s1', user.id)).toBeNull()
  })

  it('fails closed on a malformed user-message source envelope', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'u1', seq: 0 },
      payload: { record: createRecord({ id: 'another-id', orderSeq: 1 }) }
    })

    expect(() => service.getEffectiveUserMessageSourceEntryId('s1', 'u1')).toThrow(
      /physical envelope/
    )
  })

  it('recovers runtime Skill identity only from exact tool and execution facts', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    table.ensureBootstrapAnchor('s1')
    const tapeIncarnationId = table.getBootstrapIncarnation('s1')!
    const responseText = JSON.stringify({
      success: true,
      name: 'review',
      content: '# Review\n\nFollow the review contract.',
      activatedForMessage: true,
      activationScope: 'message',
      activationEvidenceVersion: 1
    })
    const fact = service.appendSkillViewResultFact({
      sessionId: 's1',
      expectedTapeIncarnationId: tapeIncarnationId,
      messageId: 'a1',
      orderSeq: 2,
      blockIndex: 0,
      toolCallId: 'tool-call-1',
      toolName: 'skill_view',
      responseText,
      timestamp: 100,
      ...commitRuntimeSkillOutcome(service, responseText),
      identity: {
        agentId: 'deepchat',
        sourceType: 'builtin',
        sourceId: 'builtin-skills',
        skillName: 'review'
      }
    })
    const recoveryInput = {
      sessionId: 's1',
      messageId: 'a1',
      messageOrderSeq: 2,
      expectedTapeIncarnationId: tapeIncarnationId,
      projections: [{ toolCallId: 'tool-call-1', responseText, blockIndex: 0, timestamp: 100 }]
    }
    expect(() => service.recoverRuntimeSkillViewContexts(recoveryInput)).toThrow(
      /no unique execution package authority/
    )
    const executionRef = materializeRuntimeExecutionPackage(
      service,
      tapeIncarnationId,
      '# Review\n\nFollow the review contract.'
    )
    appendRuntimeExecutionManifest({
      service,
      tapeIncarnationId,
      responseText,
      toolResult: fact,
      executionRef,
      requestSeq: 2
    })
    appendRuntimeExecutionManifest({
      service,
      tapeIncarnationId,
      responseText,
      toolResult: fact,
      executionRef,
      requestSeq: 3
    })
    expect(service.recoverRuntimeSkillViewContexts(recoveryInput)).toEqual([
      {
        identity: {
          agentId: 'deepchat',
          sourceType: 'builtin',
          sourceId: 'builtin-skills',
          skillName: 'review'
        },
        toolCallId: 'tool-call-1',
        entryId: fact.entryId,
        tapeIncarnationId,
        contentHash: fact.contentHash,
        executionRef
      }
    ])
    const executableManifestRow = entries.findLast(
      (entry) => entry.kind === 'event' && entry.name === 'view/assembled'
    )!
    const storedManifestPayload = executableManifestRow.payload_json
    executableManifestRow.payload_json = '{}'
    expect(() => service.recoverRuntimeSkillViewContexts(recoveryInput)).toThrow(
      /execution View occurrence is corrupt/
    )
    executableManifestRow.payload_json = storedManifestPayload
    expect(() =>
      service.recoverRuntimeSkillViewContexts({
        sessionId: 's1',
        messageId: 'a1',
        messageOrderSeq: 2,
        expectedTapeIncarnationId: tapeIncarnationId,
        projections: [
          {
            toolCallId: 'tool-call-1',
            responseText: `${responseText} `,
            blockIndex: 0,
            timestamp: 100
          }
        ]
      })
    ).toThrow('drifted')
    for (const physicalIdentity of [
      { blockIndex: 1, timestamp: 100 },
      { blockIndex: 0, timestamp: 101 }
    ]) {
      expect(() =>
        service.recoverRuntimeSkillViewContexts({
          sessionId: 's1',
          messageId: 'a1',
          messageOrderSeq: 2,
          expectedTapeIncarnationId: tapeIncarnationId,
          projections: [{ toolCallId: 'tool-call-1', responseText, ...physicalIdentity }]
        })
      ).toThrow('physical envelope')
    }

    const resultRow = entries.find((entry) => entry.entry_id === fact.entryId)!
    const storedResultMetadata = resultRow.meta_json
    const driftedResultMetadata = JSON.parse(storedResultMetadata)
    driftedResultMetadata.skillContextEvidence.operation.requestSeq = 2
    resultRow.meta_json = JSON.stringify(driftedResultMetadata)
    expect(() =>
      service.recoverRuntimeSkillViewContexts({
        sessionId: 's1',
        messageId: 'a1',
        messageOrderSeq: 2,
        expectedTapeIncarnationId: tapeIncarnationId,
        projections: [{ toolCallId: 'tool-call-1', responseText, blockIndex: 0, timestamp: 100 }]
      })
    ).toThrow('Journal dispatch is missing')
    resultRow.meta_json = storedResultMetadata

    const outcomeEntryId = JSON.parse(storedResultMetadata).skillContextEvidence.outcomeEntryId
    const outcomeRow = entries.find((entry) => entry.entry_id === outcomeEntryId)!
    const storedOutcomePayload = outcomeRow.payload_json
    const driftedOutcomePayload = JSON.parse(storedOutcomePayload)
    driftedOutcomePayload.data.responseHash = '0'.repeat(64)
    outcomeRow.payload_json = JSON.stringify(driftedOutcomePayload)
    expect(() =>
      service.recoverRuntimeSkillViewContexts({
        sessionId: 's1',
        messageId: 'a1',
        messageOrderSeq: 2,
        expectedTapeIncarnationId: tapeIncarnationId,
        projections: [{ toolCallId: 'tool-call-1', responseText, blockIndex: 0, timestamp: 100 }]
      })
    ).toThrow('Journal chain does not match its exact result')
    outcomeRow.payload_json = storedOutcomePayload

    const conflictingExecutionRef = materializeRuntimeExecutionPackage(
      service,
      tapeIncarnationId,
      '# Review\n\nFollow the review contract.',
      'skill-effective-content-v3'
    )
    appendRuntimeExecutionManifest({
      service,
      tapeIncarnationId,
      responseText,
      toolResult: fact,
      executionRef: conflictingExecutionRef,
      requestSeq: 4
    })
    expect(() => service.recoverRuntimeSkillViewContexts(recoveryInput)).toThrow(
      /no unique execution package authority/
    )
  })

  it('strictly binds materialized Skill evidence to one execution occurrence', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    table.ensureBootstrapAnchor('s1')
    const tapeIncarnationId = table.getBootstrapIncarnation('s1')!
    const sourceRow = table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'u1', seq: 1 },
      payload: { record: createRecord({ id: 'u1', orderSeq: 1 }) }
    })
    const effectiveContent = '# Review\n\nFollow the review contract.'
    const contentHash = hashSkillEffectiveContent(effectiveContent)
    const receipt = service.materializeSkillContexts([
      {
        sessionId: 's1',
        expectedTapeIncarnationId: tapeIncarnationId,
        agentId: 'deepchat',
        sourceType: 'builtin',
        sourceId: 'builtin-skills',
        skillName: 'review',
        effectiveContent,
        builderVersion: 'skill-effective-v1',
        renderedManifestHash: hashSkillEffectiveContent('manifest'),
        scriptInventoryHash: hashSkillEffectiveContent('scripts'),
        executionPackage: {
          files: [],
          executables: [],
          runtimePolicy: { python: 'auto', node: 'auto' },
          environmentBindingId: null
        }
      }
    ])[0]
    table.getBySession.mockClear()
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    expect(sourceMaps.latestEntryId).toBe(receipt.entryId)
    expect(table.getBySession).not.toHaveBeenCalled()
    expect(table.getBySessionExcludingContext).not.toHaveBeenCalled()
    expect(table.getEffectiveViewInputRows).toHaveBeenCalledWith('s1')
    const { sessionId: _sessionId, ...authoritativeRef } = buildTapeSkillMaterializationRef(receipt)
    const baseInput: TapeViewManifestBuildInput = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 2,
      taskType: 'chat',
      policy: 'legacy_context_v1',
      policyVersion: 1,
      messages: [{ role: 'user', content: effectiveContent }],
      tools: [],
      latestEntryId: receipt.entryId,
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
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: false,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      runId: 'run-1',
      tapeIncarnationId,
      skillContexts: [
        {
          activationScope: 'message',
          agentId: receipt.payload.agentId,
          sourceType: receipt.payload.sourceType,
          sourceId: receipt.payload.sourceId,
          skillName: receipt.payload.skillName,
          authoritativeRef,
          providerRole: 'user',
          sourceEntryIds: [sourceRow.entry_id],
          projectedContentHash: contentHash,
          projectionVersion: 1,
          deduplicationSource: 'message'
        }
      ],
      assembledAt: 200
    }
    const manifest = createTapeViewManifest(baseInput)
    if (manifest.schemaVersion !== 6 && manifest.schemaVersion !== 7) {
      throw new Error('Expected a Skill-bearing ViewManifest fixture.')
    }
    const first = service.appendViewManifest(manifest)
    const second = service.appendViewManifest(manifest)
    const laterRetry = service.appendViewManifest(
      createTapeViewManifest({ ...baseInput, assembledAt: 999 })
    )

    expect(second.entry_id).toBe(first.entry_id)
    expect(laterRetry.entry_id).toBe(first.entry_id)
    expect(
      service.getViewManifestByExecutionBinding({
        sessionId: 's1',
        runId: 'run-1',
        requestSeq: 2
      })?.entryId
    ).toBe(first.entry_id)
    const authority = {
      sessionId: 's1',
      messageId: 'a1',
      runId: 'run-1',
      requestSeq: 2,
      manifestHash: manifest.hashes.manifestHash,
      tapeIncarnationId,
      promptHash: manifest.hashes.promptHash,
      toolDefinitionsHash: manifest.hashes.toolDefinitionsHash,
      skillContexts: manifest.skillContexts
    }
    expect(() => service.assertSkillRequestAuthority(authority)).not.toThrow()
    expect(() =>
      service.assertSkillRequestAuthority({ ...authority, promptHash: 'f'.repeat(64) })
    ).toThrow(/Skill authority drifted/)
    expect(() =>
      service.assertSkillRequestAuthority({
        ...authority,
        skillContexts: [
          {
            ...manifest.skillContexts[0],
            projectedContentHash: 'f'.repeat(64)
          }
        ]
      })
    ).toThrow(/Skill authority drifted/)
    expect(() =>
      service.appendViewManifest(createTapeViewManifest({ ...baseInput, modelId: 'other-model' }))
    ).toThrow(/Conflicting Skill-bearing ViewManifest binding/)
    expect(entries.filter((entry) => entry.name === 'view/assembled')).toHaveLength(1)

    entries.find((entry) => entry.entry_id === receipt.entryId)!.payload_json = '{}'
    expect(() => service.assertSkillRequestAuthority(authority)).toThrow(
      /materialization|authority|corrupt/i
    )
  })

  it('validates runtime Skill-view tool-result evidence and physical manifest identity', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    table.ensureBootstrapAnchor('s1')
    const tapeIncarnationId = table.getBootstrapIncarnation('s1')!
    const response = JSON.stringify({
      success: true,
      name: 'runtime-skill',
      content: '# Runtime Skill\n\nUse this only in the current loop.',
      activatedForMessage: true,
      activationScope: 'message',
      activationEvidenceVersion: 1
    })
    const toolResultReceipt = service.appendSkillViewResultFact({
      sessionId: 's1',
      expectedTapeIncarnationId: tapeIncarnationId,
      messageId: 'a1',
      orderSeq: 2,
      blockIndex: 0,
      toolCallId: 'tool-call-1',
      toolName: 'skill_view',
      responseText: response,
      timestamp: 250,
      ...commitRuntimeSkillOutcome(service, response, 'runtime-skill'),
      identity: {
        agentId: 'deepchat',
        sourceType: 'builtin',
        sourceId: 'builtin-skills',
        skillName: 'runtime-skill'
      }
    })
    const toolResult = entries.find((entry) => entry.entry_id === toolResultReceipt.entryId)!
    const contentHash = toolResultReceipt.contentHash
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 3,
      taskType: 'tool_loop',
      policy: 'tool_loop_shadow',
      policyVersion: null,
      messages: [{ role: 'tool', content: response, tool_call_id: 'tool-call-1' }],
      tools: [],
      latestEntryId: toolResult.entry_id,
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
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: false,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      runId: 'run-2',
      tapeIncarnationId,
      skillContexts: [
        {
          activationScope: 'runtime_view',
          agentId: 'deepchat',
          sourceType: 'builtin',
          sourceId: 'builtin-skills',
          skillName: 'runtime-skill',
          authoritativeRef: { kind: 'tool_result', entryId: toolResult.entry_id, contentHash },
          providerRole: 'tool',
          sourceEntryIds: [],
          projectedContentHash: contentHash,
          projectionVersion: 1,
          deduplicationSource: 'runtime_view'
        }
      ],
      assembledAt: 300
    })
    const manifestRow = service.appendViewManifest(manifest)
    const readExecutionBinding = () =>
      service.getViewManifestByExecutionBinding({ sessionId: 's1', runId: 'run-2', requestSeq: 3 })
    manifestRow.source_type = 'message'

    expect(readExecutionBinding).toThrow(/physical envelope is corrupt/)
    manifestRow.source_type = 'runtime_event'

    const provenanceKey = manifestRow.provenance_key
    manifestRow.provenance_key = 'wrong-binding'
    expect(readExecutionBinding()).toBeNull()
    manifestRow.provenance_key = provenanceKey

    const metadata = manifestRow.meta_json
    manifestRow.meta_json = '{}'
    expect(readExecutionBinding).toThrow(/physical envelope is corrupt/)
    manifestRow.meta_json = metadata

    manifestRow.created_at += 1
    expect(readExecutionBinding).toThrow(/physical envelope is corrupt/)
    manifestRow.created_at -= 1

    const toolResultMetadata = toolResult.meta_json
    const parsedToolResultMetadata = JSON.parse(toolResultMetadata)
    parsedToolResultMetadata.skillContextEvidence.identity.skillName = 'other-skill'
    toolResult.meta_json = JSON.stringify(parsedToolResultMetadata)
    expect(() => service.appendViewManifest(manifest)).toThrow(/activation identity/)
    toolResult.meta_json = toolResultMetadata

    const driftedOperationMetadata = JSON.parse(toolResultMetadata)
    driftedOperationMetadata.skillContextEvidence.operation.requestSeq += 1
    toolResult.meta_json = JSON.stringify(driftedOperationMetadata)
    expect(() => service.appendViewManifest(manifest)).toThrow(
      /activation identity|Journal|tool-result authority/
    )
    toolResult.meta_json = toolResultMetadata

    const bootstrap = entries.find((entry) => entry.name === 'session/start')!
    bootstrap.meta_json = JSON.stringify({ tapeIncarnationId: 'replacement-incarnation' })
    expect(readExecutionBinding()).toBeNull()
    bootstrap.meta_json = JSON.stringify({ tapeIncarnationId })

    entries.find((entry) => entry.entry_id === toolResult.entry_id)!.payload_json = JSON.stringify({
      messageId: 'a1',
      toolCallId: 'tool-call-1',
      response: JSON.stringify({
        ...JSON.parse(response),
        content: 'tampered'
      })
    })
    expect(() => service.appendViewManifest(manifest)).toThrow(
      /activation identity|Journal chain does not match its exact result/
    )
  })

  it('binds runtime Skill bodies and execution packages into one schema-v7 occurrence', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    table.ensureBootstrapAnchor('s1')
    const tapeIncarnationId = table.getBootstrapIncarnation('s1')!
    const effectiveContent = '# Runtime Skill\n\nUse the frozen execution package.'
    const response = JSON.stringify({
      success: true,
      name: 'runtime-skill',
      content: effectiveContent,
      activatedForMessage: true,
      activationScope: 'message',
      activationEvidenceVersion: 1
    })
    const toolResultReceipt = service.appendSkillViewResultFact({
      sessionId: 's1',
      expectedTapeIncarnationId: tapeIncarnationId,
      messageId: 'a1',
      orderSeq: 2,
      blockIndex: 0,
      toolCallId: 'tool-call-1',
      toolName: 'skill_view',
      responseText: response,
      timestamp: 250,
      ...commitRuntimeSkillOutcome(service, response, 'runtime-skill'),
      identity: {
        agentId: 'deepchat',
        sourceType: 'builtin',
        sourceId: 'builtin-skills',
        skillName: 'runtime-skill'
      }
    })
    const materializationReceipt = service.materializeSkillContexts([
      {
        sessionId: 's1',
        expectedTapeIncarnationId: tapeIncarnationId,
        agentId: 'deepchat',
        sourceType: 'builtin',
        sourceId: 'builtin-skills',
        skillName: 'runtime-skill',
        effectiveContent,
        builderVersion: 'skill-effective-content-v2',
        renderedManifestHash: hashSkillEffectiveContent('manifest'),
        scriptInventoryHash: hashSkillEffectiveContent('scripts'),
        executionPackage: {
          files: [],
          executables: [],
          runtimePolicy: { python: 'auto', node: 'auto' },
          environmentBindingId: null
        }
      }
    ])[0]
    const { sessionId: _sessionId, ...executionRef } =
      buildTapeSkillMaterializationRef(materializationReceipt)
    const runtimeContext = {
      activationScope: 'runtime_view' as const,
      agentId: 'deepchat',
      sourceType: 'builtin' as const,
      sourceId: 'builtin-skills',
      skillName: 'runtime-skill',
      authoritativeRef: {
        kind: 'tool_result' as const,
        entryId: toolResultReceipt.entryId,
        contentHash: toolResultReceipt.contentHash
      },
      executionRef,
      providerRole: 'tool' as const,
      sourceEntryIds: [],
      projectedContentHash: toolResultReceipt.contentHash,
      projectionVersion: 1,
      deduplicationSource: 'runtime_view' as const
    }
    const input: TapeViewManifestBuildInput = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 3,
      taskType: 'tool_loop',
      policy: 'tool_loop_shadow',
      policyVersion: null,
      messages: [{ role: 'tool', content: response, tool_call_id: 'tool-call-1' }],
      tools: [],
      latestEntryId: materializationReceipt.entryId,
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
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: false,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      runId: 'run-2',
      tapeIncarnationId,
      skillContexts: [runtimeContext],
      assembledAt: 300
    }
    const manifest = createTapeViewManifest(input)
    expect(manifest).toMatchObject({ schemaVersion: 7, hashVersion: 5 })

    const materializedOnlyManifest = structuredClone(manifest) as any
    materializedOnlyManifest.skillContexts = [
      {
        activationScope: 'session',
        agentId: 'deepchat',
        sourceType: 'builtin',
        sourceId: 'builtin-skills',
        skillName: 'runtime-skill',
        authoritativeRef: executionRef,
        providerRole: 'system',
        sourceEntryIds: [],
        projectedContentHash: executionRef.effectiveContentHash,
        projectionVersion: 1,
        deduplicationSource: 'session'
      }
    ]
    const hashable = structuredClone(materializedOnlyManifest)
    delete hashable.assembledAt
    delete hashable.viewId
    hashable.hashes = {
      promptHash: materializedOnlyManifest.hashes.promptHash,
      toolDefinitionsHash: materializedOnlyManifest.hashes.toolDefinitionsHash
    }
    const materializedOnlyHash = hashJsonData(hashable)
    materializedOnlyManifest.hashes.manifestHash = materializedOnlyHash
    materializedOnlyManifest.viewId = `view_${materializedOnlyHash.slice(0, 16)}`
    expect(() => service.appendViewManifest(materializedOnlyManifest)).toThrow(
      /require executable runtime-view authority/
    )

    const toolResultIndex = entries.findIndex(
      (entry) => entry.entry_id === toolResultReceipt.entryId
    )
    const [toolResultRow] = entries.splice(toolResultIndex, 1)
    expect(() => service.appendViewManifest(manifest)).toThrow(/authority is missing/)
    entries.splice(toolResultIndex, 0, toolResultRow)

    const materializationIndex = entries.findIndex(
      (entry) => entry.entry_id === materializationReceipt.entryId
    )
    const [materializationRow] = entries.splice(materializationIndex, 1)
    expect(() => service.appendViewManifest(manifest)).toThrow(/execution authority is missing/)
    entries.splice(materializationIndex, 0, materializationRow)

    const manifestRow = service.appendViewManifest(manifest)
    expect(
      service.getViewManifestByExecutionBinding({
        sessionId: 's1',
        runId: 'run-2',
        requestSeq: 3
      })?.entryId
    ).toBe(manifestRow.entry_id)
    expect(
      service.getLatestViewManifestByRunBinding({
        sessionId: 's1',
        messageId: 'a1',
        runId: 'run-2'
      })?.entryId
    ).toBe(manifestRow.entry_id)
    const legacyManifest = createTapeViewManifest({
      ...input,
      skillContexts: [
        {
          ...runtimeContext,
          executionRef: undefined
        }
      ].map(({ executionRef: _executionRef, ...context }) => context)
    })
    expect(legacyManifest.schemaVersion).toBe(6)
    expect(() => service.appendViewManifest(legacyManifest)).toThrow(
      /Conflicting Skill-bearing ViewManifest execution binding/
    )

    const laterManifest = createTapeViewManifest({ ...input, requestSeq: 4, assembledAt: 400 })
    const laterRow = service.appendViewManifest(laterManifest)
    const laterPayload = JSON.parse(laterRow.payload_json)
    delete laterPayload.data.manifest.skillContexts[0].executionRef
    laterRow.payload_json = JSON.stringify(laterPayload)
    expect(() =>
      service.getLatestViewManifestByRunBinding({
        sessionId: 's1',
        messageId: 'a1',
        runId: 'run-2'
      })
    ).toThrow(/latest Skill-bearing ViewManifest Run binding is corrupt/i)

    laterRow.payload_json = JSON.stringify({
      ...laterPayload,
      data: { manifest: laterManifest }
    })
    laterRow.source_seq = null
    expect(() =>
      service.getLatestViewManifestByRunBinding({
        sessionId: 's1',
        messageId: 'a1',
        runId: 'run-2'
      })
    ).toThrow(/Skill-bearing ViewManifest Run occurrence is corrupt/i)

    entries.find((entry) => entry.entry_id === materializationReceipt.entryId)!.payload_json = '{}'
    expect(() =>
      service.getViewManifestByExecutionBinding({ sessionId: 's1', runId: 'run-2', requestSeq: 3 })
    ).toThrow(/materialization payload/)
  })

  it('stores and lists view manifests as idempotent tape events', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const messageStore = createTranscriptProjectionMock([createRecord({ id: 'u1', orderSeq: 1 })])

    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat',
      policy: 'legacy_context_v1',
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.anchorEntryIds,
      included: [
        {
          entryId: sourceMaps.entryIdByMessageId.get('u1') ?? null,
          messageId: 'u1',
          orderSeq: 1,
          role: 'user',
          source: 'tape',
          reason: 'selected_history'
        }
      ],
      excluded: [],
      tokenBudget: {
        contextLength: 1000,
        requestedMaxTokens: 100,
        effectiveMaxTokens: 100,
        reserveTokens: 100,
        toolReserveTokens: 0
      },
      providerId: 'openai',
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 200
    })

    const first = service.appendViewManifest(manifest)
    const second = service.appendViewManifest(manifest)

    expect(second.entry_id).toBe(first.entry_id)
    expect(entries.filter((entry) => entry.name === 'view/assembled')).toHaveLength(1)
    expect(JSON.parse(first.meta_json)).toMatchObject({
      policy: 'legacy_context_v1',
      policyVersion: 1
    })
    expect(service.listViewManifestsByMessage('s1', 'a1')).toMatchObject([
      {
        sessionId: 's1',
        messageId: 'a1',
        requestSeq: 1,
        entryId: first.entry_id,
        manifest: {
          hashes: {
            manifestHash: manifest.hashes.manifestHash
          },
          policy: 'legacy_context_v1',
          policyVersion: 1,
          included: [
            {
              messageId: 'u1',
              entryId: sourceMaps.entryIdByMessageId.get('u1')
            }
          ]
        }
      }
    ])
    expect(service.listViewManifestsByMessageRequest('s1', 'a1', 1)).toMatchObject([
      {
        entryId: first.entry_id,
        integrity: 'valid',
        manifest: { hashes: { manifestHash: manifest.hashes.manifestHash } }
      }
    ])
  })

  it('grounds message source maps to the latest effective Tape fact', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const original = createRecord({ id: 'u1', orderSeq: 1, content: 'original task' })
    service.ensureSessionTapeReady('s1', createTranscriptProjectionMock([original]) as any)

    const initialSources = service.getViewManifestSourceMaps('s1')
    const initialEntryId = initialSources.entryIdByMessageId.get('u1')
    expect(initialEntryId).toBeGreaterThan(0)
    expect(initialSources.messageContentHashByMessageId.get('u1')).toBe(
      hashJsonData(original.content)
    )

    const edited = { ...original, content: 'edited task', updatedAt: original.updatedAt + 1 }
    service.appendMessageReplacement(edited, { reason: 'test_edit', revisionKind: 'record' })
    const editedSources = service.getViewManifestSourceMaps('s1')
    expect(editedSources.entryIdByMessageId.get('u1')).toBeGreaterThan(initialEntryId!)
    expect(editedSources.messageContentHashByMessageId.get('u1')).toBe(hashJsonData(edited.content))

    service.appendMessageRetraction(edited, 'test_delete')
    const retractedSources = service.getViewManifestSourceMaps('s1')
    expect(retractedSources.entryIdByMessageId.has('u1')).toBe(false)
    expect(retractedSources.messageContentHashByMessageId.has('u1')).toBe(false)
  })

  it('fails recovery-specific manifest reads on malformed physical duplicates', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({ deepchatTapeEntriesTable: table } as any)
    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'a1', seq: 1 },
      provenanceKey: 'malformed-manifest',
      data: { manifest: { schemaVersion: 5 } },
      meta: {},
      createdAt: 200
    })

    expect(() => service.listViewManifestsByMessageRequest('s1', 'a1', 1)).toThrow(
      /failed recovery validation/
    )
  })

  it('projects memory view anchors into inspection DTOs', () => {
    const { table, entries } = createTapeTableMock()
    table.listMemoryViewManifestAnchorsByAgent = vi.fn(
      (_agentId: string, options?: { messageId?: string }) =>
        entries.filter(
          (entry) =>
            entry.kind === 'anchor' &&
            entry.name === 'memory/view_assembled' &&
            (!options?.messageId || JSON.parse(entry.meta_json).messageId === options.messageId)
        )
    )
    const service = new SessionTape({ deepchatTapeEntriesTable: table } as any)
    table.appendAnchor({
      sessionId: 's1',
      name: 'memory/view_assembled',
      state: {
        policyVersion: 2,
        tokenBudget: 1000,
        estimatedTokens: 15,
        selected: [
          'm-string',
          { id: 'm-object' },
          'm-string',
          { id: 'm-object' },
          { ignored: true },
          3
        ],
        dropped: ['m-dropped'],
        queryHash: 'query-hash',
        allocation: {
          policyVersion: 1,
          totalTokenBudget: 1000,
          overheadTokens: 40,
          demand: { directive: 50, persona: 100, working: 200, queryRecall: 500 },
          allocated: { directive: 50, persona: 100, working: 200, queryRecall: 500 },
          used: { directive: 49, persona: 90, working: 180, queryRecall: 450 },
          borrowed: { directive: 0, persona: 0, working: 8, queryRecall: 194 },
          unallocatedTokens: 110,
          estimatedTotalTokens: 809,
          unusedTokens: 191,
          constrained: false
        }
      },
      meta: { messageId: 'msg-1' },
      createdAt: 300
    })

    const manifests = service.listMemoryViewManifestsByAgent('agent-1', {
      sessionId: 's1',
      messageId: 'msg-1',
      limit: 1
    })

    expect(table.listMemoryViewManifestAnchorsByAgent).toHaveBeenCalledWith('agent-1', {
      sessionId: 's1',
      messageId: 'msg-1',
      limit: 1
    })
    expect(manifests).toEqual([
      {
        sessionId: 's1',
        messageId: 'msg-1',
        entryId: 1,
        policyVersion: 2,
        tokenBudget: 1000,
        estimatedTokens: 15,
        selectedCount: 6,
        selectedIds: ['m-string', 'm-object'],
        droppedCount: 1,
        queryHash: 'query-hash',
        allocation: {
          policyVersion: 1,
          totalTokenBudget: 1000,
          overheadTokens: 40,
          demand: { directive: 50, persona: 100, working: 200, queryRecall: 500 },
          allocated: { directive: 50, persona: 100, working: 200, queryRecall: 500 },
          used: { directive: 49, persona: 90, working: 180, queryRecall: 450 },
          borrowed: { directive: 0, persona: 0, working: 8, queryRecall: 194 },
          unallocatedTokens: 110,
          estimatedTotalTokens: 809,
          unusedTokens: 191,
          constrained: false
        },
        createdAt: 300
      }
    ])
    expect(manifests[0]).not.toHaveProperty('payload_json')
    expect(manifests[0]).not.toHaveProperty('meta_json')
  })

  it('indexes effective tool facts so tool-loop manifests reference real entries', () => {
    const { table } = createTapeTableMock()
    const assistantRecord = createRecord({
      id: 'a1',
      orderSeq: 2,
      role: 'assistant',
      content: JSON.stringify([
        {
          type: 'tool_call',
          status: 'success',
          timestamp: 120,
          tool_call: { id: 'tc1', name: 'search', params: '{"q":"x"}', response: 'result' }
        }
      ])
    })
    appendToolFactsToTape(table as any, assistantRecord, 'live', 'tool_loop')

    const service = createTapeService(table)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    expect(sourceMaps.toolCallEntryIdByToolId.get('tc1')).toBeGreaterThan(0)
    expect(sourceMaps.toolResultEntryIdByToolId.get('tc1')).toBeGreaterThan(0)

    const refs = buildRequestRefs(
      [
        { role: 'system', content: 'system' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'tc1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }
          ]
        },
        { role: 'tool', content: 'result', tool_call_id: 'tc1' }
      ],
      sourceMaps
    )
    expect(refs).toMatchObject([
      { role: 'system', source: 'synthetic' },
      {
        role: 'assistant',
        source: 'tape',
        reason: 'tool_loop_message',
        entryId: sourceMaps.toolCallEntryIdByToolId.get('tc1')
      },
      {
        role: 'tool',
        source: 'tape',
        reason: 'tool_loop_message',
        entryId: sourceMaps.toolResultEntryIdByToolId.get('tc1')
      }
    ])
  })

  it('scopes tool source maps to the in-flight message so reused tool ids do not collide', () => {
    const { table } = createTapeTableMock()
    const blocks = (response: string) =>
      JSON.stringify([
        {
          type: 'tool_call',
          status: 'success',
          timestamp: 120,
          tool_call: { id: 'tc1', name: 'search', params: '{"q":"x"}', response }
        }
      ])
    appendToolFactsToTape(
      table as any,
      createRecord({ id: 'a1', orderSeq: 2, role: 'assistant', content: blocks('first') }),
      'live',
      'tool_loop'
    )
    appendToolFactsToTape(
      table as any,
      createRecord({ id: 'a2', orderSeq: 4, role: 'assistant', content: blocks('second') }),
      'live',
      'tool_loop'
    )

    const service = createTapeService(table)
    const scopedToA1 = service.getViewManifestSourceMaps('s1', 'a1')
    const scopedToA2 = service.getViewManifestSourceMaps('s1', 'a2')

    expect(scopedToA1.toolCallEntryIdByToolId.get('tc1')).toBeLessThan(
      scopedToA2.toolCallEntryIdByToolId.get('tc1')!
    )
    expect(scopedToA1.toolResultEntryIdByToolId.get('tc1')).not.toBe(
      scopedToA2.toolResultEntryIdByToolId.get('tc1')
    )
  })

  it('filters malformed view manifest rows when listing by message', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: {
        type: 'runtime_event',
        id: 'a1',
        seq: 1
      },
      data: {
        manifest: {
          schemaVersion: 1,
          sessionId: 's1',
          messageId: 'a1',
          requestSeq: 1,
          included: 'not-an-array'
        }
      }
    })

    expect(service.listViewManifestsByMessage('s1', 'a1')).toEqual([])
  })

  it('rejects view manifests that disagree with their persisted source envelope', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'a1', seq: 1 },
      data: { manifest: createObservationManifest({ messageId: 'other', requestSeq: 1 }) }
    })
    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'a1', seq: 2 },
      data: { manifest: createObservationManifest({ messageId: 'a1', requestSeq: 1 }) }
    })

    expect(service.listViewManifestsByMessage('s1', 'a1')).toEqual([])
  })

  it('normalizes legacy manifests without hashVersion to hashVersion 1', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const messageStore = createTranscriptProjectionMock([createRecord({ id: 'u1', orderSeq: 1 })])
    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat',
      policy: 'legacy_context_v1',
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.anchorEntryIds,
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
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 200
    })
    const legacyManifest: Record<string, unknown> = { ...manifest }
    delete legacyManifest.hashVersion

    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'a1', seq: 1 },
      data: { manifest: legacyManifest }
    })

    const [record] = service.listViewManifestsByMessage('s1', 'a1')
    expect(record.manifest.hashVersion).toBe(1)
  })

  it('filters manifests whose hashVersion is not a number', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const messageStore = createTranscriptProjectionMock([createRecord({ id: 'u1', orderSeq: 1 })])
    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat',
      policy: 'legacy_context_v1',
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.anchorEntryIds,
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
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 200
    })

    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'a1', seq: 99 },
      data: { manifest: { ...manifest, hashVersion: '2' } }
    })

    expect(service.listViewManifestsByMessage('s1', 'a1')).toEqual([])
  })

  it('annotates read records with hash integrity without dropping tampered manifests', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const messageStore = createTranscriptProjectionMock([createRecord({ id: 'u1', orderSeq: 1 })])
    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const baseInput = {
      sessionId: 's1',
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.anchorEntryIds,
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
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 200
    }
    const validManifest = createTapeViewManifest({ ...baseInput, messageId: 'a1', requestSeq: 1 })
    service.appendViewManifest(validManifest)

    const tamperedManifest = createTapeViewManifest({
      ...baseInput,
      messageId: 'a2',
      requestSeq: 1
    })
    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'a2', seq: 1 },
      data: { manifest: { ...tamperedManifest, latestEntryId: tamperedManifest.latestEntryId + 1 } }
    })

    const [validRecord] = service.listViewManifestsByMessage('s1', 'a1')
    const [tamperedRecord] = service.listViewManifestsByMessage('s1', 'a2')
    expect(validRecord.integrity).toBe('valid')
    expect(tamperedRecord).toBeDefined()
    expect(tamperedRecord.integrity).toBe('invalid')
  })

  it('binds reconstruction lineage to the latest reconstruction anchor including handoffs', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    table.ensureBootstrapAnchor('s1')
    table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/manual',
      source: { type: 'summary', id: 's1', seq: 1 },
      state: {}
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'handoff/phase_done',
      source: { type: 'handoff', id: 's1', seq: 2 },
      state: {}
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'fork/merge',
      source: { type: 'fork', id: 'child', seq: 3 },
      state: {}
    })

    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const entryIdByName = (name: string) =>
      table.getBySession('s1').find((entry: any) => entry.name === name)?.entry_id

    expect(sourceMaps.anchorEntryIds).toHaveLength(4)
    expect(sourceMaps.reconstructionAnchorEntryId).toBe(entryIdByName('handoff/phase_done'))
    expect(sourceMaps.reconstructionAnchorEntryIds).toEqual([
      sourceMaps.reconstructionAnchorEntryId
    ])
    expect(sourceMaps.reconstructionAnchorEntryIds).not.toContain(
      entryIdByName('compaction/manual')
    )
    expect(sourceMaps.reconstructionAnchorEntryIds).not.toContain(entryIdByName('fork/merge'))
  })

  it('keeps memory anchors off the reconstruction lineage', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    table.ensureBootstrapAnchor('s1')
    table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/manual',
      source: { type: 'summary', id: 's1', seq: 1 },
      state: {}
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'memory/extract',
      source: { type: 'runtime_event', id: 's1', seq: 2 },
      state: { memoryIds: ['m1'], count: 1, reason: 'episodic' }
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'memory/reflect',
      source: { type: 'runtime_event', id: 's1', seq: 3 },
      state: { reflectionIds: ['r1'], sourceMemoryIds: ['m1'], count: 1 }
    })

    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const entryIdByName = (name: string) =>
      table.getBySession('s1').find((entry: any) => entry.name === name)?.entry_id

    // Memory anchors are recorded on the tape for observability...
    expect(sourceMaps.anchorEntryIds).toContain(entryIdByName('memory/extract'))
    expect(sourceMaps.anchorEntryIds).toContain(entryIdByName('memory/reflect'))
    // ...but never own the reconstruction cursor; only the summary anchor does.
    expect(sourceMaps.reconstructionAnchorEntryId).toBe(entryIdByName('compaction/manual'))
    expect(sourceMaps.reconstructionAnchorEntryIds).not.toContain(entryIdByName('memory/extract'))
    expect(sourceMaps.reconstructionAnchorEntryIds).not.toContain(entryIdByName('memory/reflect'))
  })
})
