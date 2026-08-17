import { describe, expect, it } from 'vitest'
import { ModelType } from '@shared/model'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { TOOL_EXECUTION, type MCPToolDefinitionBase } from '@shared/types/core/mcp'
import { hashJsonData } from '@/tape/domain/canonicalJson'
import {
  buildExecutionContract,
  isDeepChatExecutionContract
} from '@/tape/domain/executionContract'
import {
  buildIncludedRefs,
  buildRequestRefs,
  createTapeViewManifest,
  hashJson,
  resolveTapeViewManifestPolicy,
  verifyTapeViewManifestHash
} from '@/session/data/tapeViewManifest'
import { normalizeStoredTapeViewManifest } from '@/tape/domain/replay'

function createRecord(overrides: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: 'm1',
    sessionId: 's1',
    orderSeq: 1,
    role: 'user',
    content: 'secret prompt content',
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    traceCount: 0,
    createdAt: 100,
    updatedAt: 100,
    ...overrides
  }
}

function createV5Fixture(permissionMode: 'default' | 'auto_approve' = 'default') {
  const messages = [{ role: 'user' as const, content: 'hello' }]
  const tools = []
  const executionContract = buildExecutionContract({
    request: {
      sessionId: 's1',
      messageId: 'a1',
      runId: '11111111-1111-4111-8111-111111111111',
      requestSeq: 1
    },
    promptAssembly: { prompt: '', sections: [] },
    providerMessages: messages,
    tools,
    providerId: 'openai',
    modelId: 'gpt-4o',
    modelConfig: {
      maxTokens: 100,
      contextLength: 1000,
      vision: false,
      functionCall: true,
      reasoning: false,
      type: ModelType.Chat,
      conversationId: 's1'
    },
    temperature: 0.2,
    maxTokens: 100,
    workspace: { kind: 'runtime_default' },
    maxSubagentDepth: 0,
    dynamicControlSnapshot: {
      permissionMode,
      requestAdmitted: true,
      cancellationRequested: false
    },
    assemblerVersion: 'deepchat-view-v1'
  })
  return {
    executionContract,
    input: {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages,
      tools,
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
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: false,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      executionContract,
      assembledAt: 123
    }
  }
}

function createSkillContext() {
  return {
    activationScope: 'message' as const,
    agentId: 'deepchat',
    sourceType: 'builtin' as const,
    sourceId: 'builtin-skills',
    skillName: 'review',
    authoritativeRef: {
      kind: 'materialization' as const,
      entryId: 6,
      tapeIncarnationId: 'tape-1',
      agentId: 'deepchat',
      sourceType: 'builtin' as const,
      sourceId: 'builtin-skills',
      skillName: 'review',
      effectiveContentHash: 'a'.repeat(64)
    },
    providerRole: 'user' as const,
    sourceEntryIds: [5],
    projectedContentHash: 'a'.repeat(64),
    projectionVersion: 1,
    deduplicationSource: 'message' as const
  }
}

function createRuntimeSkillContext() {
  return {
    activationScope: 'runtime_view' as const,
    agentId: 'deepchat',
    sourceType: 'builtin' as const,
    sourceId: 'builtin-skills',
    skillName: 'review',
    authoritativeRef: {
      kind: 'tool_result' as const,
      entryId: 7,
      contentHash: 'b'.repeat(64)
    },
    executionRef: {
      kind: 'materialization' as const,
      entryId: 6,
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
  }
}

describe('tapeViewManifest', () => {
  it('hashes JSON with stable object key ordering', () => {
    expect(hashJson({ b: 1, a: { d: 4, c: 3 } })).toBe(hashJson({ a: { c: 3, d: 4 }, b: 1 }))
  })

  it('preserves the legacy hash behavior for prototype-shaped keys', () => {
    expect(hashJson(JSON.parse('{"__proto__":{"legacy":true}}'))).toBe(hashJson({}))
  })

  it('builds refs from context metadata without copying raw message content', () => {
    const refs = buildIncludedRefs(
      {
        includesSystemPrompt: true,
        includedRecords: [
          {
            record: createRecord({ id: 'u1', orderSeq: 3, content: 'do not persist this text' }),
            reason: 'selected_history'
          }
        ],
        excludedRecords: [],
        newUserMessageId: 'u2'
      },
      {
        entryIdByMessageId: new Map([
          ['u1', 11],
          ['u2', 12]
        ])
      }
    )

    expect(refs).toMatchObject([
      { entryId: null, role: 'system', reason: 'system_prompt', source: 'synthetic' },
      { entryId: 11, messageId: 'u1', orderSeq: 3, reason: 'selected_history', source: 'tape' },
      { entryId: 12, messageId: 'u2', reason: 'new_user_input', source: 'tape' }
    ])
    expect(JSON.stringify(refs)).not.toContain('do not persist this text')
  })

  it('orders and grounds an authoritative pinned user before the checkpoint', () => {
    const pinnedMessage = { role: 'user' as const, content: 'original task' }
    const pinnedHash = hashJsonData(pinnedMessage)
    const pinnedRecord = createRecord({ id: 'u1', orderSeq: 1, content: 'raw original task' })
    const refs = buildIncludedRefs(
      {
        includesSystemPrompt: true,
        includedRecords: [
          {
            record: createRecord({ id: 'u3', orderSeq: 3 }),
            reason: 'selected_history'
          },
          {
            record: pinnedRecord,
            reason: 'pinned_first_user',
            contentHash: pinnedHash
          }
        ],
        excludedRecords: [],
        pinnedFirstUser: {
          messageId: pinnedRecord.id,
          orderSeq: pinnedRecord.orderSeq,
          sourceContentHash: hashJsonData(pinnedRecord.content),
          contentHash: pinnedHash
        },
        syntheticContributions: [
          {
            role: 'user',
            reason: 'summary_checkpoint',
            sourceEntryIds: [31],
            contentHash: 'a'.repeat(64)
          }
        ]
      },
      {
        entryIdByMessageId: new Map([
          ['u1', 11],
          ['u3', 13]
        ]),
        messageContentHashByMessageId: new Map([['u1', hashJsonData(pinnedRecord.content)]])
      }
    )

    expect(refs).toEqual([
      {
        entryId: null,
        messageId: null,
        orderSeq: null,
        role: 'system',
        source: 'synthetic',
        reason: 'system_prompt'
      },
      {
        entryId: 11,
        messageId: 'u1',
        orderSeq: 1,
        role: 'user',
        source: 'tape',
        reason: 'pinned_first_user',
        sourceEntryIds: [11],
        contentHash: pinnedHash
      },
      {
        entryId: null,
        messageId: null,
        orderSeq: null,
        role: 'user',
        source: 'synthetic',
        reason: 'summary_checkpoint',
        sourceEntryIds: [31],
        contentHash: 'a'.repeat(64)
      },
      {
        entryId: 13,
        messageId: 'u3',
        orderSeq: 3,
        role: 'user',
        source: 'tape',
        reason: 'selected_history'
      }
    ])
    expect(JSON.stringify(refs)).not.toContain('raw original task')
  })

  it('rejects pinned selections without matching metadata or an authoritative Tape source', () => {
    const pinnedRecord = createRecord({ id: 'u1', orderSeq: 1 })
    const pinnedFirstUser = {
      messageId: pinnedRecord.id,
      orderSeq: pinnedRecord.orderSeq,
      sourceContentHash: hashJsonData(pinnedRecord.content),
      contentHash: hashJsonData({ role: 'user', content: 'original task' })
    }
    const selection = {
      includesSystemPrompt: false,
      includedRecords: [
        {
          record: pinnedRecord,
          reason: 'pinned_first_user' as const,
          contentHash: pinnedFirstUser.contentHash
        }
      ],
      excludedRecords: [],
      pinnedFirstUser
    }

    expect(() => buildIncludedRefs(selection)).toThrow(/no authoritative Tape source/)
    expect(() =>
      buildIncludedRefs(
        {
          ...selection,
          pinnedFirstUser: { ...pinnedFirstUser, messageId: 'different-user' }
        },
        { entryIdByMessageId: new Map([['u1', 11]]) }
      )
    ).toThrow(/selection metadata is inconsistent/)
  })

  it('creates deterministic prompt and manifest hashes without storing prompt bodies', () => {
    const input = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'secret prompt content' }],
      tools: [],
      latestEntryId: 7,
      anchorEntryIds: [1],
      included: [
        {
          entryId: 2,
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
      traceDebugEnabled: false,
      assembledAt: 123
    }

    const first = createTapeViewManifest(input)
    const second = createTapeViewManifest(input)

    expect(first.hashes).toEqual(second.hashes)
    expect(first.policy).toBe('legacy_context_v1')
    expect(first.policyVersion).toBe(1)
    expect(first.hashes.manifestHash).toHaveLength(64)
    expect(first.tokenBudget.estimatedPromptTokens).toBeGreaterThan(0)
    expect(JSON.stringify(first)).not.toContain('secret prompt content')
  })

  it('embeds a matching execution contract in a schema-v5 manifest', () => {
    const { input, executionContract } = createV5Fixture()
    const manifest = createTapeViewManifest(input)

    expect(manifest.schemaVersion).toBe(5)
    expect(manifest.hashVersion).toBe(3)
    expect(manifest.executionContract).toBe(executionContract)
    expect(manifest.hashes.promptHash).toBe(executionContract.provenance.promptHash)
    expect(manifest.hashes.toolDefinitionsHash).toBe(
      executionContract.provenance.providerVisibleToolDefinitionsHash
    )
    expect(verifyTapeViewManifestHash(manifest)).toBe('valid')
    expect(verifyTapeViewManifestHash({ ...manifest, viewId: 'view_tampered' })).toBe('invalid')
    expect(normalizeStoredTapeViewManifest(JSON.parse(JSON.stringify(manifest)), 's1')).toEqual(
      manifest
    )
  })

  it('rejects execution contracts that do not match the View request or provider payload', () => {
    const { input, executionContract } = createV5Fixture()
    const agentTool = {
      source: 'agent' as const,
      execution: TOOL_EXECUTION.read.parallel,
      type: 'function' as const,
      function: {
        name: 'inspect',
        description: 'Inspect a resource',
        parameters: { type: 'object', properties: {} }
      },
      server: { name: 'agent-filesystem', icons: '', description: 'Agent tools' }
    }

    expect(() => createTapeViewManifest({ ...input, messageId: 'other-message' })).toThrow(
      /request identity/
    )
    expect(() => createTapeViewManifest({ ...input, sessionId: 'other-session' })).toThrow(
      /request identity/
    )
    expect(() => createTapeViewManifest({ ...input, requestSeq: 2 })).toThrow(/request identity/)
    expect(() => createTapeViewManifest({ ...input, providerId: 'other-provider' })).toThrow(
      /provider identity/
    )
    expect(() => createTapeViewManifest({ ...input, modelId: 'other-model' })).toThrow(
      /provider identity/
    )
    expect(() =>
      createTapeViewManifest({
        ...input,
        messages: [...input.messages, { role: 'user', content: 'changed' }]
      })
    ).toThrow(/provider-message hash/)
    expect(() => createTapeViewManifest({ ...input, tools: [agentTool] })).toThrow(
      /tool-definition hash/
    )
    expect(() =>
      createTapeViewManifest({
        ...input,
        executionContract: { ...executionContract, contractHash: '0'.repeat(64) }
      })
    ).toThrow(/invalid hash/)
    const mutableContract = JSON.parse(JSON.stringify(executionContract))
    expect(isDeepChatExecutionContract(mutableContract)).toBe(true)
    expect(() => createTapeViewManifest({ ...input, executionContract: mutableContract })).toThrow(
      /immutable/
    )
  })

  it('binds the execution contract into v5 identity but excludes assembledAt', () => {
    const first = createV5Fixture('default')
    const changedControl = createV5Fixture('auto_approve')
    const early = createTapeViewManifest(first.input)
    const late = createTapeViewManifest({ ...first.input, assembledAt: 999 })
    const changedContract = createTapeViewManifest(changedControl.input)

    expect(early.hashes.manifestHash).toBe(late.hashes.manifestHash)
    expect(early.viewId).toBe(late.viewId)
    expect(early.hashes.manifestHash).not.toBe(changedContract.hashes.manifestHash)
    expect(early.viewId).not.toBe(changedContract.viewId)
  })

  it('rejects malformed v5 contracts even when their contract hash is self-consistent', () => {
    const { input, executionContract } = createV5Fixture()
    const malformed = JSON.parse(JSON.stringify(executionContract))
    malformed.provenance.promptSections = [
      {
        kind: 'configured_prompt',
        sourceRef: 'test:prompt',
        inclusion: 'included',
        contentHash: 'a'.repeat(64),
        degradationCodes: []
      }
    ]
    const { contractHash: _, ...draft } = malformed
    malformed.contractHash = hashJsonData(draft)

    expect(isDeepChatExecutionContract(malformed)).toBe(false)
    expect(
      normalizeStoredTapeViewManifest(
        { ...createTapeViewManifest(input), executionContract: malformed },
        's1'
      )
    ).toBeNull()
  })

  it('rejects missing v5 contracts without changing legacy manifest reads', () => {
    const { input } = createV5Fixture()
    const v5 = createTapeViewManifest(input)
    const withoutContract = { ...v5 } as Record<string, unknown>
    delete withoutContract.executionContract

    expect(normalizeStoredTapeViewManifest(withoutContract, 's1')).toBeNull()
    expect(createTapeViewManifest({ ...input, executionContract: undefined }).schemaVersion).toBe(4)
  })

  it('creates hash-v4 Skill manifests with or without a matching execution contract', () => {
    const { input, executionContract } = createV5Fixture()
    const skillInput = {
      ...input,
      runId: executionContract.request.runId,
      tapeIncarnationId: 'tape-1',
      skillContexts: [createSkillContext()]
    }

    const withContract = createTapeViewManifest(skillInput)
    const withoutContract = createTapeViewManifest({ ...skillInput, executionContract: undefined })

    expect(withContract).toMatchObject({ schemaVersion: 6, hashVersion: 4 })
    expect(withContract.executionContract).toBe(executionContract)
    expect(withoutContract).toMatchObject({ schemaVersion: 6, hashVersion: 4 })
    expect(withoutContract).not.toHaveProperty('executionContract')
    expect(verifyTapeViewManifestHash(withContract)).toBe('valid')
    expect(verifyTapeViewManifestHash(withoutContract)).toBe('valid')
    expect(verifyTapeViewManifestHash({ ...createTapeViewManifest(input), hashVersion: 4 })).toBe(
      'invalid'
    )
    expect(normalizeStoredTapeViewManifest(JSON.parse(JSON.stringify(withContract)), 's1')).toEqual(
      withContract
    )
  })

  it('versions executable runtime Skill evidence without changing schema-v6 reads', () => {
    const { input, executionContract } = createV5Fixture()
    const manifest = createTapeViewManifest({
      ...input,
      runId: executionContract.request.runId,
      tapeIncarnationId: 'tape-1',
      skillContexts: [createRuntimeSkillContext()]
    })

    expect(manifest).toMatchObject({ schemaVersion: 7, hashVersion: 5 })
    expect(verifyTapeViewManifestHash(manifest)).toBe('valid')
    expect(normalizeStoredTapeViewManifest(JSON.parse(JSON.stringify(manifest)), 's1')).toEqual(
      manifest
    )

    const missingExecutionRef = structuredClone(manifest) as any
    delete missingExecutionRef.skillContexts[0].executionRef
    expect(normalizeStoredTapeViewManifest(missingExecutionRef, 's1')).toBeNull()

    const materializedOnlySchema7 = {
      ...structuredClone(manifest),
      skillContexts: [createSkillContext()]
    }
    expect(normalizeStoredTapeViewManifest(materializedOnlySchema7, 's1')).toBeNull()

    const schema6 = createTapeViewManifest({
      ...input,
      runId: executionContract.request.runId,
      tapeIncarnationId: 'tape-1',
      skillContexts: [
        {
          ...createRuntimeSkillContext(),
          executionRef: undefined
        }
      ].map(({ executionRef: _executionRef, ...context }) => context)
    })
    expect(schema6).toMatchObject({ schemaVersion: 6, hashVersion: 4 })
    expect(normalizeStoredTapeViewManifest(JSON.parse(JSON.stringify(schema6)), 's1')).toEqual(
      schema6
    )
  })

  it.each([
    ['agent', { agentId: 'other-agent' }],
    ['source type', { sourceType: 'plugin' as const }],
    ['source id', { sourceId: 'other-source' }],
    ['Skill name', { skillName: 'other-skill' }],
    ['Tape incarnation', { tapeIncarnationId: '' }],
    ['content hash', { effectiveContentHash: 'invalid' }]
  ])('rejects runtime execution authority with mismatched %s identity', (_name, drift) => {
    const { input, executionContract } = createV5Fixture()
    const context = createRuntimeSkillContext()

    expect(() =>
      createTapeViewManifest({
        ...input,
        runId: executionContract.request.runId,
        tapeIncarnationId: 'tape-1',
        skillContexts: [
          {
            ...context,
            executionRef: { ...context.executionRef, ...drift }
          }
        ]
      })
    ).toThrow(/materialization reference/)
  })

  it('fails closed on malformed or mismatched Skill-manifest identity', () => {
    const { input, executionContract } = createV5Fixture()
    const skillInput = {
      ...input,
      runId: executionContract.request.runId,
      tapeIncarnationId: 'tape-1',
      skillContexts: [createSkillContext()]
    }
    const manifest = createTapeViewManifest(skillInput)

    expect(() => createTapeViewManifest({ ...skillInput, runId: 'different-run' })).toThrow(
      /request identity/
    )
    expect(() => createTapeViewManifest({ ...input, requireDurableManifest: true })).toThrow(
      /requires Skill contexts/
    )
    expect(
      normalizeStoredTapeViewManifest(
        {
          ...manifest,
          skillContexts: [{ ...manifest.skillContexts[0], sourceType: 'unknown' }]
        },
        's1'
      )
    ).toBeNull()
    expect(verifyTapeViewManifestHash({ ...manifest, runId: 'different-run' })).toBe('invalid')
    expect(() =>
      createTapeViewManifest({
        ...skillInput,
        skillContexts: [
          {
            ...createSkillContext(),
            projectedContentHash: 'b'.repeat(64)
          }
        ]
      })
    ).toThrow(/Skill materialization reference/)
    expect(() =>
      createTapeViewManifest({
        ...skillInput,
        skillContexts: [
          {
            activationScope: 'runtime_view',
            agentId: 'deepchat',
            sourceType: 'builtin',
            sourceId: 'builtin-skills',
            skillName: 'review',
            authoritativeRef: {
              kind: 'tool_result',
              entryId: 6,
              contentHash: 'a'.repeat(64)
            },
            providerRole: 'tool',
            sourceEntryIds: [],
            projectedContentHash: 'b'.repeat(64),
            projectionVersion: 1,
            deduplicationSource: 'runtime_view'
          }
        ]
      })
    ).toThrow(/runtime-view Skill context/)
  })

  it('keeps execution metadata out of provider-view tool hashes', () => {
    const baseTool: MCPToolDefinitionBase = {
      type: 'function',
      source: 'agent',
      function: {
        name: 'inspect',
        description: 'Inspect a resource',
        parameters: { type: 'object', properties: {} }
      },
      server: { name: 'test-server', icons: '', description: 'Test server' }
    }
    const baseInput = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      latestEntryId: 1,
      anchorEntryIds: [],
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
      summaryCursorOrderSeq: 0,
      supportsVision: false,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 123
    }

    const parallel = createTapeViewManifest({
      ...baseInput,
      tools: [{ ...baseTool, execution: TOOL_EXECUTION.read.parallel }]
    })
    const sequential = createTapeViewManifest({
      ...baseInput,
      tools: [{ ...baseTool, execution: TOOL_EXECUTION.read.sequential }]
    })

    expect(parallel.hashes.toolDefinitionsHash).toBe(hashJson([baseTool]))
    expect(sequential.hashes.toolDefinitionsHash).toBe(parallel.hashes.toolDefinitionsHash)
    expect(sequential.hashes.manifestHash).toBe(parallel.hashes.manifestHash)
  })

  it('excludes wall-clock assembledAt from the manifest hash and viewId', () => {
    const baseInput = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'secret prompt content' }],
      tools: [],
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
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false
    }

    const early = createTapeViewManifest({ ...baseInput, assembledAt: 100 })
    const late = createTapeViewManifest({ ...baseInput, assembledAt: 999999 })

    expect(early.assembledAt).toBe(100)
    expect(late.assembledAt).toBe(999999)
    expect(early.hashes.manifestHash).toBe(late.hashes.manifestHash)
    expect(early.viewId).toBe(late.viewId)
    expect(early.schemaVersion).toBe(4)
    expect(early.hashVersion).toBe(2)
    expect(early.viewId).toBe(`view_${early.hashes.manifestHash.slice(0, 16)}`)
  })

  it('verifies the manifest hash by hashVersion', () => {
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat',
      policy: 'legacy_context_v1',
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
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
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false
    })

    expect(verifyTapeViewManifestHash(manifest)).toBe('valid')
    expect(verifyTapeViewManifestHash({ ...manifest, latestEntryId: 999 })).toBe('invalid')
    expect(verifyTapeViewManifestHash({ ...manifest, hashVersion: 1 })).toBe('unverified')
  })

  it('converts summary cursor metadata into a bounded excluded range', () => {
    const baseInput = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
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
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 3,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 123
    }

    const withCursor = createTapeViewManifest({
      ...baseInput,
      summaryCursor: {
        summaryCursorOrderSeq: 3,
        preCursorOrderSeqMin: 1,
        preCursorOrderSeqMax: 2,
        preCursorCount: 2
      }
    })
    expect(withCursor.excludedRanges).toEqual([
      { fromOrderSeq: 1, toOrderSeq: 2, count: 2, reason: 'before_summary_cursor' }
    ])

    const emptyCursor = createTapeViewManifest({
      ...baseInput,
      summaryCursor: {
        summaryCursorOrderSeq: 1,
        preCursorOrderSeqMin: null,
        preCursorOrderSeqMax: null,
        preCursorCount: 0
      }
    })
    expect(emptyCursor.excludedRanges).toBeUndefined()
  })

  it('binds the reconstruction anchor lineage into the manifest hash', () => {
    const baseInput = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: 7,
      anchorEntryIds: [5],
      reconstructionAnchorEntryId: 5,
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
      assembledAt: 123
    }

    const withAnchor = createTapeViewManifest(baseInput)
    const withoutAnchor = createTapeViewManifest({
      ...baseInput,
      anchorEntryIds: [],
      reconstructionAnchorEntryId: null
    })

    expect(withAnchor.anchorEntryIds).toEqual([5])
    expect(withAnchor.reconstructionAnchorEntryId).toBe(5)
    expect('diagnosticAnchorEntryIds' in withAnchor).toBe(false)
    expect(withAnchor.hashes.manifestHash).not.toBe(withoutAnchor.hashes.manifestHash)
  })

  it('copies manifest refs so caller mutations cannot alter the hashed snapshot', () => {
    const input = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: 7,
      anchorEntryIds: [1],
      included: [
        {
          entryId: 2,
          messageId: 'u1',
          orderSeq: 1,
          role: 'user' as const,
          source: 'tape' as const,
          reason: 'selected_history' as const
        }
      ],
      excluded: [
        {
          entryId: 3,
          messageId: 'u0',
          orderSeq: 0,
          role: 'user' as const,
          source: 'tape' as const,
          reason: 'out_of_budget' as const
        }
      ],
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
      assembledAt: 123
    }

    const manifest = createTapeViewManifest(input)
    input.included[0].entryId = 99
    input.excluded[0].reason = 'empty_after_formatting'

    expect(manifest.included[0].entryId).toBe(2)
    expect(manifest.excluded[0].reason).toBe('out_of_budget')
    expect(manifest.hashes.manifestHash).not.toBe(createTapeViewManifest(input).hashes.manifestHash)
  })

  it('copies synthetic provenance arrays into the hashed manifest snapshot', () => {
    const sourceEntryIds = [41]
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat',
      policy: 'cache_aware_context_v1',
      policyVersion: 1,
      contextBuilderVersion: 'cache-aware-v1',
      messages: [{ role: 'user', content: 'checkpoint' }],
      tools: [],
      latestEntryId: 41,
      anchorEntryIds: [41],
      included: [
        {
          entryId: null,
          messageId: null,
          orderSeq: null,
          role: 'user',
          source: 'synthetic',
          reason: 'reconstruction_checkpoint',
          sourceEntryIds,
          contentHash: 'a'.repeat(64)
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

    sourceEntryIds.push(99)

    expect(manifest.included[0].sourceEntryIds).toEqual([41])
    expect(verifyTapeViewManifestHash(manifest)).toBe('valid')
  })

  it('validates the cache-aware v2 policy and pinned-user manifest reason', () => {
    const pinnedMessage = { role: 'user' as const, content: 'original task' }
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat',
      policy: 'cache_aware_context_v2',
      policyVersion: 1,
      contextBuilderVersion: 'cache-aware-v2',
      messages: [pinnedMessage],
      tools: [],
      latestEntryId: 11,
      anchorEntryIds: [1],
      included: [
        {
          entryId: 11,
          messageId: 'u1',
          orderSeq: 1,
          role: 'user',
          source: 'tape',
          reason: 'pinned_first_user',
          sourceEntryIds: [11],
          contentHash: hashJsonData(pinnedMessage)
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
      summaryCursorOrderSeq: 2,
      supportsVision: false,
      supportsAudioInput: false,
      traceDebugEnabled: false
    })

    expect(verifyTapeViewManifestHash(manifest)).toBe('valid')
    expect(normalizeStoredTapeViewManifest(manifest, 's1')).toEqual(manifest)
    expect(normalizeStoredTapeViewManifest({ ...manifest, schemaVersion: 3 }, 's1')).toBeNull()
    expect(
      normalizeStoredTapeViewManifest(
        { ...manifest, contextBuilderVersion: 'cache-aware-v1' },
        's1'
      )
    ).toBeNull()
    expect(() =>
      createTapeViewManifest({
        ...manifest,
        included: [{ ...manifest.included[0], source: 'synthetic', sourceEntryIds: undefined }]
      })
    ).toThrow(/authoritative Tape fact/)
    expect(() =>
      createTapeViewManifest({
        ...manifest,
        messages: [{ role: 'system', content: 'system prompt' }, pinnedMessage]
      })
    ).toThrow(/first authoritative View ref/)
  })

  it('normalizes prior schemas without widening their synthetic contribution contract', () => {
    const schema4 = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat',
      policy: 'cache_aware_context_v1',
      policyVersion: 1,
      contextBuilderVersion: 'cache-aware-v1',
      messages: [{ role: 'user', content: 'checkpoint' }],
      tools: [],
      latestEntryId: 7,
      anchorEntryIds: [],
      included: [
        {
          entryId: null,
          messageId: null,
          orderSeq: null,
          role: 'user',
          source: 'synthetic',
          reason: 'summary_checkpoint',
          contentHash: 'b'.repeat(64)
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
    const schema3 = { ...schema4, schemaVersion: 3 as const }
    const legacyBase = {
      ...schema4,
      policy: 'legacy_context_v1',
      contextBuilderVersion: 'legacy-v1',
      included: []
    }
    const schema1 = { ...legacyBase, schemaVersion: 1 }
    delete (schema1 as { hashVersion?: number }).hashVersion
    const schema2 = { ...legacyBase, schemaVersion: 2 }

    expect(normalizeStoredTapeViewManifest(schema1, 's1')?.hashVersion).toBe(1)
    expect(normalizeStoredTapeViewManifest(schema2, 's1')?.schemaVersion).toBe(2)
    expect(normalizeStoredTapeViewManifest(schema3, 's1')?.schemaVersion).toBe(3)
    expect(normalizeStoredTapeViewManifest(schema4, 's1')?.schemaVersion).toBe(4)
    expect(
      normalizeStoredTapeViewManifest(
        {
          ...schema4,
          included: [
            {
              ...schema4.included[0],
              reason: 'directive_context'
            }
          ]
        },
        's1'
      )?.included[0].reason
    ).toBe('directive_context')
    expect(
      normalizeStoredTapeViewManifest(
        {
          ...schema3,
          included: [
            {
              ...schema3.included[0],
              reason: 'directive_context'
            }
          ]
        },
        's1'
      )
    ).toBeNull()
    expect(
      normalizeStoredTapeViewManifest({ ...schema2, policy: 'cache_aware_context_v1' }, 's1')
    ).toBeNull()
    expect(
      normalizeStoredTapeViewManifest(
        {
          ...schema3,
          included: [{ ...schema3.included[0], sourceEntryIds: [0] }]
        },
        's1'
      )
    ).toBeNull()
  })

  it('resolves initial Tape policy provenance and request-level shadow policies', () => {
    expect(
      resolveTapeViewManifestPolicy({
        recoveredFromContextPressure: false,
        isInitialViewRequest: true,
        viewPolicy: 'legacy_context_v1',
        viewPolicyVersion: 1
      })
    ).toEqual({
      policy: 'legacy_context_v1',
      policyVersion: 1
    })

    expect(
      resolveTapeViewManifestPolicy({
        recoveredFromContextPressure: false,
        isInitialViewRequest: true,
        viewPolicy: 'legacy_context_v1'
      })
    ).toEqual({
      policy: 'legacy_context_v1',
      policyVersion: null
    })

    expect(
      resolveTapeViewManifestPolicy({
        recoveredFromContextPressure: false,
        isInitialViewRequest: false,
        viewPolicy: 'legacy_context_v1',
        viewPolicyVersion: 1
      })
    ).toEqual({
      policy: 'tool_loop_shadow',
      policyVersion: null
    })

    expect(
      resolveTapeViewManifestPolicy({
        recoveredFromContextPressure: true,
        isInitialViewRequest: true,
        viewPolicy: 'legacy_context_v1',
        viewPolicyVersion: 1
      })
    ).toEqual({
      policy: 'context_pressure_recovery_shadow',
      policyVersion: null
    })
  })

  it('builds synthetic request refs when no tape entries resolve', () => {
    expect(
      buildRequestRefs([
        { role: 'system', content: 'system' },
        { role: 'user', content: 'question' },
        { role: 'tool', content: 'tool output', tool_call_id: 'call_missing' }
      ])
    ).toMatchObject([
      { role: 'system', reason: 'system_prompt', source: 'synthetic' },
      { role: 'user', reason: 'selected_history', source: 'synthetic' },
      { role: 'tool', reason: 'tool_loop_message', source: 'synthetic', entryId: null }
    ])
  })

  it('preserves pinned provenance in tool-loop refs only for the exact visible message', () => {
    const pinnedMessage = { role: 'user' as const, content: 'original task' }
    const pinnedFirstUser = {
      messageId: 'u1',
      orderSeq: 1,
      sourceContentHash: hashJsonData('raw original task'),
      contentHash: hashJsonData(pinnedMessage)
    }
    const sourceMaps = {
      entryIdByMessageId: new Map([['u1', 11]]),
      messageContentHashByMessageId: new Map([['u1', pinnedFirstUser.sourceContentHash]])
    }

    expect(buildRequestRefs([pinnedMessage], sourceMaps, pinnedFirstUser)).toEqual([
      {
        entryId: 11,
        messageId: 'u1',
        orderSeq: 1,
        role: 'user',
        source: 'tape',
        reason: 'pinned_first_user',
        sourceEntryIds: [11],
        contentHash: pinnedFirstUser.contentHash
      }
    ])
    expect(() =>
      buildRequestRefs(
        [{ role: 'user', content: 'changed projection' }],
        sourceMaps,
        pinnedFirstUser
      )
    ).toThrow(/no longer matches the protected View prefix/)
    expect(() =>
      buildRequestRefs(
        [
          { role: 'system', content: 'system' },
          { role: 'user', content: 'changed projection' },
          pinnedMessage
        ],
        sourceMaps,
        pinnedFirstUser
      )
    ).toThrow(/no longer matches the protected View prefix/)
    expect(() => buildRequestRefs([pinnedMessage], {}, pinnedFirstUser)).toThrow(
      /no authoritative Tape source/
    )
    expect(() =>
      buildRequestRefs(
        [pinnedMessage],
        {
          entryIdByMessageId: new Map([['u1', 12]]),
          messageContentHashByMessageId: new Map([['u1', hashJsonData('edited task')]])
        },
        pinnedFirstUser
      )
    ).toThrow(/no longer matches its Tape source/)
  })

  it('grounds tool-loop refs to real tape entries via source maps', () => {
    const refs = buildRequestRefs(
      [
        { role: 'system', content: 'system' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{}' } }
          ]
        },
        { role: 'tool', content: 'result', tool_call_id: 'call_1' }
      ],
      {
        toolCallEntryIdByToolId: new Map([['call_1', 41]]),
        toolResultEntryIdByToolId: new Map([['call_1', 42]])
      }
    )

    expect(refs).toMatchObject([
      { role: 'system', reason: 'system_prompt', source: 'synthetic', entryId: null },
      { role: 'assistant', reason: 'tool_loop_message', source: 'tape', entryId: 41 },
      { role: 'tool', reason: 'tool_loop_message', source: 'tape', entryId: 42 }
    ])
  })

  it('grounds only the last occurrence of a reused tool id, keeping history synthetic', () => {
    const toolCall = (id: string) => ({
      id,
      type: 'function' as const,
      function: { name: 'search', arguments: '{}' }
    })
    const refs = buildRequestRefs(
      [
        { role: 'assistant', content: '', tool_calls: [toolCall('tc1')] },
        { role: 'tool', content: 'old', tool_call_id: 'tc1' },
        { role: 'assistant', content: '', tool_calls: [toolCall('tc1')] },
        { role: 'tool', content: 'new', tool_call_id: 'tc1' }
      ],
      {
        toolCallEntryIdByToolId: new Map([['tc1', 91]]),
        toolResultEntryIdByToolId: new Map([['tc1', 92]])
      }
    )

    expect(refs).toMatchObject([
      { role: 'assistant', source: 'synthetic', entryId: null },
      { role: 'tool', source: 'synthetic', entryId: null },
      { role: 'assistant', source: 'tape', entryId: 91 },
      { role: 'tool', source: 'tape', entryId: 92 }
    ])
  })
})
