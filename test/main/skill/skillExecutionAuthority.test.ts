import { describe, expect, it, vi } from 'vitest'
import {
  SkillExecutionAuthorityResolver,
  type SkillExecutionRequestAuthority
} from '@/skill/skillExecutionAuthority'
import {
  buildTapeSkillMaterializationPayloadHash,
  buildTapeSkillMaterializationProvenanceKey,
  buildTapeSkillMaterializationRef,
  createTapeSkillMaterializationPayload,
  hashSkillEffectiveContent,
  type TapeSkillMaterializationReceipt
} from '@/tape/domain/skillMaterialization'
import { createTapeViewManifest } from '@/tape/domain/viewManifest'
import type {
  DeepChatTapeSkillContextV7,
  DeepChatTapeViewManifestRecord
} from '@shared/types/tape-view-manifest'

const SESSION_ID = 'session-1'
const RUN_ID = 'run-1'
const INCARNATION_ID = 'incarnation-1'
const BINDING_ID = '12345678-1234-4234-9234-123456789abc'

function fixture(scope: 'session' | 'runtime_view' = 'session') {
  const script = Buffer.from('console.log("from tape")')
  const payload = createTapeSkillMaterializationPayload({
    sessionId: SESSION_ID,
    expectedTapeIncarnationId: INCARNATION_ID,
    agentId: 'agent-1',
    sourceType: 'builtin',
    sourceId: 'source-1',
    skillName: 'review',
    effectiveContent: 'Review instructions',
    builderVersion: 'builder-1',
    renderedManifestHash: hashSkillEffectiveContent('manifest'),
    scriptInventoryHash: hashSkillEffectiveContent('inventory'),
    executionPackage: {
      files: [
        {
          relativePath: 'scripts/run.js',
          base64: script.toString('base64'),
          byteCount: script.byteLength,
          sha256: hashSkillEffectiveContent(script.toString())
        }
      ],
      executables: [{ relativePath: 'scripts/run.js', runtime: 'node', enabled: true }],
      runtimePolicy: { python: 'auto', node: 'builtin' },
      environmentBindingId: BINDING_ID
    }
  })
  const receipt: TapeSkillMaterializationReceipt = {
    sessionId: SESSION_ID,
    entryId: 9,
    tapeIncarnationId: INCARNATION_ID,
    provenanceKey: buildTapeSkillMaterializationProvenanceKey(SESSION_ID, payload),
    payloadHash: buildTapeSkillMaterializationPayloadHash(payload),
    payload
  }
  const { sessionId: _sessionId, ...materializationRef } = buildTapeSkillMaterializationRef(receipt)
  const baseContext = {
    agentId: payload.agentId,
    sourceType: payload.sourceType,
    sourceId: payload.sourceId,
    skillName: payload.skillName,
    sourceEntryIds: [],
    projectedContentHash:
      scope === 'runtime_view'
        ? hashSkillEffectiveContent('complete tool result')
        : payload.effectiveContentHash,
    projectionVersion: 1
  } as const
  const context: DeepChatTapeSkillContextV7 =
    scope === 'runtime_view'
      ? {
          ...baseContext,
          activationScope: 'runtime_view',
          authoritativeRef: {
            kind: 'tool_result',
            entryId: 8,
            contentHash: hashSkillEffectiveContent('complete tool result')
          },
          executionRef: materializationRef,
          providerRole: 'tool',
          deduplicationSource: 'runtime_view'
        }
      : {
          ...baseContext,
          activationScope: 'session',
          authoritativeRef: materializationRef,
          providerRole: 'system',
          deduplicationSource: 'session'
        }
  const manifest = createTapeViewManifest({
    sessionId: SESSION_ID,
    messageId: 'assistant-1',
    requestSeq: 2,
    taskType: 'tool_loop',
    policy: 'tool_loop_shadow',
    policyVersion: null,
    contextBuilderVersion: 'legacy-v1',
    messages: [{ role: 'system', content: 'Review instructions' }],
    tools: [],
    latestEntryId: 9,
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
    providerId: 'provider-1',
    modelId: 'model-1',
    summaryCursorOrderSeq: 1,
    supportsVision: false,
    supportsAudioInput: false,
    traceDebugEnabled: false,
    runId: RUN_ID,
    tapeIncarnationId: INCARNATION_ID,
    skillContexts: [context],
    requireDurableManifest: true
  })
  const record: DeepChatTapeViewManifestRecord = {
    sessionId: SESSION_ID,
    messageId: 'assistant-1',
    requestSeq: 2,
    entryId: 10,
    createdAt: manifest.assembledAt,
    manifest,
    integrity: 'valid'
  }
  let tapeIncarnationId = INCARNATION_ID
  let currentRecord: DeepChatTapeViewManifestRecord | null = record
  const tape = {
    getTapeIncarnationId: vi.fn(() => tapeIncarnationId),
    getViewManifestByExecutionBinding: vi.fn(() => currentRecord),
    readSkillMaterialization: vi.fn(() => receipt)
  }
  const environments = {
    resolveSkillRuntimeEnvironmentBinding: vi.fn().mockResolvedValue({ API_KEY: 'secret' })
  }
  const resolver = new SkillExecutionAuthorityResolver({ tape, environments })
  const request: SkillExecutionRequestAuthority = {
    sessionId: SESSION_ID,
    runId: RUN_ID,
    requestSeq: 2,
    manifestHash: manifest.hashes.manifestHash,
    tapeIncarnationId: INCARNATION_ID,
    skillName: 'review'
  }
  return {
    resolver,
    request,
    tape,
    environments,
    payload,
    record,
    setIncarnation: (value: string) => {
      tapeIncarnationId = value
    },
    setRecord: (value: DeepChatTapeViewManifestRecord | null) => {
      currentRecord = value
    }
  }
}

describe('SkillExecutionAuthorityResolver', () => {
  it.each(['session', 'runtime_view'] as const)(
    'resolves immutable %s execution bytes from the exact provider view',
    async (scope) => {
      const { resolver, request, tape, environments } = fixture(scope)
      const authority = await resolver.resolve(request)

      expect(authority.identity.skillName).toBe('review')
      expect(authority.executionPackage.files[0].relativePath).toBe('scripts/run.js')
      expect(authority.environment).toEqual({ API_KEY: 'secret' })
      expect(Object.isFrozen(authority.executionPackage.files)).toBe(true)
      expect(tape.getViewManifestByExecutionBinding).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        runId: RUN_ID,
        requestSeq: 2
      })
      expect(environments.resolveSkillRuntimeEnvironmentBinding).toHaveBeenCalledWith(
        'agent-1',
        'review',
        BINDING_ID
      )
    }
  )

  it('rejects a hash that is not the exact manifest returned to the provider', async () => {
    const { resolver, request } = fixture()
    await expect(resolver.resolve({ ...request, manifestHash: 'a'.repeat(64) })).rejects.toThrow(
      /ViewManifest authority drifted/
    )
  })

  it('fails closed when the Tape incarnation changes during environment resolution', async () => {
    const { resolver, request, environments, setIncarnation } = fixture()
    environments.resolveSkillRuntimeEnvironmentBinding.mockImplementationOnce(async () => {
      setIncarnation('incarnation-2')
      return { API_KEY: 'secret' }
    })
    await expect(resolver.resolve(request)).rejects.toThrow(/another Session Tape incarnation/)
  })

  it('fails closed when the exact provider occurrence disappears during resolution', async () => {
    const { resolver, request, environments, setRecord } = fixture()
    environments.resolveSkillRuntimeEnvironmentBinding.mockImplementationOnce(async () => {
      setRecord(null)
      return { API_KEY: 'secret' }
    })
    await expect(resolver.resolve(request)).rejects.toThrow(/exact Skill-bearing.*unavailable/i)
  })

  it('does not fall back when the exact execution occurrence is missing', async () => {
    const { resolver, request, setRecord } = fixture()
    setRecord(null)
    await expect(resolver.resolve(request)).rejects.toThrow(/exact Skill-bearing.*unavailable/i)
  })

  it('revalidates environment and package authority immediately before dispatch', async () => {
    const { resolver, request, environments } = fixture()
    const authority = await resolver.resolve(request)
    environments.resolveSkillRuntimeEnvironmentBinding.mockResolvedValueOnce({ API_KEY: 'changed' })
    await expect(resolver.assertCurrent(authority)).rejects.toThrow(/environment changed/)
  })
})
