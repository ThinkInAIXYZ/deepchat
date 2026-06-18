import { describe, expect, it, vi } from 'vitest'

import {
  MemoryPresenter,
  appendMemorySection,
  buildMemorySection,
  isSafeAgentId
} from '@/presenter/memoryPresenter'
import {
  buildMemoryProvenanceKey,
  distanceToSimilarity,
  recencyScore,
  resolveRetrieval,
  retrievalScore
} from '@/presenter/memoryPresenter/scoring'
import type {
  AgentMemoryInsertInput,
  AgentMemoryRow,
  IMemoryVectorStore,
  MemoryRepositoryPort,
  MemoryVectorMatch,
  MemoryVectorRecord
} from '@/presenter/memoryPresenter/types'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'

class FakeRepository implements MemoryRepositoryPort {
  rows = new Map<string, AgentMemoryRow>()

  insert(input: AgentMemoryInsertInput): AgentMemoryRow {
    if (input.provenanceKey) {
      for (const row of this.rows.values()) {
        if (row.agent_id === input.agentId && row.provenance_key === input.provenanceKey) {
          throw new Error('UNIQUE constraint failed')
        }
      }
    }
    const row: AgentMemoryRow = {
      id: input.id,
      agent_id: input.agentId,
      user_scope: input.userScope ?? null,
      kind: input.kind,
      content: input.content,
      importance: input.importance ?? 0.5,
      status: input.status ?? 'pending_embedding',
      embedding_id: null,
      embedding_dim: null,
      source_session: input.sourceSession ?? null,
      provenance_key: input.provenanceKey ?? null,
      is_anchor: input.isAnchor ? 1 : 0,
      superseded_by: null,
      created_at: input.createdAt ?? 1000,
      last_accessed: null,
      access_count: 0,
      decay_score: null
    }
    this.rows.set(row.id, row)
    return row
  }

  getById(id: string) {
    return this.rows.get(id)
  }

  getByProvenanceKey(agentId: string, provenanceKey: string) {
    return [...this.rows.values()].find(
      (row) => row.agent_id === agentId && row.provenance_key === provenanceKey
    )
  }

  listByAgent(agentId: string, options?: { includeSuperseded?: boolean }) {
    return [...this.rows.values()].filter(
      (row) => row.agent_id === agentId && (options?.includeSuperseded || !row.superseded_by)
    )
  }

  getActivePersona(agentId: string) {
    return [...this.rows.values()]
      .filter((row) => row.agent_id === agentId && row.kind === 'persona' && !row.superseded_by)
      .sort((a, b) => b.created_at - a.created_at)[0]
  }

  listPersonaVersions(agentId: string) {
    return [...this.rows.values()]
      .filter((row) => row.agent_id === agentId && row.kind === 'persona')
      .sort((a, b) => b.created_at - a.created_at)
  }

  search(agentId: string, query: string, limit = 20) {
    const q = query.toLowerCase()
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.agent_id === agentId && !row.superseded_by && row.content.toLowerCase().includes(q)
      )
      .slice(0, limit)
  }

  listPendingEmbedding(limit = 50) {
    return [...this.rows.values()]
      .filter((row) => row.status === 'pending_embedding')
      .slice(0, limit)
  }

  updateStatus(
    id: string,
    status: AgentMemoryRow['status'],
    embedding?: { embeddingId?: string | null; embeddingDim?: number | null }
  ) {
    const row = this.rows.get(id)
    if (!row) return
    row.status = status
    row.embedding_id = embedding?.embeddingId ?? row.embedding_id
    row.embedding_dim = embedding?.embeddingDim ?? row.embedding_dim
  }

  markSuperseded(id: string, supersededBy: string | null) {
    const row = this.rows.get(id)
    if (row) row.superseded_by = supersededBy
  }

  recordAccess(id: string, accessedAt = 0) {
    const row = this.rows.get(id)
    if (row) {
      row.last_accessed = accessedAt
      row.access_count += 1
    }
  }

  delete(id: string) {
    this.rows.delete(id)
  }

  clearByAgent(agentId: string) {
    let removed = 0
    for (const [id, row] of this.rows) {
      if (row.agent_id === agentId) {
        this.rows.delete(id)
        removed += 1
      }
    }
    return removed
  }

  countByAgent(agentId: string) {
    return this.listByAgent(agentId, { includeSuperseded: true }).length
  }
}

class FakeVectorStore implements IMemoryVectorStore {
  vectors = new Map<string, number[]>()

  async upsert(records: MemoryVectorRecord[]) {
    for (const record of records) this.vectors.set(record.memoryId, record.embedding)
  }

  async query(embedding: number[], options: { topK: number }): Promise<MemoryVectorMatch[]> {
    return [...this.vectors.entries()]
      .map(([memoryId, vec]) => ({ memoryId, distance: 1 - cosine(embedding, vec) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, options.topK)
  }

  async deleteByMemoryIds(memoryIds: string[]) {
    for (const id of memoryIds) this.vectors.delete(id)
  }

  async close() {}

  isUsable() {
    return true
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

function makePresenter(config: DeepChatAgentConfig | null, repo = new FakeRepository()) {
  const store = new FakeVectorStore()
  const getEmbeddings = vi.fn(async (_p: string, _m: string, texts: string[]) =>
    texts.map((text) => textToVector(text))
  )
  // Models the on-disk reset: clearing memories deletes the agent's vector file.
  const resetVectorStore = vi.fn(async () => {
    store.vectors.clear()
  })
  const presenter = new MemoryPresenter({
    repository: repo,
    resolveAgentConfig: () => config,
    getEmbeddings,
    createVectorStore: async () => store,
    resetVectorStore
  })
  return { presenter, repo, store, getEmbeddings, resetVectorStore }
}

// 把文本映射成与关键词相关的玩具向量，便于断言相似度排序。
function textToVector(text: string): number[] {
  const t = text.toLowerCase()
  return [t.includes('redis') ? 1 : 0, t.includes('vue') ? 1 : 0, t.includes('简洁') ? 1 : 0, 0.01]
}

const enabledConfig: DeepChatAgentConfig = {
  memoryEnabled: true,
  memoryEmbedding: { providerId: 'p', modelId: 'm' }
}

describe('memory scoring', () => {
  it('distanceToSimilarity clamps to [0,1]', () => {
    expect(distanceToSimilarity(0)).toBe(1)
    expect(distanceToSimilarity(1)).toBe(0)
    expect(distanceToSimilarity(2)).toBe(0)
    expect(distanceToSimilarity(-1)).toBe(1)
  })

  it('recencyScore decays by half-life', () => {
    const half = 1000
    expect(recencyScore(0, 0, half)).toBeCloseTo(1)
    expect(recencyScore(0, 1000, half)).toBeCloseTo(0.5)
    expect(recencyScore(0, 2000, half)).toBeCloseTo(0.25)
  })

  it('retrievalScore combines weighted components', () => {
    const score = retrievalScore({ importance: 1, created_at: 1000 }, 1, 1000, {
      similarity: 0.6,
      recency: 0.25,
      importance: 0.15
    })
    expect(score).toBeCloseTo(0.6 + 0.25 + 0.15)
  })

  it('resolveRetrieval falls back to defaults', () => {
    expect(resolveRetrieval(null).topK).toBe(6)
    expect(resolveRetrieval({ topK: 3 }).topK).toBe(3)
  })

  it('provenance key is stable and dedupes on normalized content', () => {
    const a = buildMemoryProvenanceKey('agent', 'semantic', '  Likes   Redis  ')
    const b = buildMemoryProvenanceKey('agent', 'semantic', 'likes redis')
    expect(a).toBe(b)
    const c = buildMemoryProvenanceKey('agent', 'episodic', 'likes redis')
    expect(c).not.toBe(a)
  })
})

describe('buildMemorySection / appendMemorySection', () => {
  it('returns empty string for null payload', () => {
    expect(buildMemorySection(null)).toBe('')
    expect(appendMemorySection('base', null)).toBe('base')
  })

  it('renders self-model and memories', () => {
    const section = buildMemorySection({
      selfModel: 'I am concise',
      memories: [{ id: '1', kind: 'semantic', content: 'user likes redis' }]
    })
    expect(section).toContain('## Self-Model')
    expect(section).toContain('I am concise')
    expect(section).toContain('## Relevant Memories')
    expect(section).toContain('user likes redis')
  })

  it('appends to existing prompt without overwriting', () => {
    const result = appendMemorySection('USER PROMPT', {
      selfModel: 'persona',
      memories: []
    })
    expect(result.startsWith('USER PROMPT')).toBe(true)
    expect(result).toContain('## Self-Model')
  })
})

describe('MemoryPresenter write + two-phase embedding', () => {
  it('writeMemoriesSync dedupes by provenance', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const first = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'user likes redis' }], {
      agentId: 'a'
    })
    const second = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'User Likes Redis' }],
      { agentId: 'a' }
    )
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
    expect(repo.countByAgent('a')).toBe(1)
  })

  it('processPendingEmbeddings embeds and flips status to embedded', async () => {
    const { presenter, repo, store } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const row = repo.listByAgent('a')[0]
    expect(row.status).toBe('embedded')
    expect(store.vectors.size).toBe(1)
  })

  it('degrades to fts_only when no embedding config', async () => {
    const { presenter, repo } = makePresenter({ memoryEnabled: true, memoryEmbedding: null })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(repo.listByAgent('a')[0].status).toBe('fts_only')
  })
})

describe('MemoryPresenter recall + injection', () => {
  it('recall returns vector-similar memories ranked', async () => {
    const { presenter } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync(
      [
        { kind: 'semantic', content: 'user prefers redis caching' },
        { kind: 'semantic', content: 'user builds vue apps' }
      ],
      { agentId: 'a' }
    )
    await presenter.processPendingEmbeddings('a')
    const results = await presenter.recall('a', 'redis question')
    expect(results[0].content).toContain('redis')
  })

  it('buildInjection returns null when disabled', async () => {
    const { presenter } = makePresenter({ memoryEnabled: false })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'x' }], { agentId: 'a' })
    expect(await presenter.buildInjection('a', 'x')).toBeNull()
  })

  it('buildInjection includes self-model and recalled memories', async () => {
    const { presenter } = makePresenter(enabledConfig)
    presenter.evolvePersona('a', 'I answer concisely')
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const payload = await presenter.buildInjection('a', 'redis')
    expect(payload?.selfModel).toBe('I answer concisely')
    expect(payload?.memories.length).toBeGreaterThan(0)
  })
})

describe('MemoryPresenter persona evolution', () => {
  it('evolve supersedes previous active persona', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    const v2 = presenter.evolvePersona('a', 'v2', null)
    expect(presenter.listPersonaVersions('a')).toHaveLength(2)
    expect(repo.getById(v1!)?.superseded_by).toBe(v2)
    expect(presenter.getStatus('a').hasPersona).toBe(true)
  })

  it('does not supersede anchor personas', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'anchor',
      agentId: 'a',
      kind: 'persona',
      content: 'core values',
      isAnchor: true,
      createdAt: 1
    })
    presenter.evolvePersona('a', 'evolved', null)
    expect(repo.getById('anchor')?.superseded_by).toBeNull()
  })

  it('rollback restores a historical version', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    const v2 = presenter.evolvePersona('a', 'v2', null)
    expect(presenter.rollbackPersona('a', v1!)).toBe(true)
    expect(repo.getById(v1!)?.superseded_by).toBeNull()
    expect(repo.getById(v2!)?.superseded_by).toBe(v1)
  })
})

describe('MemoryPresenter management', () => {
  it('clearMemories removes all and clears vectors', async () => {
    const { presenter, store } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(store.vectors.size).toBe(1)
    const removed = await presenter.clearMemories('a')
    expect(removed).toBe(1)
    expect(store.vectors.size).toBe(0)
  })

  it('clearMemories closes the cached store, resets disk, and re-creates it next time', async () => {
    const repo = new FakeRepository()
    const stores: FakeVectorStore[] = []
    const createVectorStore = vi.fn(async () => {
      const s = new FakeVectorStore()
      stores.push(s)
      return s
    })
    const resetVectorStore = vi.fn(async () => undefined)
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore,
      resetVectorStore
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(createVectorStore).toHaveBeenCalledTimes(1)
    const closeSpy = vi.spyOn(stores[0], 'close')

    await presenter.clearMemories('a')
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(resetVectorStore).toHaveBeenCalledWith('a')

    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'pg' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(createVectorStore).toHaveBeenCalledTimes(2)
  })

  it('clearMemories resets the on-disk store even when nothing is cached', async () => {
    const repo = new FakeRepository()
    const resetVectorStore = vi.fn(async () => undefined)
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore,
      resetVectorStore
    })
    // Simulate a fresh process: a memory row exists on disk but no vector store is cached.
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    expect(createVectorStore).not.toHaveBeenCalled()

    await presenter.clearMemories('a')
    expect(resetVectorStore).toHaveBeenCalledWith('a')
  })

  it('concurrent vector-store access shares a single create (promise cache)', async () => {
    const repo = new FakeRepository()
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    // Two cold-cache recalls in flight: only one create must open the file.
    await Promise.all([presenter.recall('a', 'redis'), presenter.recall('a', 'redis')])
    expect(createVectorStore).toHaveBeenCalledTimes(1)
  })

  it('processPendingEmbeddings does not open the sidecar for a row cleared during the await', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const createVectorStore = vi.fn(async () => store)
    let resolveEmb: () => void = () => {}
    const getEmbeddings = vi.fn(
      () =>
        new Promise<number[][]>((resolve) => {
          resolveEmb = () => resolve([textToVector('redis')])
        })
    )
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings,
      createVectorStore,
      resetVectorStore: async () => undefined
    })
    const ids = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    const pending = presenter.processPendingEmbeddings('a') // suspends on getEmbeddings
    await presenter.clearMemories('a') // deletes the row + resets the store
    resolveEmb()
    await pending
    // Row was gone before the store was opened → no sidecar (re)created, no orphan vector.
    expect(createVectorStore).not.toHaveBeenCalled()
    expect(store.vectors.has(ids[0])).toBe(false)
  })

  it('clearMemories awaits an in-flight create, then closes and resets it', async () => {
    const repo = new FakeRepository()
    const created = new FakeVectorStore()
    let resolveCreate: () => void = () => {}
    const createVectorStore = vi.fn(
      () =>
        new Promise<IMemoryVectorStore>((resolve) => {
          resolveCreate = () => resolve(created)
        })
    )
    // Models the on-disk reset: deleting the file drops whatever the in-flight create wrote.
    const resetVectorStore = vi.fn(async () => {
      created.vectors.clear()
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore,
      resetVectorStore
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    const closeSpy = vi.spyOn(created, 'close')

    // An embedding blocks inside createVectorStore, holding the per-agent lock.
    const embedding = presenter.processPendingEmbeddings('a')
    await new Promise((r) => setTimeout(r, 0))
    expect(createVectorStore).toHaveBeenCalledTimes(1)

    // Clearing while the create is in flight must queue behind the lock, not race past it.
    const clear = presenter.clearMemories('a')
    await new Promise((r) => setTimeout(r, 0))
    expect(resetVectorStore).not.toHaveBeenCalled()

    resolveCreate()
    await Promise.all([embedding, clear])

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(resetVectorStore).toHaveBeenCalledWith('a')
    // The cleared row was deleted before the embedding resumed → no orphan vector written.
    expect(created.vectors.size).toBe(0)
  })

  it('deleteMemory only deletes owned memory', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const ids = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    expect(await presenter.deleteMemory('other-agent', ids[0])).toBe(false)
    expect(await presenter.deleteMemory('a', ids[0])).toBe(true)
    expect(repo.countByAgent('a')).toBe(0)
  })
})

describe('MemoryPresenter change events (onMemoryChanged)', () => {
  function makeWithSpy(config: DeepChatAgentConfig = enabledConfig) {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const onMemoryChanged = vi.fn()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async () => [],
      generateText: async () => '[]',
      createVectorStore: async () => store,
      resetVectorStore: async () => undefined,
      onMemoryChanged
    })
    return { presenter, repo, onMemoryChanged }
  }

  it('emits "delete" when an owned memory is deleted', async () => {
    const { presenter, onMemoryChanged } = makeWithSpy()
    const ids = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    onMemoryChanged.mockClear()
    await presenter.deleteMemory('a', ids[0])
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'delete')
  })

  it('emits "clear" only when something was removed', async () => {
    const { presenter, onMemoryChanged } = makeWithSpy()
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    onMemoryChanged.mockClear()
    await presenter.clearMemories('a')
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'clear')

    onMemoryChanged.mockClear()
    await presenter.clearMemories('a') // already empty
    expect(onMemoryChanged).not.toHaveBeenCalled()
  })

  it('emits "persona-evolve" and "persona-rollback"', () => {
    const { presenter, onMemoryChanged } = makeWithSpy()
    const v1 = presenter.evolvePersona('a', 'v1', null)
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'persona-evolve')
    presenter.evolvePersona('a', 'v2', null)
    onMemoryChanged.mockClear()
    presenter.rollbackPersona('a', v1!)
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'persona-rollback')
  })

  it('emits "extract" when rememberMemory writes a new memory', async () => {
    const { presenter, onMemoryChanged } = makeWithSpy()
    const created = await presenter.rememberMemory(
      { kind: 'semantic', content: 'user prefers redis' },
      { agentId: 'a' }
    )
    expect(created).toHaveLength(1)
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'extract')

    // 去重命中（同内容）不再发事件
    onMemoryChanged.mockClear()
    const again = await presenter.rememberMemory(
      { kind: 'semantic', content: 'user prefers redis' },
      { agentId: 'a' }
    )
    expect(again).toHaveLength(0)
    expect(onMemoryChanged).not.toHaveBeenCalled()
  })

  it('emits "extract" when extraction writes new memories', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const onMemoryChanged = vi.fn()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      generateText: async () => '[{"kind":"semantic","content":"likes redis","importance":0.9}]',
      createVectorStore: async () => store,
      onMemoryChanged
    })
    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I like redis',
      model: { providerId: 'p', modelId: 'm' }
    })
    expect(result.ok).toBe(true)
    expect(onMemoryChanged).toHaveBeenCalledWith('a', 'extract')
  })
})

describe('MemoryPresenter agentId safety guards', () => {
  it('isSafeAgentId accepts well-formed ids and rejects traversal/garbage', () => {
    expect(isSafeAgentId('deepchat')).toBe(true)
    expect(isSafeAgentId('deepchat-Ab12_xy')).toBe(true)
    expect(isSafeAgentId('../../etc/passwd')).toBe(false)
    expect(isSafeAgentId('a/b')).toBe(false)
    expect(isSafeAgentId('a\\b')).toBe(false)
    expect(isSafeAgentId('a.b')).toBe(false)
    expect(isSafeAgentId('')).toBe(false)
    expect(isSafeAgentId('x'.repeat(129))).toBe(false)
  })

  it('management methods reject malformed agentId', async () => {
    const { presenter } = makePresenter(enabledConfig)
    expect(() => presenter.listMemories('../escape')).toThrow(/invalid agentId/)
    expect(() => presenter.getStatus('bad/id')).toThrow(/invalid agentId/)
    expect(() => presenter.listPersonaVersions('bad.id')).toThrow(/invalid agentId/)
    expect(() => presenter.rollbackPersona('bad id', 'v')).toThrow(/invalid agentId/)
    await expect(presenter.deleteMemory('bad/id', 'm')).rejects.toThrow(/invalid agentId/)
    await expect(presenter.clearMemories('bad/id')).rejects.toThrow(/invalid agentId/)
  })

  it('management methods no-op for unmanaged (nonexistent) agents', async () => {
    const repo = new FakeRepository()
    const store = new FakeVectorStore()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      isManagedAgent: (id) => id === 'real',
      getEmbeddings: async () => [],
      generateText: async () => '[]',
      createVectorStore: async () => store
    })
    // 内部写入路径（extraction）不受管理类守卫限制，使用受信任的 agentId
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'real' })

    // 格式合法但非真实 agent：读取为空、变更无效
    expect(presenter.listMemories('ghost')).toEqual([])
    expect(presenter.getStatus('ghost')).toEqual({
      total: 0,
      pendingEmbedding: 0,
      hasPersona: false
    })
    expect(await presenter.clearMemories('ghost')).toBe(0)
    expect(presenter.rollbackPersona('ghost', 'v')).toBe(false)

    // 真实 agent 正常工作
    expect(presenter.listMemories('real')).toHaveLength(1)
    expect(repo.countByAgent('real')).toBe(1)
  })
})

describe('writeMemoriesSync insert error classification (C2, AC-2.2)', () => {
  it('swallows UNIQUE constraint races as dedupe', () => {
    const repo = new FakeRepository()
    const uniqueError = Object.assign(
      new Error('UNIQUE constraint failed: agent_memory.provenance_key'),
      { code: 'SQLITE_CONSTRAINT_UNIQUE' }
    )
    vi.spyOn(repo, 'insert').mockImplementation(() => {
      throw uniqueError
    })
    const { presenter } = makePresenter(enabledConfig, repo)

    const created = presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], {
      agentId: 'a'
    })
    expect(created).toEqual([])
  })

  it('rethrows non-UNIQUE SQLite errors instead of silently dropping memories', () => {
    const repo = new FakeRepository()
    vi.spyOn(repo, 'insert').mockImplementation(() => {
      throw Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR' })
    })
    const { presenter } = makePresenter(enabledConfig, repo)

    expect(() =>
      presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    ).toThrow('disk I/O error')
  })

  it('extractAndStore degrades to ok:false on a real insert error (cursor must not advance)', async () => {
    const repo = new FakeRepository()
    vi.spyOn(repo, 'insert').mockImplementation(() => {
      throw Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR' })
    })
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true }),
      getEmbeddings: async () => [],
      generateText: async () => '[{"kind":"semantic","content":"likes redis","importance":0.9}]',
      createVectorStore: async () => new FakeVectorStore()
    })

    const result = await presenter.extractAndStore({
      agentId: 'a',
      spanText: 'User: I like redis',
      model: { providerId: 'p', modelId: 'm' }
    })
    expect(result.ok).toBe(false)
  })
})

describe('MemoryPresenter vector store identity (C5, AC-5.1/5.3)', () => {
  it('re-opens the per-agent sidecar under the new identity on model switch (AC-5.1)', async () => {
    const repo = new FakeRepository()
    let config: DeepChatAgentConfig = {
      memoryEnabled: true,
      memoryEmbedding: { providerId: 'p', modelId: 'm1' }
    }
    const createVectorStore = vi.fn(async () => new FakeVectorStore())
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [0.1, 0.2]),
      createVectorStore
    })

    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    expect(createVectorStore).toHaveBeenCalledTimes(1)

    await presenter.recall('a', 'redis')
    expect(createVectorStore).toHaveBeenCalledTimes(1)

    config = { memoryEnabled: true, memoryEmbedding: { providerId: 'p', modelId: 'm2' } }
    await presenter.recall('a', 'redis')
    expect(createVectorStore).toHaveBeenCalledTimes(2)
  })

  it('never queries an unusable vector store, falling back to FTS without errors (AC-5.3)', async () => {
    const repo = new FakeRepository()
    const query = vi.fn(async () => [])
    const unusableStore = { ...new FakeVectorStore(), isUsable: () => false, query }
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => enabledConfig,
      getEmbeddings: async (_p, _m, texts) => texts.map((text) => textToVector(text)),
      createVectorStore: async () => unusableStore
    })
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis fact' }], { agentId: 'a' })

    const results = await presenter.recall('a', 'redis')
    expect(query).not.toHaveBeenCalled()
    expect(results.some((item) => item.content === 'redis fact')).toBe(true)
  })
})

describe('MemoryPresenter dispose lifecycle (C4, AC-4.1)', () => {
  it('closes cached vector stores and is idempotent', async () => {
    const { presenter, store } = makePresenter(enabledConfig)
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'redis' }], { agentId: 'a' })
    await presenter.processPendingEmbeddings('a')
    const closeSpy = vi.spyOn(store, 'close')

    await presenter.dispose()
    expect(closeSpy).toHaveBeenCalledTimes(1)

    await presenter.dispose()
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })
})
