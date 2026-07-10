import { describe, expect, it, vi } from 'vitest'

import { buildMemoryProvenanceKey } from '@/presenter/memoryPresenter/core/scoring'
import type { AgentMemoryRow } from '@/presenter/memoryPresenter/types'
import type { AgentMemoryCategory } from '@shared/types/agent-memory'
import { enabledConfig, FakeRepository, makePresenter } from './fakes/memoryFakes'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function insertMemory(
  repo: FakeRepository,
  input: {
    id: string
    content: string
    status?: AgentMemoryRow['status']
    category?: AgentMemoryCategory | null
    importance?: number
    provenanceKey?: string | null
    supersededBy?: string | null
    conflictState?: AgentMemoryRow['conflict_state']
    conflictWith?: string | null
  }
) {
  repo.insert({
    id: input.id,
    agentId: 'deepchat',
    kind: 'semantic',
    content: input.content,
    category: input.category ?? null,
    importance: input.importance ?? 0.5,
    status: input.status ?? 'embedded',
    provenanceKey: input.provenanceKey ?? null,
    conflictWith: input.conflictWith ?? null
  })
  if (input.supersededBy !== undefined) repo.markSuperseded(input.id, input.supersededBy)
  if (input.conflictState !== undefined) repo.markConflict(input.id, input.conflictState)
}

describe('MemoryPresenter.updateMemory', () => {
  it('sets metadata exactly and emits manual-edit without re-embedding', async () => {
    const onMemoryChanged = vi.fn()
    const { presenter, repo, auditRepo, getEmbeddings } = makePresenter(enabledConfig, undefined, {
      onMemoryChanged
    })
    insertMemory(repo, {
      id: 'm1',
      content: 'user likes redis',
      category: 'user_preference',
      importance: 0.9
    })

    const result = presenter.updateMemory('deepchat', 'm1', {
      category: null,
      importance: 0.2
    })

    expect(result).toEqual({ action: 'updated', memoryId: 'm1' })
    expect(repo.getById('m1')).toMatchObject({ category: null, importance: 0.2 })
    expect(getEmbeddings).not.toHaveBeenCalled()
    expect(auditRepo.listByAgent('deepchat', { eventType: 'memory/manual_edit' })).toHaveLength(1)
    expect(onMemoryChanged).toHaveBeenCalledWith('deepchat', 'manual-edit', { memoryId: 'm1' })
  })

  it('supersedes edited content and queues the new live row for embedding', async () => {
    const onMemoryChanged = vi.fn()
    const { presenter, repo, auditRepo, getEmbeddings } = makePresenter(enabledConfig, undefined, {
      onMemoryChanged
    })
    insertMemory(repo, {
      id: 'm1',
      content: 'user likes redis',
      category: 'user_preference',
      importance: 0.6
    })

    const result = presenter.updateMemory('deepchat', 'm1', {
      content: 'user likes valkey',
      category: 'project_fact',
      importance: 0.3
    })

    expect(result.action).toBe('superseded')
    expect(result.supersededId).toBe('m1')
    const next = repo.getById(result.memoryId!)
    expect(next).toMatchObject({
      content: 'user likes valkey',
      category: 'project_fact',
      importance: 0.3,
      status: 'pending_embedding'
    })
    expect(repo.getById('m1')?.superseded_by).toBe(result.memoryId)
    expect(auditRepo.listByAgent('deepchat', { eventType: 'memory/manual_edit' })).toHaveLength(1)
    expect(onMemoryChanged).toHaveBeenCalledWith('deepchat', 'manual-edit', {
      memoryId: result.memoryId
    })

    await tick()
    expect(getEmbeddings).toHaveBeenCalled()
  })

  it('updates normalized same-key content without creating a duplicate provenance owner', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const provenanceKey = buildMemoryProvenanceKey('deepchat', 'semantic', 'User likes Redis')
    insertMemory(repo, {
      id: 'm1',
      content: 'User likes Redis',
      category: 'user_preference',
      importance: 0.6,
      provenanceKey
    })

    const result = presenter.updateMemory('deepchat', 'm1', {
      content: 'User   likes Redis',
      category: 'project_fact',
      importance: 0.2
    })

    expect(result).toEqual({ action: 'updated', memoryId: 'm1' })
    expect(repo.getById('m1')).toMatchObject({
      content: 'User   likes Redis',
      category: 'project_fact',
      importance: 0.2,
      status: 'pending_embedding',
      provenance_key: provenanceKey,
      superseded_by: null
    })
    expect(repo.listByAgent('deepchat', { includeSuperseded: true })).toHaveLength(1)
  })

  it('returns an empty noop for blank content edits without mutating the row', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    insertMemory(repo, {
      id: 'm1',
      content: 'user likes redis',
      category: 'user_preference',
      importance: 0.6
    })

    expect(presenter.updateMemory('deepchat', 'm1', { content: '' })).toEqual({
      action: 'noop',
      reason: 'empty'
    })
    expect(presenter.updateMemory('deepchat', 'm1', { content: '   ' })).toEqual({
      action: 'noop',
      reason: 'empty'
    })
    expect(repo.getById('m1')).toMatchObject({
      content: 'user likes redis',
      category: 'user_preference',
      importance: 0.6
    })
  })

  it('folds into a live duplicate and applies exact metadata to the surviving row', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const duplicateKey = buildMemoryProvenanceKey('deepchat', 'semantic', 'user likes valkey')
    insertMemory(repo, {
      id: 'old',
      content: 'user likes redis',
      category: 'user_preference',
      importance: 0.8
    })
    insertMemory(repo, {
      id: 'owner',
      content: 'user likes valkey',
      category: 'project_fact',
      importance: 0.9,
      provenanceKey: duplicateKey
    })

    const result = presenter.updateMemory('deepchat', 'old', {
      content: 'user likes valkey',
      category: null,
      importance: 0.1
    })

    expect(result).toEqual({ action: 'folded', memoryId: 'owner', supersededId: 'old' })
    expect(repo.getById('old')?.superseded_by).toBe('owner')
    expect(repo.getById('owner')).toMatchObject({ category: null, importance: 0.1 })
    expect(repo.listByAgent('deepchat', { includeSuperseded: true }).map((row) => row.id)).toEqual([
      'old',
      'owner'
    ])
  })

  it('folds into a live duplicate without overwriting metadata fields the patch omitted', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const duplicateKey = buildMemoryProvenanceKey('deepchat', 'semantic', 'user likes valkey')
    insertMemory(repo, {
      id: 'owner',
      content: 'user likes valkey',
      category: 'project_fact',
      importance: 0.9,
      provenanceKey: duplicateKey
    })
    insertMemory(repo, {
      id: 'edited',
      content: 'user likes redis',
      category: 'user_preference',
      importance: 0.5
    })

    const result = presenter.updateMemory('deepchat', 'edited', {
      content: 'user likes valkey'
    })

    expect(result).toEqual({ action: 'folded', memoryId: 'owner', supersededId: 'edited' })
    expect(repo.getById('edited')?.superseded_by).toBe('owner')
    expect(repo.getById('owner')).toMatchObject({
      content: 'user likes valkey',
      category: 'project_fact',
      importance: 0.9
    })
  })

  it('refuses to fold a manual edit into an owner that is itself a conflict participant', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const duplicateKey = buildMemoryProvenanceKey('deepchat', 'semantic', 'user likes valkey')
    insertMemory(repo, {
      id: 'target',
      content: 'existing disputed fact',
      status: 'embedded',
      conflictState: 'challenged'
    })
    insertMemory(repo, {
      id: 'owner',
      content: 'user likes valkey',
      category: 'project_fact',
      importance: 0.9,
      status: 'conflicted',
      provenanceKey: duplicateKey,
      conflictWith: 'target'
    })
    insertMemory(repo, {
      id: 'edited',
      content: 'user likes redis',
      category: 'user_preference',
      importance: 0.5
    })

    const result = presenter.updateMemory('deepchat', 'edited', {
      content: 'user likes valkey'
    })

    expect(result).toEqual({ action: 'noop', reason: 'conflict' })
    expect(repo.getById('edited')).toMatchObject({
      content: 'user likes redis',
      superseded_by: null
    })
    expect(repo.getById('owner')).toMatchObject({
      content: 'user likes valkey',
      category: 'project_fact',
      importance: 0.9,
      superseded_by: null
    })
  })

  it('recovers from a concurrent-insert race with the same fold semantics as the primary path', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const duplicateKey = buildMemoryProvenanceKey('deepchat', 'semantic', 'user likes valkey')
    insertMemory(repo, {
      id: 'owner',
      content: 'user likes valkey',
      category: 'project_fact',
      importance: 0.9,
      provenanceKey: duplicateKey
    })
    insertMemory(repo, {
      id: 'edited',
      content: 'user likes redis',
      category: 'user_preference',
      importance: 0.5
    })

    // Simulate a concurrently-inserted owner: the primary provenance lookup misses it (pretends no
    // owner existed yet), so the code proceeds to insertMemory, which hits the real UNIQUE constraint
    // and falls back to the recovery branch's own lookup, which sees the real owner.
    const original = repo.getByProvenanceKey.bind(repo)
    const spy = vi
      .spyOn(repo, 'getByProvenanceKey')
      .mockImplementationOnce(() => undefined)
      .mockImplementation((agentId: string, key: string) => original(agentId, key))

    const result = presenter.updateMemory('deepchat', 'edited', {
      content: 'user likes valkey'
    })

    expect(result).toEqual({ action: 'folded', memoryId: 'owner', supersededId: 'edited' })
    expect(repo.getById('edited')?.superseded_by).toBe('owner')
    expect(repo.getById('owner')).toMatchObject({
      content: 'user likes valkey',
      category: 'project_fact',
      importance: 0.9
    })

    spy.mockRestore()
  })

  it('revives archived provenance owners instead of clearing their provenance key', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const duplicateKey = buildMemoryProvenanceKey('deepchat', 'semantic', 'archived fact')
    insertMemory(repo, {
      id: 'source',
      content: 'live fact',
      status: 'embedded'
    })
    insertMemory(repo, {
      id: 'archived-owner',
      content: 'archived fact',
      status: 'archived',
      provenanceKey: duplicateKey
    })

    const result = presenter.updateMemory('deepchat', 'source', {
      content: 'archived fact'
    })

    expect(result.action).toBe('superseded')
    expect(result.supersededId).toBe('source')
    expect(result.memoryId).toBe('archived-owner')
    expect(repo.getById('source')?.superseded_by).toBe('archived-owner')
    expect(repo.getById('archived-owner')).toMatchObject({
      status: 'pending_embedding',
      superseded_by: null,
      content: 'archived fact',
      provenance_key: duplicateKey
    })
  })

  it('rejects manual edits for active conflict participants', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    insertMemory(repo, {
      id: 'target',
      content: 'existing disputed fact',
      status: 'embedded',
      conflictState: 'challenged'
    })
    insertMemory(repo, {
      id: 'challenger',
      content: 'new disputed fact',
      status: 'conflicted',
      conflictWith: 'target'
    })

    expect(
      presenter.updateMemory('deepchat', 'target', {
        content: 'edited target'
      })
    ).toEqual({ action: 'noop', reason: 'conflict' })
    expect(
      presenter.updateMemory('deepchat', 'challenger', {
        content: 'edited challenger'
      })
    ).toEqual({ action: 'noop', reason: 'conflict' })
    expect(repo.getById('target')).toMatchObject({
      content: 'existing disputed fact',
      conflict_state: 'challenged',
      superseded_by: null
    })
    expect(repo.getById('challenger')).toMatchObject({
      content: 'new disputed fact',
      status: 'conflicted',
      conflict_with: 'target'
    })
  })

  it('counts visible active and archived memories without superseded, persona, working, or conflicted rows', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    insertMemory(repo, { id: 'active', content: 'active row', status: 'embedded' })
    insertMemory(repo, { id: 'archived', content: 'archived row', status: 'archived' })
    insertMemory(repo, { id: 'superseded', content: 'old row', supersededBy: 'active' })
    repo.insert({
      id: 'persona',
      agentId: 'deepchat',
      kind: 'persona',
      content: 'self model',
      status: 'fts_only',
      personaState: 'active'
    })
    repo.insert({
      id: 'persona-draft',
      agentId: 'deepchat',
      kind: 'persona',
      content: 'draft self model',
      status: 'fts_only',
      personaState: 'draft'
    })
    repo.insert({
      id: 'persona-rejected',
      agentId: 'deepchat',
      kind: 'persona',
      content: 'rejected self model',
      status: 'fts_only',
      personaState: 'rejected'
    })
    repo.insert({
      id: 'persona-superseded',
      agentId: 'deepchat',
      kind: 'persona',
      content: 'old self model',
      status: 'fts_only',
      personaState: 'superseded'
    })
    repo.insert({
      id: 'working',
      agentId: 'deepchat',
      kind: 'working',
      content: 'working row',
      status: 'fts_only'
    })
    insertMemory(repo, { id: 'conflicted', content: 'conflicted row', status: 'conflicted' })

    const status = presenter.getStatus('deepchat')

    expect(status.activeMemoryCount).toBe(1)
    expect(status.archivedMemoryCount).toBe(1)
    expect(status.total).toBe(1)
    expect(status.personaDraftCount).toBe(1)
    expect(status.personaVersionCount).toBe(2)
  })
})
