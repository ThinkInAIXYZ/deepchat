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
  DeepChatTapeEntriesTable,
  DeepChatMemoryIngestionProjectionTable,
  DeepChatMessagesTable,
  DeepChatMessageTracesTable,
  DeepChatSessionsTable,
  DatabaseCtor,
  sqliteAvailable,
  sqliteSkipReason,
  itIfSqlite,
  createTapeTableMock,
  createRecord,
  createTraceRow,
  createMessageRow,
  createObservationManifest,
  createTapeService,
  appendObservationIsolationFacts,
  stripObservationPayloadOptIns,
  createSpies,
  trackMemoryPropertyAccess,
  readObservationMatrix
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
    expect(table.getBySessionExcludingContext).toHaveBeenCalledWith('s1')
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

    table.getBySession.mockClear()
    table.getViewManifestEventsByMessage.mockClear()
    const replay = service.exportReplaySlice('s1', 'a1', {
      requestSeq: 2,
      includeTapePayloads: true
    })
    expect(table.getBySession).not.toHaveBeenCalled()
    expect(table.getViewManifestEventsByMessage).toHaveBeenCalledWith('s1', 'a1')
    expect(replay?.integrity).toBe('valid')
    expect(replay?.refs.skillContextEntryIds).toEqual([sourceRow.entry_id, receipt.entryId])
    const materializationSnapshot = replay?.entries.find(
      (entry) => entry.entryId === receipt.entryId
    )
    expect(materializationSnapshot).toBeDefined()
    expect(materializationSnapshot).not.toHaveProperty('payload')
    expect(JSON.stringify(replay)).not.toContain(effectiveContent)

    entries.find((entry) => entry.entry_id === receipt.entryId)!.payload_json = '{}'
    expect(() => service.assertSkillRequestAuthority(authority)).toThrow(
      /materialization|authority|corrupt/i
    )
    expect(service.exportReplaySlice('s1', 'a1', { requestSeq: 2 })?.integrity).toBe('invalid')
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
    manifestRow.source_type = 'message'

    expect(() =>
      service.getViewManifestByExecutionBinding({
        sessionId: 's1',
        runId: 'run-2',
        requestSeq: 3
      })
    ).toThrow(/physical envelope is corrupt/)
    manifestRow.source_type = 'runtime_event'

    const provenanceKey = manifestRow.provenance_key
    manifestRow.provenance_key = 'wrong-binding'
    expect(service.exportReplaySlice('s1', 'a1', { requestSeq: 3 })?.integrity).toBe('invalid')
    manifestRow.provenance_key = provenanceKey

    const metadata = manifestRow.meta_json
    manifestRow.meta_json = '{}'
    expect(service.exportReplaySlice('s1', 'a1', { requestSeq: 3 })?.integrity).toBe('invalid')
    manifestRow.meta_json = metadata

    manifestRow.created_at += 1
    expect(service.exportReplaySlice('s1', 'a1', { requestSeq: 3 })?.integrity).toBe('invalid')
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
    expect(service.exportReplaySlice('s1', 'a1', { requestSeq: 3 })?.integrity).toBe('invalid')
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
    const replay = service.exportReplaySlice('s1', 'a1', { requestSeq: 3 })
    expect(replay?.integrity).toBe('valid')
    expect(replay?.refs.skillContextEntryIds).toEqual(
      expect.arrayContaining([toolResultReceipt.entryId, materializationReceipt.entryId])
    )

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
    expect(service.exportReplaySlice('s1', 'a1', { requestSeq: 3 })?.integrity).toBe('invalid')
  })

  it('stores and lists view manifests as idempotent tape events', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }

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

  it('exports tool_call and tool_result entries in a tool-loop replay slice', () => {
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
    const messages = [
      { role: 'system' as const, content: 'system' },
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          { id: 'tc1', type: 'function' as const, function: { name: 'search', arguments: '{}' } }
        ]
      },
      { role: 'tool' as const, content: 'result', tool_call_id: 'tc1' }
    ]
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 2,
      taskType: 'tool_loop',
      policy: 'tool_loop_shadow',
      policyVersion: 1,
      messages,
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.anchorEntryIds,
      included: buildRequestRefs(messages, sourceMaps),
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
    service.appendViewManifest(manifest)

    const slice = service.exportReplaySlice('s1', 'a1', { requestSeq: 2 })
    const kinds = slice?.entries.map((entry) => entry.kind) ?? []
    expect(kinds).toContain('tool_call')
    expect(kinds).toContain('tool_result')
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
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }
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
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }
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
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }
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

  it('bounds replay slices to the selected view instead of pre-cursor history', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }

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
      anchorEntryIds: sourceMaps.reconstructionAnchorEntryIds,
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
      summaryCursor: {
        summaryCursorOrderSeq: 100,
        preCursorOrderSeqMin: 1,
        preCursorOrderSeqMax: 99,
        preCursorCount: 99
      },
      tokenBudget: {
        contextLength: 1000,
        requestedMaxTokens: 100,
        effectiveMaxTokens: 100,
        reserveTokens: 100,
        toolReserveTokens: 0
      },
      providerId: 'openai',
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 100,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 200
    })
    service.appendViewManifest(manifest)

    const slice = service.exportReplaySlice('s1', 'a1')

    expect(slice?.refs.excludedEntryIds).toEqual([])
    expect(slice?.refs.anchorEntryIds).toEqual(sourceMaps.reconstructionAnchorEntryIds)
    expect(slice?.refs.anchorEntryIds).toHaveLength(1)
    expect(slice?.manifestRecord.manifest.excludedRanges).toEqual([
      { fromOrderSeq: 1, toOrderSeq: 99, count: 99, reason: 'before_summary_cursor' }
    ])
    expect(slice?.entries).toHaveLength(3)
  })

  it('exports replay slices with metadata-only payloads by default', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [createTraceRow()])
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }

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
      traceDebugEnabled: true,
      assembledAt: 200
    })
    const manifestEntry = service.appendViewManifest(manifest)

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000)
    const slice = service.exportReplaySlice('s1', 'a1')
    const secondSlice = service.exportReplaySlice('s1', 'a1')
    nowSpy.mockRestore()

    expect(slice).toMatchObject({
      schemaVersion: 1,
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      mode: 'trace_bound',
      refs: {
        manifestEntryId: manifestEntry.entry_id,
        includedEntryIds: [sourceMaps.entryIdByMessageId.get('u1')],
        anchorEntryIds: sourceMaps.anchorEntryIds
      },
      hashes: {
        manifestHash: manifest.hashes.manifestHash
      }
    })
    expect(slice?.hashes.sliceHash).toHaveLength(64)
    expect(secondSlice?.hashes.sliceHash).toBe(slice?.hashes.sliceHash)
    expect(secondSlice?.createdAt).toBe(2000)
    expect(slice?.trace?.bodyHash).toHaveLength(64)
    expect(slice?.trace?.bodyJson).toBeUndefined()
    expect(slice?.entries.some((entry) => entry.entryId === manifestEntry.entry_id)).toBe(true)
    expect(
      slice?.entries.every((entry) => entry.payload === undefined && entry.meta === undefined)
    ).toBe(true)
  })

  it('includes synthetic contribution source anchors in replay lineage', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    table.ensureBootstrapAnchor('s1')
    const memoryAnchor = table.appendAnchor({
      sessionId: 's1',
      name: 'memory/view_assembled',
      state: { selected: [{ id: 'memory-1' }] }
    })
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    service.appendViewManifest(
      createTapeViewManifest({
        sessionId: 's1',
        messageId: 'a1',
        requestSeq: 1,
        taskType: 'chat',
        policy: 'cache_aware_context_v1',
        policyVersion: 1,
        contextBuilderVersion: 'cache-aware-v1',
        messages: [{ role: 'user', content: 'memory context' }],
        tools: [],
        latestEntryId: sourceMaps.latestEntryId,
        anchorEntryIds: sourceMaps.reconstructionAnchorEntryIds,
        included: [
          {
            entryId: null,
            messageId: null,
            orderSeq: null,
            role: 'user',
            source: 'synthetic',
            reason: 'memory_context',
            sourceEntryIds: [memoryAnchor.entry_id],
            contentHash: 'c'.repeat(64)
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
        supportsVision: false,
        supportsAudioInput: false,
        traceDebugEnabled: false
      })
    )

    const slice = service.exportReplaySlice('s1', 'a1')

    expect(slice?.refs.anchorEntryIds).toContain(memoryAnchor.entry_id)
    expect(slice?.entries.map((entry) => entry.entryId)).toContain(memoryAnchor.entry_id)
  })

  it('exports explicit replay request sequences with opt-in payloads', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [
      createTraceRow({ id: 'trace-1', request_seq: 1 }),
      createTraceRow({
        id: 'trace-2',
        request_seq: 2,
        body_json: '{"messages":[{"role":"tool","content":"done"}]}'
      })
    ])
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }

    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const baseManifestInput: TapeViewManifestBuildInput = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
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
      traceDebugEnabled: true,
      assembledAt: 200
    }
    const firstManifest = createTapeViewManifest(baseManifestInput)
    const secondManifest = createTapeViewManifest({
      ...baseManifestInput,
      requestSeq: 2,
      taskType: 'tool_loop',
      policy: 'tool_loop_shadow',
      policyVersion: null,
      assembledAt: 250
    })
    service.appendViewManifest(firstManifest)
    service.appendViewManifest(secondManifest)

    const latest = service.exportReplaySlice('s1', 'a1')
    const first = service.exportReplaySlice('s1', 'a1', {
      requestSeq: 1,
      includeTapePayloads: true,
      includeTracePayload: true
    })

    expect(latest?.requestSeq).toBe(2)
    expect(first?.requestSeq).toBe(1)
    expect(first?.trace?.bodyJson).toContain('"hello"')
    expect(first?.entries.some((entry) => entry.payload?.record)).toBe(true)
    expect(first?.entries.some((entry) => entry.meta?.source === 'backfill')).toBe(true)
  })

  it('binds each replay slice to its own request seq, ignoring sentinel gap traces', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [
      createTraceRow({
        id: 'trace-req-1',
        request_seq: 1,
        body_json: '{"messages":[{"role":"user","content":"first-request"}]}'
      }),
      createTraceRow({
        id: 'trace-gap',
        request_seq: 0,
        endpoint: 'deepchat://interleaved-reasoning-gap',
        body_json: '{"providerId":"openai"}'
      }),
      createTraceRow({
        id: 'trace-req-2',
        request_seq: 2,
        body_json: '{"messages":[{"role":"tool","content":"second-request"}]}'
      })
    ])
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }

    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const baseManifestInput = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
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
          role: 'user' as const,
          source: 'tape' as const,
          reason: 'selected_history' as const
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
      traceDebugEnabled: true,
      assembledAt: 200
    }
    service.appendViewManifest(createTapeViewManifest(baseManifestInput))
    service.appendViewManifest(
      createTapeViewManifest({
        ...baseManifestInput,
        requestSeq: 2,
        taskType: 'tool_loop',
        policy: 'tool_loop_shadow',
        policyVersion: null,
        assembledAt: 250
      })
    )

    const first = service.exportReplaySlice('s1', 'a1', {
      requestSeq: 1,
      includeTracePayload: true
    })
    const second = service.exportReplaySlice('s1', 'a1', {
      requestSeq: 2,
      includeTracePayload: true
    })

    expect(first?.trace?.bodyJson).toContain('first-request')
    expect(second?.trace?.bodyJson).toContain('second-request')
  })

  it('returns null when exporting a replay slice without a manifest', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [createTraceRow()])

    expect(service.exportReplaySlice('s1', 'a1')).toBeNull()
  })

  it('rejects non-positive replay request sequences', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [createTraceRow()])

    expect(() => service.exportReplaySlice('s1', 'a1', { requestSeq: 0 })).toThrow(
      'requestSeq must be a positive integer.'
    )
  })

  it('joins an exact manifest and trace into a causal observation slice', () => {
    const { table } = createTapeTableMock()
    const assistant = createRecord({
      id: 'a1',
      orderSeq: 2,
      role: 'assistant',
      content: '[{"type":"content","content":"done","status":"success"}]',
      status: 'sent',
      metadata: '{"totalTokens":10}',
      createdAt: 200,
      updatedAt: 300
    })
    appendMessageRecordToTape(table as any, assistant, 'live')
    const service = createTapeService(
      table,
      [createTraceRow(), createTraceRow({ id: 'other-session', session_id: 's2', request_seq: 9 })],
      [createMessageRow()]
    )
    service.appendViewManifest(createObservationManifest())

    const slice = service.readCausalObservationSlice('s1', 'a1', {
      currentRuntimeStatus: 'idle'
    })

    expect(slice).toMatchObject({
      schemaVersion: 1,
      sessionId: 's1',
      messageId: 'a1',
      request: {
        state: 'manifest_bound',
        requestSeq: 1,
        replay: {
          requestSeq: 1,
          mode: 'trace_bound',
          trace: { id: 'trace-1', requestSeq: 1 }
        }
      },
      output: {
        correlation: 'message_only',
        terminalMessage: {
          status: 'sent',
          orderSeq: 2,
          createdAt: 200,
          updatedAt: 300
        }
      },
      runtime: { scope: 'current_only', status: 'idle', eventHistory: 'not_persisted' }
    })
    expect(slice.output.entries.map((entry) => entry.kind)).toContain('message')
    expect(slice.output.terminalMessage?.contentHash).toHaveLength(64)
    expect(slice.output.terminalMessage?.metadataHash).toHaveLength(64)
  })

  it('prefers an explicit causal request sequence and otherwise selects the latest raw sequence', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    service.appendViewManifest(createObservationManifest({ requestSeq: 1, assembledAt: 100 }))
    service.appendViewManifest(
      createObservationManifest({
        requestSeq: 2,
        taskType: 'tool_loop',
        policy: 'tool_loop_shadow',
        policyVersion: null,
        assembledAt: 200
      })
    )

    expect(service.readCausalObservationSlice('s1', 'a1').request).toMatchObject({
      state: 'manifest_bound',
      requestSeq: 2
    })
    expect(service.readCausalObservationSlice('s1', 'a1', { requestSeq: 1 }).request).toMatchObject(
      { state: 'manifest_bound', requestSeq: 1 }
    )
  })

  it('does not fall back to an older manifest when a later traced request has no manifest', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [
      createTraceRow({ id: 'trace-1', request_seq: 1 }),
      createTraceRow({ id: 'trace-2', request_seq: 2 })
    ])
    service.appendViewManifest(createObservationManifest({ requestSeq: 1 }))

    expect(service.readCausalObservationSlice('s1', 'a1').request).toMatchObject({
      state: 'manifest_missing',
      requestSeq: 2,
      trace: { id: 'trace-2', requestSeq: 2 }
    })
  })

  it('binds replay to the latest physical attempt for a request sequence', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [
      createTraceRow({
        id: 'attempt-1',
        request_seq: 2,
        logical_round: 1,
        physical_attempt: 1,
        created_at: 500
      }),
      createTraceRow({
        id: 'attempt-2',
        request_seq: 2,
        logical_round: 1,
        physical_attempt: 2,
        created_at: 400
      })
    ])
    service.appendViewManifest(createObservationManifest({ requestSeq: 2 }))

    const observation = service.readCausalObservationSlice('s1', 'a1', { requestSeq: 2 })
    const replay = service.exportReplaySlice('s1', 'a1', { requestSeq: 2 })

    expect(observation.request).toMatchObject({
      state: 'manifest_bound',
      replay: {
        trace: {
          id: 'attempt-2',
          logicalRound: 1,
          physicalAttempt: 2
        }
      }
    })
    expect(replay?.trace).toMatchObject({
      id: 'attempt-2',
      logicalRound: 1,
      physicalAttempt: 2
    })
  })

  it('returns a trace-only request without manufacturing a view manifest', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [createTraceRow({ request_seq: 4 })])

    const request = service.readCausalObservationSlice('s1', 'a1').request

    expect(request).toMatchObject({
      state: 'manifest_missing',
      requestSeq: 4,
      trace: { requestSeq: 4 }
    })
    expect(
      request.state === 'manifest_missing' ? request.trace?.bodyJson : undefined
    ).toBeUndefined()
  })

  it('distinguishes malformed manifests from hash-invalid but readable manifests', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'bad', seq: 2 },
      data: { manifest: { schemaVersion: 99, requestSeq: 2 } }
    })
    const tamperedManifest = createObservationManifest({ messageId: 'a1', requestSeq: 1 })
    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'a1', seq: 1 },
      data: { manifest: { ...tamperedManifest, latestEntryId: 1 } }
    })

    expect(service.readCausalObservationSlice('s1', 'bad').request).toEqual({
      state: 'manifest_malformed',
      requestSeq: 2,
      trace: null
    })
    const invalid = service.readCausalObservationSlice('s1', 'a1').request
    expect(invalid.state).toBe('manifest_bound')
    expect(invalid.state === 'manifest_bound' ? invalid.replay.integrity : undefined).toBe(
      'invalid'
    )
  })

  it('ignores request sequence zero interleaved-reasoning sentinels', () => {
    const { table } = createTapeTableMock()
    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'a1', seq: 0 },
      data: { manifest: { schemaVersion: 99, requestSeq: 0 } }
    })
    const service = createTapeService(table, [
      createTraceRow({
        id: 'trace-gap',
        request_seq: 0,
        endpoint: 'deepchat://interleaved-reasoning-gap'
      })
    ])

    expect(service.readCausalObservationSlice('s1', 'a1').request).toEqual({
      state: 'request_unavailable',
      requestSeq: null,
      trace: null
    })
  })

  it('keeps multi-round assistant and tool output correlated at message scope only', () => {
    const { table } = createTapeTableMock()
    const assistant = createRecord({
      id: 'a1',
      orderSeq: 2,
      role: 'assistant',
      content: JSON.stringify([
        {
          type: 'tool_call',
          status: 'success',
          timestamp: 220,
          tool_call: {
            id: 'tc1',
            name: 'search',
            params: '{"q":"x"}',
            response: 'result'
          }
        }
      ]),
      status: 'sent',
      createdAt: 200,
      updatedAt: 300
    })
    appendMessageRecordToTape(table as any, assistant, 'live')
    const service = createTapeService(table, [], [createMessageRow({ content: assistant.content })])
    service.appendViewManifest(createObservationManifest({ requestSeq: 1 }))
    service.appendViewManifest(
      createObservationManifest({
        requestSeq: 2,
        taskType: 'tool_loop',
        policy: 'tool_loop_shadow',
        policyVersion: null
      })
    )

    const firstOutput = service.readCausalObservationSlice('s1', 'a1', { requestSeq: 1 }).output
    const latestOutput = service.readCausalObservationSlice('s1', 'a1').output

    expect(latestOutput.correlation).toBe('message_only')
    expect(latestOutput.entries.map((entry) => entry.kind)).toEqual([
      'message',
      'tool_call',
      'tool_result'
    ])
    expect(latestOutput.entries.map((entry) => entry.entryId)).toEqual(
      firstOutput.entries.map((entry) => entry.entryId)
    )
  })

  it('does not infer a completed event from a paused pending assistant message', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(
      table,
      [],
      [createMessageRow({ status: 'pending', content: '[{"type":"action","status":"pending"}]' })]
    )

    const slice = service.readCausalObservationSlice('s1', 'a1', {
      currentRuntimeStatus: 'generating'
    })

    expect(slice.output.entries).toEqual([])
    expect(slice.output.terminalMessage).toBeNull()
    expect(slice.runtime).toEqual({
      scope: 'current_only',
      status: 'generating',
      eventHistory: 'not_persisted'
    })
    expect(JSON.stringify(slice)).not.toContain('completed')
  })

  it('reads an old message without bootstrapping or backfilling Tape', () => {
    const { table, entries } = createTapeTableMock()
    const messageInsert = vi.fn()
    const traceInsert = vi.fn()
    const projectionApply = vi.fn()
    const projectionReplace = vi.fn()
    const cursorWrite = vi.fn()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatMessageTracesTable: {
        listByMessageId: vi.fn().mockReturnValue([]),
        insert: traceInsert
      },
      deepchatMessagesTable: {
        get: vi.fn().mockReturnValue(createMessageRow()),
        insert: messageInsert
      },
      deepchatMemoryIngestionProjectionTable: {
        applyAppendedEntry: projectionApply,
        replaceSession: projectionReplace
      },
      deepchatSessionsTable: {
        getSummaryState: vi.fn().mockReturnValue(null),
        updateMemoryCursorOrderSeq: cursorWrite
      }
    } as any)

    const slice = service.readCausalObservationSlice('s1', 'a1')

    expect(slice.request).toEqual({
      state: 'request_unavailable',
      requestSeq: null,
      trace: null
    })
    expect(slice.output.terminalMessage?.status).toBe('sent')
    expect(slice.runtime).toEqual({
      scope: 'unavailable',
      status: null,
      eventHistory: 'not_persisted'
    })
    expect(entries).toEqual([])
    expect(table.ensureBootstrapAnchor).not.toHaveBeenCalled()
    expect(table.append).not.toHaveBeenCalled()
    expect(table.appendEvent).not.toHaveBeenCalled()
    expect(messageInsert).not.toHaveBeenCalled()
    expect(traceInsert).not.toHaveBeenCalled()
    expect(projectionApply).not.toHaveBeenCalled()
    expect(projectionReplace).not.toHaveBeenCalled()
    expect(cursorWrite).not.toHaveBeenCalled()
  })

  it('keeps causal observations metadata-only by default and reuses replay payload opt-ins', () => {
    const { table } = createTapeTableMock()
    const assistant = createRecord({
      id: 'a1',
      orderSeq: 2,
      role: 'assistant',
      content: 'tape-secret-output',
      status: 'sent',
      metadata: '{"secret":"tape-metadata"}',
      createdAt: 200,
      updatedAt: 300
    })
    appendMessageRecordToTape(table as any, assistant, 'live')
    const service = createTapeService(
      table,
      [
        createTraceRow({
          headers_json: '{"authorization":"secret-header"}',
          body_json: '{"prompt":"secret-request"}'
        })
      ],
      [
        createMessageRow({
          content: 'projection-only-content-secret',
          metadata: '{"secret":"projection-only-metadata"}',
          blocks_json: '["projection-only-blocks"]',
          error: 'projection-only-error'
        })
      ]
    )
    service.appendViewManifest(createObservationManifest())

    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const metadataOnly = service.readCausalObservationSlice('s1', 'a1')
    const withPayloads = service.readCausalObservationSlice('s1', 'a1', {
      includeTapePayloads: true,
      includeTracePayload: true
    })
    now.mockRestore()

    expect(JSON.stringify(metadataOnly)).not.toContain('tape-secret-output')
    expect(JSON.stringify(metadataOnly)).not.toContain('tape-metadata')
    expect(JSON.stringify(metadataOnly)).not.toContain('secret-header')
    expect(JSON.stringify(metadataOnly)).not.toContain('secret-request')
    expect(JSON.stringify(metadataOnly)).not.toContain('projection-only')
    expect(withPayloads.output.entries.some((entry) => entry.payload?.record)).toBe(true)
    expect(withPayloads.request.state).toBe('manifest_bound')
    expect(
      withPayloads.request.state === 'manifest_bound'
        ? withPayloads.request.replay.trace?.headersJson
        : undefined
    ).toContain('secret-header')
    expect(JSON.stringify(withPayloads)).toContain('tape-secret-output')
    expect(JSON.stringify(withPayloads)).not.toContain('projection-only')
    expect(metadataOnly.output.terminalMessage).not.toHaveProperty('content')
    expect(metadataOnly.output.terminalMessage).not.toHaveProperty('metadata')
    expect(metadataOnly.output.terminalMessage).not.toHaveProperty('blocks')
    expect(metadataOnly.output.terminalMessage).not.toHaveProperty('error')
    expect(stripObservationPayloadOptIns(withPayloads)).toEqual(
      stripObservationPayloadOptIns(metadataOnly)
    )
  })

  it('keeps storage and Memory seams unchanged across every causal observation read mode', () => {
    const { table, entries } = createTapeTableMock()
    const { final } = appendObservationIsolationFacts(table)
    const traceRows = [
      createTraceRow({ id: 'trace-1', request_seq: 1 }),
      createTraceRow({ id: 'trace-2', request_seq: 2 }),
      createTraceRow({ id: 'trace-only', message_id: 'a-trace', request_seq: 7 })
    ]
    const messageRows = [createMessageRow({ order_seq: 3 })]
    const projectionState = {
      meta: { session_id: 's1', projection_version: 1, max_entry_id: entries.length },
      range: [{ session_id: 's1', message_id: 'a1', order_seq: 3, entry_id: entries.length }]
    }
    const memoryCursorOrderSeq = 3
    const memoryProjectionWrites = createSpies([
      'applyAppendedEntry',
      'replaceSession',
      'invalidateSession'
    ])
    const memoryProjectionTable = {
      ...memoryProjectionWrites,
      readCurrentRange: vi.fn(() => structuredClone(projectionState.range)),
      getSessionMeta: vi.fn(() => structuredClone(projectionState.meta))
    }
    const cursorWrites = createSpies(['updateMemoryCursorOrderSeq', 'rewindMemoryCursorOrderSeq'])
    const sessionTable = {
      ...cursorWrites,
      getSummaryState: vi.fn().mockReturnValue(null),
      getMemoryCursorOrderSeq: vi.fn(() => memoryCursorOrderSeq)
    }
    const messageWrites = createSpies([
      'insert',
      'updateContent',
      'updateStatus',
      'updateContentAndStatus'
    ])
    const messageTable = {
      ...messageWrites,
      get: vi.fn((messageId: string) => messageRows.find((row) => row.id === messageId))
    }
    const traceWrites = createSpies(['insert', 'deleteByMessageId', 'deleteBySessionId'])
    const traceTable = {
      ...traceWrites,
      listByMessageId: vi.fn((messageId: string) =>
        traceRows.filter((row) => row.message_id === messageId)
      )
    }
    const { presenter, memoryPropertyAccess } = trackMemoryPropertyAccess({
      deepchatTapeEntriesTable: table,
      deepchatMessageTracesTable: traceTable,
      deepchatMessagesTable: messageTable,
      deepchatSessionsTable: sessionTable,
      deepchatMemoryIngestionProjectionTable: memoryProjectionTable
    })
    const service = new SessionTape(presenter as any)
    service.appendViewManifest(createObservationManifest({ requestSeq: 1, assembledAt: 210 }))
    service.appendViewManifest(
      createObservationManifest({
        requestSeq: 2,
        taskType: 'tool_loop',
        policy: 'tool_loop_shadow',
        policyVersion: null,
        assembledAt: 310
      })
    )

    for (const write of [
      table.ensureBootstrapAnchor,
      table.append,
      table.appendAnchor,
      table.appendEvent,
      table.deleteBySession
    ]) {
      write.mockClear()
    }
    const captureState = () => ({
      tapeRows: structuredClone(entries),
      maxEntryId: table.getMaxEntryId('s1'),
      entryOrder: entries.map((entry) => entry.entry_id),
      maxMessageOrder: Math.max(0, ...service.getMessageRecords('s1').map((row) => row.orderSeq)),
      messageRows: structuredClone(messageRows),
      traceRows: structuredClone(traceRows),
      viewManifestRows: structuredClone(
        entries.filter((entry) => entry.kind === 'event' && entry.name === 'view/assembled')
      ),
      effectiveView: service.getMessageRecords('s1'),
      replay: service.exportReplaySlice('s1', 'a1', { requestSeq: 2 }),
      replayHash: service.exportReplaySlice('s1', 'a1', { requestSeq: 2 })?.hashes.sliceHash,
      projectionMeta: memoryProjectionTable.getSessionMeta(),
      projectionRange: memoryProjectionTable.readCurrentRange(),
      memoryCursorOrderSeq: sessionTable.getMemoryCursorOrderSeq()
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)

    try {
      const before = captureState()
      const { defaultObservation, repeatedObservation, explicitObservation, traceOnlyObservation } =
        readObservationMatrix(service)
      const after = captureState()

      expect(after).toEqual(before)
      expect(repeatedObservation).toEqual(defaultObservation)
      expect(defaultObservation.request).toMatchObject({
        state: 'manifest_bound',
        requestSeq: 2
      })
      expect(explicitObservation.request).toMatchObject({
        state: 'manifest_bound',
        requestSeq: 1
      })
      expect(traceOnlyObservation.request).toMatchObject({
        state: 'manifest_missing',
        requestSeq: 7,
        trace: { id: 'trace-only' }
      })
      expect(defaultObservation.output).toMatchObject({
        correlation: 'message_only',
        entries: [{ kind: 'message' }, { kind: 'tool_call' }, { kind: 'tool_result' }]
      })
      expect(before.effectiveView.map((record) => record.id)).toEqual(['u1', 'a1'])
      expect(JSON.parse(before.effectiveView[0].content).text).toBe('edited')
      expect(before.effectiveView[1]).toMatchObject({ status: 'sent', content: final.content })
    } finally {
      now.mockRestore()
    }

    for (const write of [
      table.ensureBootstrapAnchor,
      table.append,
      table.appendAnchor,
      table.appendEvent,
      table.deleteBySession,
      ...Object.values(messageWrites),
      ...Object.values(traceWrites),
      ...Object.values(memoryProjectionWrites),
      ...Object.values(cursorWrites),
      memoryPropertyAccess
    ]) {
      expect(write).not.toHaveBeenCalled()
    }
  })

  itIfSqlite(
    `preserves real Tape, message, trace, Memory projection and schema state while observing${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const memoryProjectionTable = new DeepChatMemoryIngestionProjectionTable(db)
        const tapeTable = new DeepChatTapeEntriesTable(db, memoryProjectionTable)
        const messageTable = new DeepChatMessagesTable(db)
        const traceTable = new DeepChatMessageTracesTable(db)
        const sessionTable = new DeepChatSessionsTable(db)
        memoryProjectionTable.createTable()
        tapeTable.createTable()
        messageTable.createTable()
        traceTable.createTable()
        sessionTable.createTable()
        sessionTable.create('s1', 'openai', 'gpt-4o', 'full_access')
        sessionTable.updateMemoryCursorOrderSeq('s1', 3)

        appendObservationIsolationFacts(tapeTable)
        messageTable.insert({
          id: 'a1',
          sessionId: 's1',
          orderSeq: 3,
          role: 'assistant',
          content: 'projection-only-content-secret',
          status: 'sent',
          metadata: '{"secret":"projection-only-metadata"}',
          createdAt: 200,
          updatedAt: 300
        })
        for (const trace of [
          { id: 'trace-1', messageId: 'a1', requestSeq: 1 },
          { id: 'trace-2', messageId: 'a1', requestSeq: 2 },
          { id: 'trace-only', messageId: 'a-trace', requestSeq: 7 }
        ]) {
          traceTable.insert({
            ...trace,
            sessionId: 's1',
            providerId: 'openai',
            modelId: 'gpt-4o',
            endpoint: 'https://api.openai.test/v1/chat/completions',
            headersJson: `{"authorization":"${trace.id}-header"}`,
            bodyJson: `{"prompt":"${trace.id}-body"}`,
            truncated: false,
            createdAt: 300 + trace.requestSeq
          })
        }

        const service = new SessionTape({
          deepchatTapeEntriesTable: tapeTable,
          deepchatMessagesTable: messageTable,
          deepchatMessageTracesTable: traceTable,
          deepchatSessionsTable: sessionTable,
          deepchatMemoryIngestionProjectionTable: memoryProjectionTable
        } as any)
        service.appendViewManifest(createObservationManifest({ requestSeq: 1, assembledAt: 210 }))
        service.appendViewManifest(
          createObservationManifest({
            requestSeq: 2,
            taskType: 'tool_loop',
            policy: 'tool_loop_shadow',
            policyVersion: null,
            assembledAt: 310
          })
        )
        const effectiveRecords = service.getMessageRecords('s1')
        const sourceMaps = service.getViewManifestSourceMaps('s1')
        memoryProjectionTable.replaceSession(
          's1',
          effectiveRecords
            .filter(
              (record): record is ChatMessageRecord & { status: 'sent' | 'error' } =>
                record.status === 'sent' || record.status === 'error'
            )
            .map((record) => ({
              sessionId: 's1',
              messageId: record.id,
              orderSeq: record.orderSeq,
              entryId: sourceMaps.entryIdByMessageId.get(record.id)!,
              role: record.role,
              content: record.content,
              status: record.status,
              hadToolUse: record.id === 'a1'
            })),
          tapeTable.getMaxEntryId('s1')
        )

        const captureState = () => {
          const tapeRows = tapeTable.getBySession('s1')
          return {
            tapeRows,
            maxEntryId: tapeTable.getMaxEntryId('s1'),
            entryOrder: tapeRows.map((row) => row.entry_id),
            messageRow: messageTable.get('a1'),
            traceRows: db
              .prepare(
                `SELECT *
                 FROM deepchat_message_traces
                 ORDER BY session_id, message_id, request_seq, id`
              )
              .all(),
            viewManifestRows: tapeRows.filter(
              (row) => row.kind === 'event' && row.name === 'view/assembled'
            ),
            effectiveView: service.getMessageRecords('s1'),
            replay: service.exportReplaySlice('s1', 'a1', { requestSeq: 2 }),
            replayHash: service.exportReplaySlice('s1', 'a1', { requestSeq: 2 })?.hashes.sliceHash,
            projectionMeta: memoryProjectionTable.getSessionMeta('s1'),
            projectionRange: memoryProjectionTable.readCurrentRange('s1', 0, 10),
            memoryCursorOrderSeq: sessionTable.getMemoryCursorOrderSeq('s1'),
            schema: db
              .prepare(
                `SELECT type, name, tbl_name, sql
                 FROM sqlite_master
                 WHERE name NOT LIKE 'sqlite_%'
                 ORDER BY type, name, tbl_name`
              )
              .all()
          }
        }
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)

        try {
          const before = captureState()
          readObservationMatrix(service)
          const after = captureState()

          expect(after).toEqual(before)
        } finally {
          now.mockRestore()
        }
      } finally {
        db.close()
      }
    }
  )
})
