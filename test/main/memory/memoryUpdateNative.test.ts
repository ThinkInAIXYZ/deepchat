import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

import { MemoryService } from '@/memory'
import { buildMemoryProvenanceKey } from '@/memory/core/scoring'
import type { AgentMemoryInsertInput } from '@/memory/domain/types'
import type { ConflictService } from '@/memory/services/conflictService'
import { createFakeRepository, FakeVectorStore } from './support/memoryFakes'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
const presenterModule = Database ? await import('@/data/mainDatabase').catch(() => null) : null
const memoryDatabaseModule = Database
  ? await import('@/memory/data/database').catch(() => null)
  : null
const MainDatabase = presenterModule?.MainDatabase
const MemoryDatabase = memoryDatabaseModule?.MemoryDatabase
const MainDatabaseCtor = MainDatabase!
const MemoryDatabaseCtor = MemoryDatabase!
const describeIfNative = nativeSqliteDescribeIf(
  Boolean(MainDatabase && MemoryDatabase),
  'Native SQLite database or memory database is unavailable'
)
const memoryDatabases = new WeakMap<
  InstanceType<typeof MainDatabaseCtor>,
  InstanceType<typeof MemoryDatabaseCtor>
>()

function memoryDatabase(database: InstanceType<typeof MainDatabaseCtor>) {
  let memory = memoryDatabases.get(database)
  if (!memory) {
    memory = new MemoryDatabaseCtor(database)
    memoryDatabases.set(database, memory)
  }
  return memory
}

function memoryTable(database: InstanceType<typeof MainDatabaseCtor>) {
  return memoryDatabase(database).agentMemoryTable
}

function memoryAuditTable(database: InstanceType<typeof MainDatabaseCtor>) {
  return memoryDatabase(database).agentMemoryAuditTable
}

describeIfNative('Memory update SQLite integration', () => {
  it('rejects partial canonical insert state in fake and SQLite repositories', () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-insert-state-'))
    const sqlite = new MainDatabaseCtor(join(directory, 'agent.db'))
    const fake = createFakeRepository()
    const partialInput = {
      id: 'partial-canonical',
      agentId: 'a',
      kind: 'semantic',
      content: 'partial canonical input',
      lifecycleState: 'active'
    } as unknown as AgentMemoryInsertInput
    try {
      for (const repository of [memoryTable(sqlite), fake]) {
        expect(() => repository.insert(partialInput)).toThrow(
          'Memory inserts must provide both canonical state fields or neither'
        )
      }
    } finally {
      sqlite.close()
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps fake and SQLite archive transition guards in parity', () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-transition-parity-'))
    const sqlite = new MainDatabaseCtor(join(directory, 'agent.db'))
    const fake = createFakeRepository()
    try {
      for (const repository of [memoryTable(sqlite), fake]) {
        repository.insert({ id: 'active', agentId: 'a', kind: 'semantic', content: 'active' })
        repository.insert({ id: 'internal', agentId: 'a', kind: 'working', content: 'internal' })
        repository.insert({ id: 'superseded', agentId: 'a', kind: 'semantic', content: 'old' })
        repository.insert({ id: 'head', agentId: 'a', kind: 'semantic', content: 'head' })
        repository.insert({
          id: 'challenged',
          agentId: 'a',
          kind: 'semantic',
          content: 'challenged'
        })
        expect(repository.markSupersededIfRevision('a', 'superseded', 1, 'head')).toBe(true)
        expect(repository.markConflictIfRevision('a', 'challenged', 1, 'challenged')).toBe(true)
      }

      const cases = [
        { id: 'missing', agentId: 'a', revision: 1 },
        { id: 'active', agentId: 'other', revision: 1 },
        { id: 'active', agentId: 'a', revision: 2 },
        { id: 'internal', agentId: 'a', revision: 1 },
        { id: 'superseded', agentId: 'a', revision: 2 },
        { id: 'challenged', agentId: 'a', revision: 2 },
        { id: 'active', agentId: 'a', revision: 1 }
      ] as const
      for (const testCase of cases) {
        const input = {
          agentId: testCase.agentId,
          id: testCase.id,
          expectedRevision: testCase.revision
        }
        expect(fake.archiveActiveMemory(input)).toBe(memoryTable(sqlite).archiveActiveMemory(input))
      }
    } finally {
      sqlite.close()
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('retires the current head exactly once when a manual edit changes A to B and back to A', async () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-update-'))
    const sqlite = new MainDatabaseCtor(join(directory, 'agent.db'))
    const presenter = new MemoryService({
      repository: memoryTable(sqlite),
      auditRepository: memoryAuditTable(sqlite),
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      executeWithRateLimit: async () => undefined,
      getEmbeddings: async () => [],
      getDimensions: async () => ({ data: { dimensions: 4, normalized: false } }),
      generateText: async () => '',
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })

    try {
      memoryTable(sqlite).insert({
        id: 'memory-a',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'user prefers alpha',
        provenanceKey: buildMemoryProvenanceKey('deepchat', 'semantic', 'user prefers alpha')
      })

      const first = presenter.updateMemory('deepchat', 'memory-a', {
        content: 'user prefers beta'
      })
      expect(first.action).toBe('superseded')
      const memoryBId = first.memoryId!

      const second = presenter.updateMemory('deepchat', memoryBId, {
        content: 'user prefers alpha'
      })
      expect(second).toEqual({
        action: 'superseded',
        memoryId: 'memory-a',
        supersededId: memoryBId
      })

      const memoryA = memoryTable(sqlite).getById('memory-a')
      const memoryB = memoryTable(sqlite).getById(memoryBId)
      expect(memoryA).toMatchObject({
        lifecycle_state: 'active',
        embedding_state: 'pending',
        superseded_by: null,
        decision_revision: 3
      })
      expect(memoryB).toMatchObject({
        lifecycle_state: 'active',
        superseded_by: 'memory-a',
        decision_revision: 2
      })
      expect(
        memoryTable(sqlite)
          .search('deepchat', 'alpha')
          .map((row) => row.id)
      ).toEqual(['memory-a'])
      expect(memoryTable(sqlite).search('deepchat', 'beta')).toHaveLength(0)

      expect(
        presenter.updateMemory('deepchat', memoryBId, { content: 'user prefers alpha' })
      ).toEqual({ action: 'noop', reason: 'not-editable' })
      expect(memoryTable(sqlite).getById('memory-a')?.decision_revision).toBe(3)
      expect(
        memoryAuditTable(sqlite).listByAgent('deepchat', {
          eventType: 'memory/manual_edit'
        })
      ).toHaveLength(2)
    } finally {
      await presenter.dispose()
      sqlite.close()
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rolls back a merged challenger when its provenance key is already owned', async () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-conflict-'))
    const sqlite = new MainDatabaseCtor(join(directory, 'agent.db'))
    const onMemoryChanged = vi.fn()
    const getEmbeddings = vi.fn(async () => [])
    const presenter = new MemoryService({
      repository: memoryTable(sqlite),
      auditRepository: memoryAuditTable(sqlite),
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      onMemoryChanged,
      executeWithRateLimit: async () => undefined,
      getEmbeddings,
      getDimensions: async () => ({ data: { dimensions: 4, normalized: false } }),
      generateText: async () => '',
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })

    try {
      const mergedContent = 'occupied merged memory'
      memoryTable(sqlite).insert({
        id: 'target',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'target memory'
      })
      memoryTable(sqlite).insert({
        id: 'challenger',
        agentId: 'deepchat',
        kind: 'semantic',
        content: 'challenger memory',
        lifecycleState: 'conflicted',
        embeddingState: 'pending',
        conflictWith: 'target'
      })
      memoryTable(sqlite).insert({
        id: 'provenance-owner',
        agentId: 'deepchat',
        kind: 'semantic',
        content: mergedContent,
        provenanceKey: buildMemoryProvenanceKey('deepchat', 'semantic', mergedContent)
      })
      expect(
        memoryTable(sqlite).markConflictIfRevision('deepchat', 'target', 1, 'challenger')
      ).toBe(true)

      const targetBefore = { ...memoryTable(sqlite).getById('target')! }
      const challengerBefore = { ...memoryTable(sqlite).getById('challenger')! }
      const ftsGenerationBefore = sqlite
        .getDatabase()
        .prepare(
          `SELECT mutation_generation, indexed_generation
           FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'`
        )
        .get()
      const searchBefore = memoryTable(sqlite)
        .search('deepchat', 'occupied')
        .map((row) => row.id)
      const conflictService = (
        presenter as unknown as { conflict: Pick<ConflictService, 'resolveConflict'> }
      ).conflict

      await expect(
        conflictService.resolveConflict(
          'deepchat',
          'challenger',
          'keep_challenger',
          'scheduler',
          null,
          { mergedContent }
        )
      ).resolves.toBe(false)

      expect(memoryTable(sqlite).getById('target')).toEqual(targetBefore)
      expect(memoryTable(sqlite).getById('challenger')).toEqual(challengerBefore)
      expect(
        sqlite
          .getDatabase()
          .prepare(
            `SELECT mutation_generation, indexed_generation
             FROM agent_memory_fts_meta WHERE key = 'agent_memory_fts'`
          )
          .get()
      ).toEqual(ftsGenerationBefore)
      expect(
        memoryTable(sqlite)
          .search('deepchat', 'occupied')
          .map((row) => row.id)
      ).toEqual(searchBefore)
      expect(
        memoryAuditTable(sqlite).listByAgent('deepchat', {
          eventType: 'memory/challenge_resolved'
        })
      ).toHaveLength(0)
      expect(onMemoryChanged).not.toHaveBeenCalled()
      expect(getEmbeddings).not.toHaveBeenCalled()
    } finally {
      await presenter.dispose()
      sqlite.close()
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
