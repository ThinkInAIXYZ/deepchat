import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  SkillContextMaterializer,
  type PreparedSkillContextBatch
} from '@/agent/deepchat/runtime/skillContextMaterializer'
import {
  buildTapeSkillMaterializationProvenanceKey,
  buildTapeSkillMaterializationPayloadHash,
  createTapeSkillMaterializationPayload,
  type TapeSkillMaterializationReceipt
} from '@/tape/domain/skillMaterialization'

const HASH = 'a'.repeat(64)

function resolution(name: string, content = `body:${name}`, agentId = 'agent-1') {
  return {
    identity: {
      agentId,
      sourceType: 'builtin' as const,
      sourceId: `source:${name}`,
      skillName: name
    },
    effectiveContent: content,
    builderVersion: 'builder-1',
    renderedManifestHash: HASH,
    scriptInventoryHash: HASH,
    executionPackage: {
      files: [],
      executables: [],
      runtimePolicy: { python: 'auto' as const, node: 'auto' as const },
      environmentBindingId: null
    }
  }
}

function fixture() {
  let nextEntryId = 20
  const receipts = new Map<number, TapeSkillMaterializationReceipt>()
  const skills = {
    resolveFreshEffectiveSkillContents: vi.fn(async (agentId: string, names: readonly string[]) =>
      names.map((name) => resolution(name, undefined, agentId))
    )
  }
  const tape = {
    getTapeIncarnationId: vi.fn(() => 'incarnation-1'),
    getEffectiveUserMessageSourceEntryId: vi.fn(
      (_sessionId: string, messageId: string) => (messageId === 'user-1' ? 9 : null)
    ),
    materializeSkillContexts: vi.fn(
      (inputs: PreparedSkillContextBatch['items'][number]['materializationInput'][]) =>
        inputs.map((input) => {
          const payload = createTapeSkillMaterializationPayload(input)
          const receipt: TapeSkillMaterializationReceipt = {
            sessionId: input.sessionId,
            entryId: nextEntryId++,
            tapeIncarnationId: input.expectedTapeIncarnationId,
            provenanceKey: buildTapeSkillMaterializationProvenanceKey(input.sessionId, payload),
            payloadHash: buildTapeSkillMaterializationPayloadHash(payload),
            payload
          }
          receipts.set(receipt.entryId, receipt)
          return receipt
        })
    ),
    readSkillMaterialization: vi.fn((ref: { entryId: number }) => receipts.get(ref.entryId)!),
    getLatestViewManifestByRunBinding: vi.fn(() => null as any)
  }
  return {
    skills,
    tape,
    service: new SkillContextMaterializer({ skills, tape })
  }
}

describe('SkillContextMaterializer', () => {
  it('does zero collaborator work for no-Skill preparation and materialization', async () => {
    const { service, skills, tape } = fixture()
    const prepared = await service.prepareFresh({
      sessionId: 'session-1',
      agentId: 'agent-1',
      messageSkillNames: [],
      sessionSkillNames: []
    })
    expect(service.materialize(prepared, 'user-1')).toEqual([])
    expect(skills.resolveFreshEffectiveSkillContents).not.toHaveBeenCalled()
    expect(tape.getTapeIncarnationId).not.toHaveBeenCalled()
    expect(tape.getEffectiveUserMessageSourceEntryId).not.toHaveBeenCalled()
    expect(tape.materializeSkillContexts).not.toHaveBeenCalled()
  })

  it('deduplicates overlap in favor of Session scope and resolves once', async () => {
    const { service, skills } = fixture()
    const prepared = await service.prepareFresh({
      sessionId: 'session-1',
      agentId: 'agent-1',
      messageSkillNames: ['shared', 'message-only'],
      sessionSkillNames: ['shared', 'session-only']
    })
    expect(skills.resolveFreshEffectiveSkillContents).toHaveBeenCalledOnce()
    expect(skills.resolveFreshEffectiveSkillContents).toHaveBeenCalledWith('agent-1', [
      'shared',
      'session-only',
      'message-only'
    ])
    expect(prepared.items.map(({ scope }) => scope)).toEqual(['session', 'session', 'message'])
  })

  it('fails closed on fresh resolver identity/order mismatch', async () => {
    const { service, skills, tape } = fixture()
    skills.resolveFreshEffectiveSkillContents.mockResolvedValueOnce([resolution('wrong')])
    await expect(
      service.prepareFresh({
        sessionId: 'session-1',
        agentId: 'agent-1',
        messageSkillNames: ['expected'],
        sessionSkillNames: []
      })
    ).rejects.toThrow(/identity, order/)
    expect(tape.materializeSkillContexts).not.toHaveBeenCalled()
  })

  it('strictly materializes the exact runtime Skill body against the Run Tape incarnation', async () => {
    const { service, skills, tape } = fixture()
    const viewedResolution = resolution('one')
    const executionRef = await service.materializeRuntimeView({
      sessionId: 'session-1',
      expectedTapeIncarnationId: 'incarnation-1',
      resolution: viewedResolution,
      abortSignal: new AbortController().signal
    })

    expect(skills.resolveFreshEffectiveSkillContents).not.toHaveBeenCalled()
    expect(tape.materializeSkillContexts).toHaveBeenCalledWith([
      expect.objectContaining({
        sessionId: 'session-1',
        expectedTapeIncarnationId: 'incarnation-1',
        skillName: 'one',
        effectiveContent: 'body:one'
      })
    ])
    expect(tape.readSkillMaterialization).toHaveBeenCalledWith({
      sessionId: 'session-1',
      ...executionRef
    })
    expect(executionRef).toMatchObject({
      kind: 'materialization',
      tapeIncarnationId: 'incarnation-1',
      agentId: 'agent-1',
      skillName: 'one'
    })
    expect(executionRef).not.toHaveProperty('sessionId')
    expect(Object.isFrozen(executionRef)).toBe(true)
  })

  it('does not write a runtime package when the Tape drifted or activation was canceled', async () => {
    const tapeDrift = fixture()
    tapeDrift.tape.getTapeIncarnationId.mockReturnValueOnce('incarnation-2')
    await expect(
      tapeDrift.service.materializeRuntimeView({
        sessionId: 'session-1',
        expectedTapeIncarnationId: 'incarnation-1',
        resolution: resolution('one'),
        abortSignal: new AbortController().signal
      })
    ).rejects.toThrow(/another Session Tape incarnation/)
    expect(tapeDrift.skills.resolveFreshEffectiveSkillContents).not.toHaveBeenCalled()
    expect(tapeDrift.tape.materializeSkillContexts).not.toHaveBeenCalled()

    const canceled = fixture()
    const abortController = new AbortController()
    abortController.abort()
    await expect(
      canceled.service.materializeRuntimeView({
        sessionId: 'session-1',
        expectedTapeIncarnationId: 'incarnation-1',
        resolution: resolution('one'),
        abortSignal: abortController.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(canceled.tape.materializeSkillContexts).not.toHaveBeenCalled()
  })

  it('materializes the viewed execution snapshot without re-reading a changed Skill source', async () => {
    const { service, skills, tape } = fixture()
    const viewed = resolution('one')
    const viewedBytes = Buffer.from('console.log("viewed")')
    viewed.executionPackage.files.push({
      relativePath: 'scripts/run.js',
      base64: viewedBytes.toString('base64'),
      byteCount: viewedBytes.byteLength,
      sha256: createHash('sha256').update(viewedBytes).digest('hex')
    })
    viewed.executionPackage.executables.push({
      relativePath: 'scripts/run.js',
      runtime: 'node',
      enabled: true
    })
    skills.resolveFreshEffectiveSkillContents.mockResolvedValueOnce([
      resolution('one', 'body from a later disk version')
    ])

    await service.materializeRuntimeView({
      sessionId: 'session-1',
      expectedTapeIncarnationId: 'incarnation-1',
      resolution: viewed,
      abortSignal: new AbortController().signal
    })

    expect(skills.resolveFreshEffectiveSkillContents).not.toHaveBeenCalled()
    expect(tape.materializeSkillContexts).toHaveBeenCalledWith([
      expect.objectContaining({
        effectiveContent: 'body:one',
        executionPackage: expect.objectContaining({
          files: [expect.objectContaining({ base64: viewedBytes.toString('base64') })]
        })
      })
    ])
  })

  it('applies the batch guard before any write', async () => {
    const { service, skills, tape } = fixture()
    await expect(
      service.prepareFresh({
        sessionId: 'session-1',
        agentId: 'agent-1',
        messageSkillNames: Array.from({ length: 65 }, (_, index) => `skill-${index}`),
        sessionSkillNames: []
      })
    ).rejects.toThrow(/exceeds 64 bodies/)
    expect(skills.resolveFreshEffectiveSkillContents).not.toHaveBeenCalled()
    expect(tape.materializeSkillContexts).not.toHaveBeenCalled()
  })

  it('clones and deeply freezes prepared execution evidence', async () => {
    const { service, skills } = fixture()
    const fresh = resolution('one')
    const bytes = Buffer.from('console.log(1)')
    fresh.executionPackage.files.push({
      relativePath: 'scripts/run.js',
      base64: bytes.toString('base64'),
      byteCount: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
    fresh.executionPackage.executables.push({
      relativePath: 'scripts/run.js',
      runtime: 'node',
      enabled: true
    })
    skills.resolveFreshEffectiveSkillContents.mockResolvedValueOnce([fresh])

    const prepared = await service.prepareFresh({
      sessionId: 'session-1',
      agentId: 'agent-1',
      messageSkillNames: ['one'],
      sessionSkillNames: []
    })
    fresh.executionPackage.files[0].base64 = Buffer.from('changed').toString('base64')

    expect(prepared.items[0].materializationInput.executionPackage.files[0].base64).toBe(
      bytes.toString('base64')
    )
    expect(Object.isFrozen(prepared.items[0].materializationInput.executionPackage.files)).toBe(
      true
    )
    expect(
      Object.isFrozen(prepared.items[0].materializationInput.executionPackage.files[0])
    ).toBe(true)
  })

  it('requires the triggering message source fact before writing', async () => {
    const { service, tape } = fixture()
    const prepared = await service.prepareFresh({
      sessionId: 'session-1',
      agentId: 'agent-1',
      messageSkillNames: ['one'],
      sessionSkillNames: []
    })
    expect(() => service.materialize(prepared, 'missing')).toThrow(/source fact is missing/)
    expect(tape.materializeSkillContexts).not.toHaveBeenCalled()
  })

  it('rejects a cloned prepared batch before source lookup or persistence', async () => {
    const { service, tape } = fixture()
    const prepared = await service.prepareFresh({
      sessionId: 'session-1',
      agentId: 'agent-1',
      messageSkillNames: ['one'],
      sessionSkillNames: []
    })
    const cloned = { ...prepared }
    expect(() => service.materialize(cloned, 'user-1')).toThrow(/not prepared/)
    expect(tape.getEffectiveUserMessageSourceEntryId).not.toHaveBeenCalled()
    expect(tape.materializeSkillContexts).not.toHaveBeenCalled()
  })

  it('fails closed when strict read-back differs from the prepared payload', async () => {
    const { service, tape } = fixture()
    const prepared = await service.prepareFresh({
      sessionId: 'session-1',
      agentId: 'agent-1',
      messageSkillNames: [],
      sessionSkillNames: ['one']
    })
    tape.readSkillMaterialization.mockImplementationOnce((ref: { entryId: number }) => {
      const receipt = tape.materializeSkillContexts.mock.results[0]?.value?.[0]
      return { ...receipt, entryId: ref.entryId, tapeIncarnationId: 'wrong' }
    })
    expect(() => service.materialize(prepared, 'user-1')).toThrow(/strict round-trip/)
  })

  it('fails closed when a write receipt carries a drifted payload hash', async () => {
    const { service, tape } = fixture()
    const prepared = await service.prepareFresh({
      sessionId: 'session-1',
      agentId: 'agent-1',
      messageSkillNames: [],
      sessionSkillNames: ['one']
    })
    const materialize = tape.materializeSkillContexts.getMockImplementation()!
    tape.materializeSkillContexts.mockImplementationOnce((inputs) =>
      materialize(inputs).map((receipt) => ({ ...receipt, payloadHash: 'b'.repeat(64) }))
    )
    expect(() => service.materialize(prepared, 'user-1')).toThrow(/receipt, reference, or payload/)
    expect(tape.readSkillMaterialization).not.toHaveBeenCalled()
  })

  it('recovers only materialized contexts from the highest request in the exact run', async () => {
    const { service, skills, tape } = fixture()
    const prepared = await service.prepareFresh({
      sessionId: 'session-1',
      agentId: 'agent-1',
      messageSkillNames: [],
      sessionSkillNames: ['one']
    })
    const [projection] = service.materialize(prepared, 'user-1')
    const exact = {
      sessionId: 'session-1',
      messageId: 'assistant-1',
      requestSeq: 4,
      entryId: 40,
      createdAt: 1,
      manifest: {
        schemaVersion: 7,
        runId: 'prior-run',
        requestSeq: 4,
        sessionId: 'session-1',
        messageId: 'assistant-1',
        tapeIncarnationId: 'incarnation-1',
        skillContexts: [
          {
            activationScope: 'runtime_view',
            agentId: 'agent-1',
            sourceType: 'builtin',
            sourceId: 'source:runtime',
            skillName: 'runtime',
            authoritativeRef: {
              kind: 'tool_result',
              entryId: 39,
              contentHash: 'b'.repeat(64)
            },
            executionRef: {
              kind: 'materialization',
              entryId: 38,
              tapeIncarnationId: 'incarnation-1',
              agentId: 'agent-1',
              sourceType: 'builtin',
              sourceId: 'source:runtime',
              skillName: 'runtime',
              effectiveContentHash: 'c'.repeat(64)
            },
            providerRole: 'tool',
            sourceEntryIds: [],
            projectedContentHash: 'b'.repeat(64),
            projectionVersion: 1,
            deduplicationSource: 'runtime_view'
          },
          projection.context
        ]
      }
    }
    tape.getLatestViewManifestByRunBinding.mockReturnValue(exact)
    const resolveCalls = skills.resolveFreshEffectiveSkillContents.mock.calls.length
    tape.readSkillMaterialization.mockClear()
    expect(
      service.recoverResume({
        sessionId: 'session-1',
        previousRunId: 'prior-run',
        assistantMessageId: 'assistant-1'
      }).projections[0].effectiveContent
    ).toBe('body:one')
    expect(tape.getLatestViewManifestByRunBinding).toHaveBeenCalledWith({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      runId: 'prior-run'
    })
    expect(tape.readSkillMaterialization).toHaveBeenCalledOnce()
    expect(skills.resolveFreshEffectiveSkillContents).toHaveBeenCalledTimes(resolveCalls)
  })

  it('fails closed instead of silently rewriting recovered projection semantics', async () => {
    const { service, tape } = fixture()
    const prepared = await service.prepareFresh({
      sessionId: 'session-1',
      agentId: 'agent-1',
      messageSkillNames: [],
      sessionSkillNames: ['one']
    })
    const [projection] = service.materialize(prepared, 'user-1')
    const record = {
      sessionId: 'session-1',
      messageId: 'assistant-1',
      requestSeq: 1,
      entryId: 40,
      createdAt: 1,
      manifest: {
        schemaVersion: 6,
        runId: 'prior-run',
        requestSeq: 1,
        sessionId: 'session-1',
        messageId: 'assistant-1',
        tapeIncarnationId: 'incarnation-1',
        skillContexts: [{ ...projection.context, projectionVersion: 2 }]
      }
    }
    tape.getLatestViewManifestByRunBinding.mockReturnValue(record)
    expect(() =>
      service.recoverResume({
        sessionId: 'session-1',
        previousRunId: 'prior-run',
        assistantMessageId: 'assistant-1'
      })
    ).toThrow(/projection semantics/)
  })

  it('rejects recovered materializations with source cardinality outside their scope', async () => {
    const { service, tape } = fixture()
    const prepared = await service.prepareFresh({
      sessionId: 'session-1',
      agentId: 'agent-1',
      messageSkillNames: [],
      sessionSkillNames: ['one']
    })
    const [projection] = service.materialize(prepared, 'user-1')
    const record = {
      sessionId: 'session-1',
      messageId: 'assistant-1',
      requestSeq: 1,
      entryId: 40,
      createdAt: 1,
      manifest: {
        schemaVersion: 6,
        runId: 'prior-run',
        requestSeq: 1,
        sessionId: 'session-1',
        messageId: 'assistant-1',
        tapeIncarnationId: 'incarnation-1',
        skillContexts: [{ ...projection.context, sourceEntryIds: [9] }]
      }
    }
    tape.getLatestViewManifestByRunBinding.mockReturnValue(record)
    expect(() =>
      service.recoverResume({
        sessionId: 'session-1',
        previousRunId: 'prior-run',
        assistantMessageId: 'assistant-1'
      })
    ).toThrow(/materialized Skill context/)
  })
})
