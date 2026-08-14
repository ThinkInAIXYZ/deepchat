import { describe, expect, it } from 'vitest'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'
import {
  buildTapeSkillMaterializationPayloadHash,
  buildTapeSkillMaterializationRef,
  createTapeSkillMaterializationPayload,
  hashSkillEffectiveContent,
  validateTapeSkillMaterializationBatch,
  validateTapeSkillMaterializationPayload,
  type TapeSkillMaterializationInput
} from '@/tape/domain/skillMaterialization'
import {
  SKILL_EXECUTION_PACKAGE_MAX_BYTES,
  SKILL_EXECUTION_PACKAGE_MAX_FILES,
  SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES
} from '@shared/types/skill'
import { TapeSkillMaterializationService } from '@/tape/application/skillMaterializationService'
import { TapeFactService } from '@/tape/application/factService'
import { ExecutionJournalService } from '@/tape/application/executionJournalService'
import type { DeepChatTapeAppendInput, DeepChatTapeEntryRow } from '@/tape/domain/entry'
import type { ExecutionOperationIdentity } from '@/tape/domain/executionJournal'

const hash = hashSkillEffectiveContent('fixture')
const emptyExecutionPackage = {
  files: [],
  executables: [],
  runtimePolicy: { python: 'auto' as const, node: 'auto' as const },
  environmentBindingId: null
}

function executionPackage(path = 'scripts/run.js', content = 'console.log(1)') {
  const bytes = Buffer.from(content)
  return {
    files: [
      {
        relativePath: path,
        base64: bytes.toString('base64'),
        byteCount: bytes.byteLength,
        sha256: hashSkillEffectiveContent(content)
      }
    ],
    executables: [{ relativePath: path, runtime: 'node' as const, enabled: true }],
    runtimePolicy: { python: 'auto' as const, node: 'builtin' as const },
    environmentBindingId: '12345678-1234-4234-9234-123456789abc'
  }
}

function executionFiles(count: number, bytesPerFile: number) {
  const content = 'x'.repeat(bytesPerFile)
  const base64 = Buffer.from(content).toString('base64')
  const sha256 = hashSkillEffectiveContent(content)
  return Array.from({ length: count }, (_, index) => ({
    relativePath: `scripts/support/${index.toString().padStart(3, '0')}.bin`,
    base64,
    byteCount: bytesPerFile,
    sha256
  }))
}

function input(content = 'hello 🌍'): TapeSkillMaterializationInput {
  return {
    sessionId: 'session-1',
    expectedTapeIncarnationId: 'incarnation-1',
    agentId: 'agent-1',
    sourceType: 'builtin',
    sourceId: 'source-1',
    skillName: 'skill-1',
    effectiveContent: content,
    builderVersion: 'builder-1',
    renderedManifestHash: hash,
    scriptInventoryHash: hash,
    executionPackage: emptyExecutionPackage
  }
}

function createMaterializationStore() {
  const rows: DeepChatTapeEntryRow[] = []
  let tapeIncarnationId = 'incarnation-1'
  let failNextAppend = false
  const store = {
    ensureBootstrapAnchor: () => undefined,
    getBootstrapIncarnation: () => tapeIncarnationId,
    getByEntryId: (sessionId: string, entryId: number) =>
      rows.find((row) => row.session_id === sessionId && row.entry_id === entryId),
    getByProvenanceKey: (sessionId: string, provenanceKey: string) =>
      rows.find((row) => row.session_id === sessionId && row.provenance_key === provenanceKey),
    appendSkillMaterialization: (append: {
      sessionId: string
      sourceId: string
      provenanceKey: string
      payload: ReturnType<typeof createTapeSkillMaterializationPayload>
      payloadHash: string
    }) => {
      if (failNextAppend) {
        failNextAppend = false
        throw new Error('injected append failure')
      }
      const existing = store.getByProvenanceKey(append.sessionId, append.provenanceKey)
      if (existing) return existing
      const row: DeepChatTapeEntryRow = {
        session_id: append.sessionId,
        entry_id: rows.length + 1,
        kind: 'context',
        name: 'skill/materialized',
        source_type: 'runtime_event',
        source_id: append.sourceId,
        source_seq: 0,
        provenance_key: append.provenanceKey,
        payload_json: JSON.stringify(append.payload),
        meta_json: JSON.stringify({ payloadHash: append.payloadHash }),
        created_at: 100 + rows.length
      }
      rows.push(row)
      return row
    },
    runInTransaction: <T>(operation: () => T): T => {
      const snapshot = structuredClone(rows)
      try {
        return operation()
      } catch (error) {
        rows.splice(0, rows.length, ...snapshot)
        throw error
      }
    },
    isInTransaction: () => false
  }
  return {
    rows,
    store,
    setTapeIncarnationId: (value: string) => {
      tapeIncarnationId = value
    },
    failNextAppend: () => {
      failNextAppend = true
    }
  }
}

function createSkillViewFactStore() {
  const rows: DeepChatTapeEntryRow[] = []
  let tapeIncarnationId = 'incarnation-1'
  const store = {
    ensureBootstrapAnchor: () => undefined,
    getBootstrapIncarnation: () => tapeIncarnationId,
    append: (input: DeepChatTapeAppendInput) => {
      const existing = input.provenanceKey
        ? rows.find(
            (row) =>
              row.session_id === input.sessionId && row.provenance_key === input.provenanceKey
          )
        : undefined
      if (existing && input.idempotent) return existing
      const row: DeepChatTapeEntryRow = {
        session_id: input.sessionId,
        entry_id: rows.length + 1,
        kind: input.kind,
        name: input.name ?? null,
        source_type: input.source?.type ?? null,
        source_id: input.source?.id ?? null,
        source_seq: input.source?.seq ?? null,
        provenance_key: input.provenanceKey ?? null,
        payload_json: JSON.stringify(input.payload),
        meta_json: JSON.stringify(input.meta ?? {}),
        created_at: input.createdAt ?? 100 + rows.length
      }
      rows.push(row)
      return row
    },
    appendEvent: () => {
      throw new Error('unexpected event append')
    },
    appendExecutionJournalEvent: (input: any) =>
      store.append({
        ...input,
        kind: 'event',
        payload: { name: input.name, data: input.data }
      }),
    listNestedOperationEventsForParent: () => [],
    getByEntryIds: (sessionId: string, entryIds: readonly number[]) => {
      const selected = new Set(entryIds)
      return rows.filter((row) => row.session_id === sessionId && selected.has(row.entry_id))
    },
    getByProvenanceKey: (sessionId: string, provenanceKey: string) =>
      rows.find((row) => row.session_id === sessionId && row.provenance_key === provenanceKey),
    runInTransaction: <T>(operation: () => T): T => {
      const snapshot = structuredClone(rows)
      try {
        return operation()
      } catch (error) {
        rows.splice(0, rows.length, ...snapshot)
        throw error
      }
    },
    isInTransaction: () => false
  }
  return {
    rows,
    store,
    setTapeIncarnationId: (value: string) => {
      tapeIncarnationId = value
    }
  }
}

const SKILL_VIEW_OPERATION: ExecutionOperationIdentity = {
  runId: '11111111-1111-4111-8111-111111111111',
  requestSeq: 1,
  providerToolCallId: 'tool-call-1'
}

function commitSkillViewOutcome(
  store: ReturnType<typeof createSkillViewFactStore>['store'],
  responseText: string
): { operation: ExecutionOperationIdentity; outcomeEntryId: number } {
  const journal = new ExecutionJournalService(() => store as never)
  journal.commitRunStarted({
    sessionId: 'session-1',
    runId: SKILL_VIEW_OPERATION.runId,
    messageId: 'assistant-1',
    runKind: 'loop'
  })
  journal.commitDispatch({
    sessionId: 'session-1',
    messageId: 'assistant-1',
    operation: SKILL_VIEW_OPERATION,
    toolName: 'skill_view',
    toolSource: 'agent',
    normalizedArguments: { name: 'review' },
    target: { serverName: 'agent-skills', originalName: 'skill_view' }
  })
  const outcome = journal.commitToolOutcome({
    sessionId: 'session-1',
    messageId: 'assistant-1',
    operation: SKILL_VIEW_OPERATION,
    responseText,
    isError: false
  })
  return { operation: SKILL_VIEW_OPERATION, outcomeEntryId: outcome.entryId }
}

describe('Tape Skill materialization domain', () => {
  it('computes UTF-8 bytes and validates exact canonical fields', () => {
    const payload = createTapeSkillMaterializationPayload(input())
    expect(payload.byteCount).toBe(Buffer.byteLength('hello 🌍', 'utf8'))
    expect(payload.effectiveContentHash).toBe(hashSkillEffectiveContent('hello 🌍'))
    expect(() => validateTapeSkillMaterializationPayload({ ...payload, extra: true })).toThrow(
      'unknown or missing'
    )
    expect(() =>
      validateTapeSkillMaterializationPayload({ ...payload, sourceType: 'unknown' })
    ).toThrow('supported Skill source type')
  })

  it('round-trips a canonical execution package and identities package byte changes', () => {
    const first = createTapeSkillMaterializationPayload({
      ...input(),
      executionPackage: executionPackage()
    })
    const changed = createTapeSkillMaterializationPayload({
      ...input(),
      executionPackage: executionPackage('scripts/run.js', 'console.log(2)')
    })

    expect(validateTapeSkillMaterializationPayload(structuredClone(first))).toEqual(first)
    expect(first.schemaVersion).toBe(3)
    expect(first.executionPackage.byteCount).toBe(Buffer.byteLength('console.log(1)'))
    expect(first.executionPackage.packageHash).toMatch(/^[a-f0-9]{64}$/)
    expect(changed.executionPackage.packageHash).not.toBe(first.executionPackage.packageHash)
    expect(buildTapeSkillMaterializationPayloadHash(changed)).not.toBe(
      buildTapeSkillMaterializationPayloadHash(first)
    )
    expect(() =>
      createTapeSkillMaterializationPayload({
        ...input(),
        executionPackage: {
          ...emptyExecutionPackage,
          env: { SECRET: 'must-not-enter-tape' }
        } as any
      })
    ).toThrow('unknown or missing')
  })

  it.each([
    ['base64', (file: any) => (file.base64 = '***')],
    ['hash', (file: any) => (file.sha256 = hash)],
    ['traversal', (file: any) => (file.relativePath = '../run.js')],
    ['drive path', (file: any) => (file.relativePath = 'C:/run.js')],
    ['hidden path', (file: any) => (file.relativePath = 'scripts/.env')],
    ['device path', (file: any) => (file.relativePath = 'scripts/CON.js')],
    ['alternate stream', (file: any) => (file.relativePath = 'scripts/run.js:secret')],
    ['forbidden character', (file: any) => (file.relativePath = 'scripts/run?.js')],
    ['control character', (file: any) => (file.relativePath = 'scripts/run\u0001.js')],
    ['spaced device path', (file: any) => (file.relativePath = 'scripts/CON .js')]
  ])('rejects invalid execution package %s', (_name, mutate) => {
    const payload = createTapeSkillMaterializationPayload({
      ...input(),
      executionPackage: executionPackage()
    }) as any
    mutate(payload.executionPackage.files[0])
    expect(() => validateTapeSkillMaterializationPayload(payload)).toThrow()
  })

  it('accepts bounded supporting files but keeps executable authority under scripts', () => {
    const packageSource = executionPackage()
    const supportContent = '<schema/>'
    const supportBytes = Buffer.from(supportContent)
    const withSupport = createTapeSkillMaterializationPayload({
      ...input(),
      executionPackage: {
        ...packageSource,
        files: [
          {
            relativePath: 'ooxml/schemas/document.xsd',
            base64: supportBytes.toString('base64'),
            byteCount: supportBytes.byteLength,
            sha256: hashSkillEffectiveContent(supportContent)
          },
          ...packageSource.files
        ]
      }
    })
    expect(withSupport.executionPackage.files[0].relativePath).toBe('ooxml/schemas/document.xsd')
    expect(() =>
      validateTapeSkillMaterializationPayload({ ...structuredClone(withSupport), schemaVersion: 2 })
    ).toThrow('Schema 2 execution package files must be under scripts')

    expect(() =>
      createTapeSkillMaterializationPayload({
        ...input(),
        executionPackage: {
          ...packageSource,
          files: [
            {
              ...packageSource.files[0],
              relativePath: 'ooxml/run.js'
            }
          ],
          executables: [{ relativePath: 'ooxml/run.js', runtime: 'node', enabled: true }]
        }
      })
    ).toThrow('executable must be under scripts')
  })

  it('keeps scripts-only schema 2 materializations readable', () => {
    const current = createTapeSkillMaterializationPayload({
      ...input(),
      executionPackage: executionPackage()
    })
    const legacy = { ...structuredClone(current), schemaVersion: 2 }

    expect(validateTapeSkillMaterializationPayload(legacy)).toEqual(legacy)
  })

  it('rejects package order, duplicate, and case-fold collisions', () => {
    const packageSource = executionPackage()
    packageSource.executables = []
    const second = { ...packageSource.files[0], relativePath: 'A.js' }
    for (const files of [
      [packageSource.files[0], { ...second, relativePath: 'scripts/A.js' }],
      [packageSource.files[0], packageSource.files[0]],
      [
        { ...packageSource.files[0], relativePath: 'scripts/A.js' },
        { ...second, relativePath: 'scripts/a.js' }
      ]
    ]) {
      expect(() =>
        createTapeSkillMaterializationPayload({
          ...input(),
          executionPackage: { ...packageSource, files }
        })
      ).toThrow()
    }
  })

  it('rejects case-fold collisions between parent directories', () => {
    const packageSource = executionPackage()
    packageSource.executables = []
    const files = [
      { ...packageSource.files[0], relativePath: 'scripts/A/one.js' },
      { ...packageSource.files[0], relativePath: 'scripts/a/two.js' }
    ]
    expect(() =>
      createTapeSkillMaterializationPayload({
        ...input(),
        executionPackage: { ...packageSource, files }
      })
    ).toThrow('collide on a supported platform')
  })

  it('bounds package files, decoded bytes, environment binding, and aggregate batch bytes', () => {
    expect(() =>
      createTapeSkillMaterializationPayload({
        ...input(),
        executionPackage: {
          ...emptyExecutionPackage,
          files: [
            {
              relativePath: 'scripts/huge.bin',
              base64: 'A'.repeat(SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES * 4),
              byteCount: 0,
              sha256: hash
            }
          ]
        }
      })
    ).toThrow('invalid base64')
    expect(() =>
      createTapeSkillMaterializationPayload({
        ...input(),
        executionPackage: {
          ...emptyExecutionPackage,
          files: executionFiles(1, SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES + 1)
        }
      })
    ).toThrow('file byte count')
    expect(() =>
      createTapeSkillMaterializationPayload({
        ...input(),
        executionPackage: {
          ...emptyExecutionPackage,
          files: executionFiles(SKILL_EXECUTION_PACKAGE_MAX_FILES + 1, 0)
        }
      })
    ).toThrow('file count')
    expect(() =>
      createTapeSkillMaterializationPayload({
        ...input(),
        executionPackage: {
          ...emptyExecutionPackage,
          files: executionFiles(
            SKILL_EXECUTION_PACKAGE_MAX_BYTES / SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES + 1,
            SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES
          )
        }
      })
    ).toThrow('byte count')
    expect(() =>
      createTapeSkillMaterializationPayload({
        ...input(),
        executionPackage: {
          ...emptyExecutionPackage,
          environmentBindingId: 'not-a-binding'
        }
      })
    ).toThrow('environment binding is invalid')

    const fullPackage = {
      ...emptyExecutionPackage,
      files: executionFiles(
        SKILL_EXECUTION_PACKAGE_MAX_BYTES / SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES,
        SKILL_EXECUTION_PACKAGE_MAX_FILE_BYTES
      )
    }
    expect(() =>
      validateTapeSkillMaterializationBatch(
        Array.from({ length: 5 }, (_, index) => ({
          ...input(),
          skillName: `skill-${index}`,
          sourceId: `source-${index}`,
          executionPackage: fullPackage
        }))
      )
    ).toThrow('package batch exceeds 16 MiB')
  })

  it('fails rather than truncating body, count, and aggregate overflow', () => {
    expect(() => createTapeSkillMaterializationPayload(input('x'.repeat(512 * 1024 + 1)))).toThrow(
      '512 KiB'
    )
    expect(() =>
      validateTapeSkillMaterializationBatch(Array.from({ length: 65 }, () => input()))
    ).toThrow('64 bodies')
    expect(() =>
      validateTapeSkillMaterializationBatch(
        Array.from({ length: 5 }, () => input('x'.repeat(512 * 1024)))
      )
    ).toThrow('2 MiB')
  })
})

describe('Tape Skill materialization capability', () => {
  it('recovers content, reuses equal payloads, and versions changed evidence', () => {
    const { rows, store } = createMaterializationStore()
    const service = new TapeSkillMaterializationService({
      getSkillMaterializationStore: () => store
    })
    const first = service.materializeSkillContexts([input()])[0]
    const second = service.materializeSkillContexts([input()])[0]

    expect(second.entryId).toBe(first.entryId)
    expect(rows).toHaveLength(1)
    expect(
      service.readSkillMaterialization(buildTapeSkillMaterializationRef(first)).payload
        .effectiveContent
    ).toBe('hello 🌍')

    const changedManifest = service.materializeSkillContexts([
      { ...input(), renderedManifestHash: hashSkillEffectiveContent('different manifest') }
    ])[0]
    const changedScripts = service.materializeSkillContexts([
      { ...input(), scriptInventoryHash: hashSkillEffectiveContent('different scripts') }
    ])[0]
    const changedPackage = service.materializeSkillContexts([
      { ...input(), executionPackage: executionPackage() }
    ])[0]

    expect(changedManifest.entryId).not.toBe(first.entryId)
    expect(changedScripts.entryId).not.toBe(first.entryId)
    expect(changedScripts.entryId).not.toBe(changedManifest.entryId)
    expect(changedPackage.entryId).not.toBe(first.entryId)
    expect(rows).toHaveLength(4)
  })

  it.each([
    ['kind', (row: DeepChatTapeEntryRow) => (row.kind = 'event')],
    ['name', (row: DeepChatTapeEntryRow) => (row.name = 'skill/other')],
    ['source type', (row: DeepChatTapeEntryRow) => (row.source_type = 'message')],
    ['source sequence', (row: DeepChatTapeEntryRow) => (row.source_seq = 1)],
    ['source identity', (row: DeepChatTapeEntryRow) => (row.source_id = 'other-source')],
    ['provenance', (row: DeepChatTapeEntryRow) => (row.provenance_key = 'other-key')],
    ['payload', (row: DeepChatTapeEntryRow) => (row.payload_json = '{}')],
    ['metadata', (row: DeepChatTapeEntryRow) => (row.meta_json = '{}')]
  ])('fails closed when stored %s is corrupt', (_name, mutate) => {
    const { rows, store } = createMaterializationStore()
    const service = new TapeSkillMaterializationService({
      getSkillMaterializationStore: () => store
    })
    const receipt = service.materializeSkillContexts([input()])[0]
    mutate(rows[0])

    expect(() =>
      service.readSkillMaterialization(buildTapeSkillMaterializationRef(receipt))
    ).toThrow()
  })

  it('rejects Tape reset drift and rolls back a failed materialization batch', () => {
    const { rows, store, setTapeIncarnationId, failNextAppend } = createMaterializationStore()
    const service = new TapeSkillMaterializationService({
      getSkillMaterializationStore: () => store
    })
    const receipt = service.materializeSkillContexts([input()])[0]
    setTapeIncarnationId('incarnation-2')
    expect(() =>
      service.readSkillMaterialization(buildTapeSkillMaterializationRef(receipt))
    ).toThrow('incarnation changed')
    const resetReceipt = service.materializeSkillContexts([
      { ...input(), expectedTapeIncarnationId: 'incarnation-2' }
    ])[0]
    expect(resetReceipt.entryId).not.toBe(receipt.entryId)
    expect(resetReceipt.tapeIncarnationId).toBe('incarnation-2')

    rows.splice(0)
    failNextAppend()
    expect(() =>
      service.materializeSkillContexts([
        { ...input('one'), expectedTapeIncarnationId: 'incarnation-2' },
        {
          ...input('two'),
          sourceId: 'source-2',
          skillName: 'skill-2',
          expectedTapeIncarnationId: 'incarnation-2'
        }
      ])
    ).toThrow('injected append failure')
    expect(rows).toEqual([])
  })

  it('checks the appended row instead of trusting persistence output', () => {
    const { rows, store } = createMaterializationStore()
    const append = store.appendSkillMaterialization
    store.appendSkillMaterialization = (candidate) => {
      const row = append(candidate)
      row.meta_json = JSON.stringify({
        payloadHash: buildTapeSkillMaterializationPayloadHash({
          ...candidate.payload,
          effectiveContent: 'different'
        })
      })
      return row
    }
    const service = new TapeSkillMaterializationService({
      getSkillMaterializationStore: () => store
    })

    expect(() => service.materializeSkillContexts([input()])).toThrow(/payload hash is corrupt/)
    expect(rows).toEqual([])
  })
})

describe('Tape runtime Skill-view result capability', () => {
  const viewInput = {
    sessionId: 'session-1',
    expectedTapeIncarnationId: 'incarnation-1',
    messageId: 'assistant-1',
    orderSeq: 2,
    blockIndex: 0,
    toolCallId: 'tool-call-1',
    toolName: 'skill_view' as const,
    responseText: JSON.stringify({
      success: true,
      name: 'review',
      content: 'effective Skill body',
      activatedForMessage: true,
      activationScope: 'message',
      activationEvidenceVersion: 1
    }),
    timestamp: 123,
    identity: {
      agentId: 'deepchat',
      sourceType: 'created' as const,
      sourceId: '/skills/review',
      skillName: 'review'
    }
  }

  it('strictly commits and reuses the same ordinary tool-result occurrence', async () => {
    const { rows, store } = createSkillViewFactStore()
    const service = new TapeFactService({ getEntryStore: () => store as never })
    const strictInput = { ...viewInput, ...commitSkillViewOutcome(store, viewInput.responseText) }

    const first = service.appendSkillViewResultFact(strictInput)
    const second = service.appendSkillViewResultFact(strictInput)
    const ordinary = await service.appendToolFact({
      sessionId: viewInput.sessionId,
      messageId: viewInput.messageId,
      orderSeq: viewInput.orderSeq,
      blockIndex: viewInput.blockIndex,
      block: {
        type: 'tool_call',
        content: '',
        status: 'success',
        timestamp: viewInput.timestamp,
        tool_call: {
          id: viewInput.toolCallId,
          name: viewInput.toolName,
          params: '{"name":"skill-1"}',
          response: viewInput.responseText
        }
      },
      provenance: {
        source: 'tool_result',
        sourceId: `${viewInput.messageId}:${viewInput.toolCallId}`,
        sequence: viewInput.blockIndex
      }
    })

    expect(second).toEqual(first)
    expect(ordinary.entryId).toBe(first.entryId)
    expect(rows.filter((row) => row.kind === 'tool_result')).toHaveLength(1)
    expect(JSON.parse(rows.find((row) => row.entry_id === first.entryId)!.payload_json)).toEqual({
      messageId: viewInput.messageId,
      orderSeq: viewInput.orderSeq,
      toolCallId: viewInput.toolCallId,
      response: viewInput.responseText
    })
  })

  it('fails closed on stored envelope corruption and Tape incarnation drift', () => {
    const { rows, store, setTapeIncarnationId } = createSkillViewFactStore()
    const service = new TapeFactService({ getEntryStore: () => store as never })
    const strictInput = { ...viewInput, ...commitSkillViewOutcome(store, viewInput.responseText) }
    const receipt = service.appendSkillViewResultFact(strictInput)
    const resultRow = rows.find((row) => row.entry_id === receipt.entryId)!
    resultRow.payload_json = '{}'

    expect(() => service.appendSkillViewResultFact(strictInput)).toThrow('envelope is corrupt')

    resultRow.payload_json = JSON.stringify({
      messageId: viewInput.messageId,
      orderSeq: viewInput.orderSeq,
      toolCallId: viewInput.toolCallId,
      response: viewInput.responseText
    })
    setTapeIncarnationId('incarnation-2')
    expect(() => service.appendSkillViewResultFact(strictInput)).toThrow('incarnation changed')
  })

  it('rejects oversized UTF-8 results before writing to Tape', () => {
    const { rows, store } = createSkillViewFactStore()
    const service = new TapeFactService({ getEntryStore: () => store as never })

    expect(() =>
      service.appendSkillViewResultFact({
        ...viewInput,
        responseText: '🌍'.repeat((768 * 1024) / 4 + 1),
        operation: SKILL_VIEW_OPERATION,
        outcomeEntryId: 1
      })
    ).toThrow('768 KiB')
    expect(rows).toEqual([])
  })

  it('requires the exact successful Journal outcome before appending a result fact', () => {
    const { rows, store } = createSkillViewFactStore()
    const service = new TapeFactService({ getEntryStore: () => store as never })
    const evidence = commitSkillViewOutcome(store, viewInput.responseText)

    expect(() =>
      service.appendSkillViewResultFact({
        ...viewInput,
        ...evidence,
        outcomeEntryId: 999
      })
    ).toThrow('Journal outcome is missing')
    expect(() =>
      service.appendSkillViewResultFact({
        ...viewInput,
        ...evidence,
        outcomeEntryId: rows.find((row) => row.name === 'execution/run_started')!.entry_id
      })
    ).toThrow('does not match its exact result')
    expect(() =>
      service.appendSkillViewResultFact({
        ...viewInput,
        ...evidence,
        responseText: JSON.stringify({
          ...JSON.parse(viewInput.responseText),
          content: 'drifted effective Skill body'
        })
      })
    ).toThrow('does not match its exact result')
    expect(() =>
      service.appendSkillViewResultFact({
        ...viewInput,
        ...evidence,
        messageId: 'assistant-other'
      })
    ).toThrow('does not match its exact result')
    expect(() =>
      service.appendSkillViewResultFact({
        ...viewInput,
        ...evidence,
        operation: {
          ...evidence.operation,
          runId: '22222222-2222-4222-8222-222222222222'
        }
      })
    ).toThrow('Journal dispatch is missing')

    expect(() =>
      service.appendSkillViewResultFact({
        ...viewInput,
        ...evidence,
        identity: { ...viewInput.identity, skillName: 'other-skill' }
      })
    ).toThrow('does not match its activation identity')

    const mismatchedResult = JSON.stringify({
      success: true,
      name: 'other-skill',
      content: 'effective Skill body',
      activatedForMessage: true,
      activationScope: 'message',
      activationEvidenceVersion: 1
    })
    const { store: mismatchedResultStore } = createSkillViewFactStore()
    const mismatchedResultService = new TapeFactService({
      getEntryStore: () => mismatchedResultStore as never
    })
    const mismatchedResultEvidence = commitSkillViewOutcome(mismatchedResultStore, mismatchedResult)
    expect(() =>
      mismatchedResultService.appendSkillViewResultFact({
        ...viewInput,
        ...mismatchedResultEvidence,
        responseText: mismatchedResult
      })
    ).toThrow('does not match its activation identity')

    const dispatchRow = rows.find((row) => row.name === 'execution/dispatch_committed')!
    const dispatchPayload = dispatchRow.payload_json
    const driftedDispatchPayload = JSON.parse(dispatchPayload)
    driftedDispatchPayload.data.argumentsHash = '0'.repeat(64)
    dispatchRow.payload_json = JSON.stringify(driftedDispatchPayload)
    expect(() =>
      service.appendSkillViewResultFact({
        ...viewInput,
        ...evidence
      })
    ).toThrow('Journal chain does not match its exact result')

    driftedDispatchPayload.data.argumentsHash = JSON.parse(dispatchPayload).data.argumentsHash
    driftedDispatchPayload.data.target.serverName = 'other-server'
    dispatchRow.payload_json = JSON.stringify(driftedDispatchPayload)
    expect(() =>
      service.appendSkillViewResultFact({
        ...viewInput,
        ...evidence
      })
    ).toThrow('Journal chain does not match its exact result')
    dispatchRow.payload_json = dispatchPayload

    expect(rows.filter((row) => row.kind === 'tool_result')).toEqual([])
  })
})

const tableModule = Database ? await import('@/tape/infrastructure/sqlite/tapeEntryStore') : null
const Table = tableModule?.DeepChatTapeEntriesTable
const describeSqlite = nativeSqliteDescribeIf(
  Boolean(Table),
  'Tape Skill materialization SQLite store is unavailable'
)

describeSqlite('Tape Skill materialization SQLite capability', () => {
  it('appends once, strictly reuses, rejects forgery, and fails after reset identity drift', () => {
    const db = new Database!(':memory:')
    const table = new Table!(db)
    table.createTable()
    table.appendAnchor({
      sessionId: 'session-1',
      name: 'session/start',
      state: {},
      meta: { tapeIncarnationId: 'incarnation-1' }
    })
    const service = new TapeSkillMaterializationService({
      getSkillMaterializationStore: () => table
    })
    const first = service.materializeSkillContexts([input()])[0]
    const second = service.materializeSkillContexts([input()])[0]
    expect(second.entryId).toBe(first.entryId)
    expect(
      service.readSkillMaterialization({
        sessionId: first.sessionId,
        entryId: first.entryId,
        kind: 'materialization',
        tapeIncarnationId: first.tapeIncarnationId,
        agentId: first.payload.agentId,
        sourceType: first.payload.sourceType,
        sourceId: first.payload.sourceId,
        skillName: first.payload.skillName,
        effectiveContentHash: first.payload.effectiveContentHash
      }).payload.effectiveContent
    ).toBe('hello 🌍')
    expect(() =>
      table.append({
        sessionId: 'session-1',
        kind: 'context',
        name: 'skill/materialized',
        payload: {}
      })
    ).toThrow('reserved')
    expect(() =>
      table.append({
        sessionId: 'session-1',
        kind: 'context',
        name: 'custom/context',
        payload: {}
      })
    ).toThrow('context entry kind is reserved')
    expect(table.search('session-1', 'hello 🌍')).toEqual([])
    expect(table.search('session-1', 'hello 🌍', { kinds: ['context'] })).toEqual([])
    expect(
      table.getBySessionExcludingContext('session-1').some((row) => row.kind === 'context')
    ).toBe(false)
    db.prepare("UPDATE deepchat_tape_entries SET meta_json = ? WHERE name = 'session/start'").run(
      JSON.stringify({ tapeIncarnationId: 'incarnation-2' })
    )
    expect(() => service.readSkillMaterialization(buildTapeSkillMaterializationRef(first))).toThrow(
      'incarnation changed'
    )
    db.close()
  })

  it('fails closed when a same-key row payload is corrupt', () => {
    const db = new Database!(':memory:')
    const table = new Table!(db)
    table.createTable()
    table.appendAnchor({
      sessionId: 'session-1',
      name: 'session/start',
      state: {},
      meta: { tapeIncarnationId: 'incarnation-1' }
    })
    const service = new TapeSkillMaterializationService({
      getSkillMaterializationStore: () => table
    })
    const receipt = service.materializeSkillContexts([input()])[0]
    db.prepare('UPDATE deepchat_tape_entries SET payload_json = ? WHERE entry_id = ?').run(
      '{}',
      receipt.entryId
    )
    expect(() => service.materializeSkillContexts([input()])).toThrow()
    db.close()
  })
})
