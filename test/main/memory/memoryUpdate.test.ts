import { describe, expect, it, vi } from 'vitest'

import { buildMemoryProvenanceKey } from '@/memory/core/scoring'
import type { AgentMemoryRow, MemoryTemporalMetadata } from '@/memory/domain/types'
import {
  AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS,
  type AgentMemoryCategory
} from '@shared/types/agent-memory'
import { enabledConfig, makePresenter, type FakeRepository } from './support/memoryFakes'

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
    conflictState?: 'challenged' | null
    conflictWith?: string | null
    temporal?: MemoryTemporalMetadata
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
    conflictWith: input.conflictWith ?? null,
    temporal: input.temporal
  })
  if (input.supersededBy !== undefined) repo.seedSupersededBy(input.id, input.supersededBy)
  if (input.conflictState !== undefined) repo.seedConflictState(input.id, input.conflictState)
}

describe('MemoryService.updateMemory', () => {
  it('rejects oversized content without mutating or auditing the row', () => {
    const { presenter, repo, auditRepo, getEmbeddings } = makePresenter(enabledConfig)
    insertMemory(repo, {
      id: 'm1',
      content: 'user likes redis',
      category: 'user_preference',
      importance: 0.6
    })

    expect(
      presenter.updateMemory('deepchat', 'm1', {
        content: 'x'.repeat(AGENT_MEMORY_MANUAL_CONTENT_MAX_CHARS + 1)
      })
    ).toEqual({ action: 'noop', reason: 'content-too-large' })
    expect(repo.getById('m1')?.content).toBe('user likes redis')
    expect(auditRepo.listByAgent('deepchat')).toHaveLength(0)
    expect(getEmbeddings).not.toHaveBeenCalled()
  })

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
    expect(repo.listDerivationsByChild('deepchat', 'm1')).toEqual([])
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
    expect(repo.listDerivationsByChild('deepchat', result.memoryId!)).toEqual([
      expect.objectContaining({
        parent_memory_id: 'm1',
        child_memory_id: result.memoryId,
        derivation_kind: 'manual_edit'
      })
    ])
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
    expect(repo.listDerivationsByChild('deepchat', 'm1')).toEqual([])
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
    expect(repo.listDerivationsByChild('deepchat', 'owner')).toEqual([
      expect.objectContaining({
        parent_memory_id: 'old',
        child_memory_id: 'owner',
        derivation_kind: 'manual_edit'
      })
    ])
    expect(repo.listByAgent('deepchat', { includeSuperseded: true }).map((row) => row.id)).toEqual([
      'old',
      'owner'
    ])
  })

  it('records an in-place metadata edit in audit without synthesizing lineage', () => {
    const { presenter, repo, auditRepo } = makePresenter(enabledConfig)
    insertMemory(repo, {
      id: 'm1',
      content: 'user likes redis',
      category: 'user_preference',
      importance: 0.6
    })

    expect(
      presenter.updateMemory('deepchat', 'm1', {
        category: 'project_fact',
        importance: 0.2
      })
    ).toEqual({ action: 'updated', memoryId: 'm1' })

    expect(repo.getById('m1')).toMatchObject({
      category: 'project_fact',
      importance: 0.2
    })
    expect(repo.listDerivationsByChild('deepchat', 'm1')).toEqual([])
    expect(auditRepo.listByAgent('deepchat', { eventType: 'memory/manual_edit' })).toHaveLength(1)
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
      importance: 0.5,
      temporal: {
        temporalKind: 'state',
        validFrom: 100,
        validUntil: 200,
        temporalConfidence: 0.8,
        temporalPrecision: 'exact',
        temporalTimeZone: 'UTC'
      }
    })

    const result = presenter.updateMemory('deepchat', 'edited', {
      content: 'user likes valkey'
    })

    expect(result).toEqual({ action: 'folded', memoryId: 'owner', supersededId: 'edited' })
    expect(repo.getById('edited')?.superseded_by).toBe('owner')
    expect(repo.getById('owner')).toMatchObject({
      content: 'user likes valkey',
      category: 'project_fact',
      importance: 0.9,
      temporal_kind: 'state',
      valid_from: 100,
      valid_until: 200,
      temporal_confidence: 0.8
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

  it('does not let a manual edit recreate a hard-deleted claim', async () => {
    const { presenter, repo, auditRepo } = makePresenter(enabledConfig)
    const [forgottenId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'Project Saffron uses Rust.' }],
      { agentId: 'deepchat' }
    )
    await expect(presenter.deleteMemory('deepchat', forgottenId)).resolves.toEqual({
      action: 'applied'
    })
    insertMemory(repo, { id: 'editable', content: 'Project Saffron uses Go.' })

    expect(
      presenter.updateMemory('deepchat', 'editable', {
        content: ' Project   Saffron uses Rust. '
      })
    ).toEqual({ action: 'noop', reason: 'forgotten' })
    expect(repo.getById('editable')).toMatchObject({
      content: 'Project Saffron uses Go.',
      superseded_by: null
    })
    expect(auditRepo.listByAgent('deepchat', { eventType: 'memory/manual_edit' })).toHaveLength(0)
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

  it('records every retired parent when an edit revives a superseded owner', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const ownerKey = buildMemoryProvenanceKey('deepchat', 'semantic', 'original fact')
    insertMemory(repo, {
      id: 'owner',
      content: 'original fact',
      provenanceKey: ownerKey,
      supersededBy: 'current-head'
    })
    insertMemory(repo, {
      id: 'current-head',
      content: 'replacement fact'
    })
    insertMemory(repo, {
      id: 'edited',
      content: 'unrelated fact'
    })

    expect(presenter.updateMemory('deepchat', 'edited', { content: 'original fact' })).toEqual({
      action: 'superseded',
      memoryId: 'owner',
      supersededId: 'edited'
    })

    expect(repo.getById('current-head')?.superseded_by).toBe('owner')
    expect(repo.getById('edited')?.superseded_by).toBe('owner')
    expect(repo.listDerivationsByChild('deepchat', 'owner')).toEqual([
      expect.objectContaining({
        parent_memory_id: 'current-head',
        derivation_kind: 'supersede'
      }),
      expect.objectContaining({
        parent_memory_id: 'edited',
        derivation_kind: 'manual_edit'
      })
    ])
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
