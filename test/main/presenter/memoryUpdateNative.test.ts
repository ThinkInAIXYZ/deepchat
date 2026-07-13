import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, it, vi } from 'vitest'

import { MemoryPresenter } from '@/presenter/memoryPresenter'
import { buildMemoryProvenanceKey } from '@/presenter/memoryPresenter/core/scoring'
import { createFakeRepository, FakeVectorStore } from './fakes/memoryFakes'
import { Database, nativeSqliteDescribeIf } from '../nativeSqliteHarness'

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
const presenterModule = Database
  ? await import('@/presenter/sqlitePresenter').catch(() => null)
  : null
const SQLitePresenter = presenterModule?.SQLitePresenter
const SQLitePresenterCtor = SQLitePresenter!
const describeIfNative = nativeSqliteDescribeIf(
  Boolean(SQLitePresenter),
  'Native SQLite presenter is unavailable'
)

describeIfNative('Memory update SQLite integration', () => {
  it('keeps fake and SQLite archive transition guards in parity', () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-transition-parity-'))
    const sqlite = new SQLitePresenterCtor(join(directory, 'agent.db'))
    const fake = createFakeRepository()
    try {
      for (const repository of [sqlite.agentMemoryTable, fake]) {
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
        expect(fake.archiveActiveMemory(input)).toBe(
          sqlite.agentMemoryTable.archiveActiveMemory(input)
        )
      }
    } finally {
      sqlite.close()
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('retires the current head exactly once when a manual edit changes A to B and back to A', async () => {
    const directory = actualFs.mkdtempSync(join(tmpdir(), 'deepchat-memory-update-'))
    const sqlite = new SQLitePresenterCtor(join(directory, 'agent.db'))
    const presenter = new MemoryPresenter({
      repository: sqlite.agentMemoryTable,
      auditRepository: sqlite.agentMemoryAuditTable,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      executeWithRateLimit: async () => undefined,
      getEmbeddings: async () => [],
      getDimensions: async () => ({ data: { dimensions: 4, normalized: false } }),
      generateText: async () => '',
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })

    try {
      sqlite.agentMemoryTable.insert({
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

      const memoryA = sqlite.agentMemoryTable.getById('memory-a')
      const memoryB = sqlite.agentMemoryTable.getById(memoryBId)
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
      expect(sqlite.agentMemoryTable.search('deepchat', 'alpha').map((row) => row.id)).toEqual([
        'memory-a'
      ])
      expect(sqlite.agentMemoryTable.search('deepchat', 'beta')).toHaveLength(0)

      expect(
        presenter.updateMemory('deepchat', memoryBId, { content: 'user prefers alpha' })
      ).toEqual({ action: 'noop', reason: 'not-editable' })
      expect(sqlite.agentMemoryTable.getById('memory-a')?.decision_revision).toBe(3)
      expect(
        sqlite.agentMemoryAuditTable.listByAgent('deepchat', {
          eventType: 'memory/manual_edit'
        })
      ).toHaveLength(2)
    } finally {
      await presenter.dispose()
      sqlite.close()
      actualFs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
