import { describe, expect, it, vi } from 'vitest'

import { MemoryPresenter } from '@/presenter/memoryPresenter'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import {
  FakeAuditRepository,
  FakeRepository,
  FakeVectorStore,
  enabledConfig,
  makePresenter,
  textToVector
} from './fakes/memoryFakes'

const extractionConfig: DeepChatAgentConfig = {
  memoryEnabled: true,
  memoryEmbedding: { providerId: 'p', modelId: 'm' },
  memoryExtractionModel: { providerId: 'cheap', modelId: 'cheap' }
}

function makeLLM(decision: string, config = extractionConfig) {
  const repo = new FakeRepository()
  const auditRepo = new FakeAuditRepository()
  const store = new FakeVectorStore()
  const generateText = vi.fn(async (_p: string, _m: string, prompt: string) => {
    if (prompt.includes('Choose exactly ONE decision')) return decision
    return ''
  })
  const presenter = new MemoryPresenter({
    repository: repo,
    auditRepository: auditRepo,
    resolveAgentConfig: () => config,
    getEmbeddings: vi.fn(async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text))
    ),
    getDimensions: vi.fn(async () => ({
      data: { dimensions: textToVector('').length, normalized: false }
    })),
    generateText,
    createVectorStore: async () => store,
    resetVectorStore: async () => {
      store.vectors.clear()
    }
  })
  return { presenter, repo, auditRepo, generateText }
}

describe('MemoryPresenter.addUserMemory (manual user write)', () => {
  it('directly adds when no extraction model is configured and audits the user write', async () => {
    const { presenter, repo, auditRepo } = makePresenter(enabledConfig)

    const outcome = await presenter.addUserMemory('deepchat', {
      content: 'the user keeps pineapple notes',
      importance: 0.8
    })

    expect(outcome.action).toBe('created')
    const memoryId = outcome.action === 'created' ? outcome.id : ''
    expect(repo.listByAgent('deepchat').some((row) => row.id === memoryId)).toBe(true)

    const events = auditRepo.listByAgent('deepchat', { eventType: 'memory/add' })
    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event.actor_type).toBe('user')
    expect(event.status).toBe('completed')
    expect(JSON.parse(event.input_refs_json)).toEqual({
      kind: 'semantic',
      category: null,
      importance: 0.8
    })
    expect(JSON.parse(event.output_refs_json)).toEqual({ action: 'created', memoryId })
    // Direct-add path has no extraction model, so the audit records no model context.
    expect(event.model_provider_id).toBeNull()
    expect(event.model_id).toBeNull()
  })

  it('defaults kind to semantic and never stores raw content in audit refs', async () => {
    const { presenter, auditRepo } = makePresenter(enabledConfig)

    await presenter.addUserMemory('deepchat', { content: 'pineapple belongs on pizza' })

    const event = auditRepo.listByAgent('deepchat', { eventType: 'memory/add' })[0]
    expect(JSON.parse(event.input_refs_json).kind).toBe('semantic')
    expect(JSON.parse(event.input_refs_json).category).toBeNull()
    expect(JSON.parse(event.input_refs_json).importance).toBeNull()
    const refsBlob = `${event.input_refs_json}${event.output_refs_json}`
    expect(refsBlob).not.toContain('pineapple')
  })

  it('audits an exact duplicate as a skipped no-op without creating a second row', async () => {
    const { presenter, repo, auditRepo } = makePresenter(enabledConfig)

    await presenter.addUserMemory('deepchat', { content: 'redis listens on 6379' })
    const afterFirst = repo.listByAgent('deepchat').length

    const outcome = await presenter.addUserMemory('deepchat', { content: 'redis listens on 6379' })

    expect(outcome.action).toBe('noop')
    expect(repo.listByAgent('deepchat').length).toBe(afterFirst)
    const events = auditRepo.listByAgent('deepchat', { eventType: 'memory/add' })
    expect(events).toHaveLength(2)
    const skipped = events.find((event) => event.status === 'skipped')
    expect(skipped).toBeDefined()
    expect(JSON.parse(skipped!.output_refs_json).action).toBe('noop')
  })

  it('routes through the decision ring when an extraction model is configured', async () => {
    const { presenter, repo, auditRepo, generateText } = makeLLM(
      '{"decision":"UPDATE","targetIndex":0,"mergedContent":"the user prefers redis and memcached"}'
    )
    repo.insert({
      id: 'n1',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'the user prefers redis as their primary cache',
      status: 'embedded',
      importance: 0.6
    })

    const outcome = await presenter.addUserMemory('deepchat', {
      content: 'the user prefers redis'
    })

    expect(generateText).toHaveBeenCalled()
    expect(outcome.action).toBe('updated')
    const event = auditRepo.listByAgent('deepchat', { eventType: 'memory/add' })[0]
    expect(event.actor_type).toBe('user')
    expect(event.status).toBe('completed')
    expect(JSON.parse(event.output_refs_json).action).toBe('updated')
    // The decision-ring audit records which extraction model made the call.
    expect(event.model_provider_id).toBe('cheap')
    expect(event.model_id).toBe('cheap')
  })

  it('grants no recall exemption: a manually added memory is recalled like any other', async () => {
    const { presenter } = makePresenter(enabledConfig)

    await presenter.addUserMemory('deepchat', { content: 'the user prefers redis' })
    const recalled = await presenter.recall('deepchat', 'redis')

    expect(recalled.some((item) => item.content === 'the user prefers redis')).toBe(true)
  })

  it('normalizes valid categories, derives kind, and applies category importance floors', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)

    await presenter.addUserMemory('deepchat', {
      content: 'repo uses pnpm workspaces',
      kind: 'episodic',
      category: 'project_fact',
      importance: 0.1
    })
    await presenter.addUserMemory('deepchat', {
      content: 'PR-2 memory category contract landed',
      category: 'task_outcome',
      importance: 0.1
    })

    const projectFact = repo.listByAgent('deepchat').find((row) => row.content.includes('pnpm'))
    const outcome = repo.listByAgent('deepchat').find((row) => row.content.includes('PR-2'))
    expect(projectFact).toMatchObject({
      kind: 'semantic',
      category: 'project_fact',
      importance: 0.6
    })
    expect(outcome).toMatchObject({
      kind: 'episodic',
      category: 'task_outcome',
      importance: 0.55
    })
  })

  it('keeps legacy kind without category and degrades invalid categories to semantic null', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)

    await presenter.addUserMemory('deepchat', {
      content: 'legacy episodic memory',
      kind: 'episodic',
      importance: 0.7
    })
    await presenter.addUserMemory('deepchat', {
      content: 'invalid category memory',
      kind: 'episodic',
      category: 'unknown',
      importance: 2
    })

    expect(
      repo.listByAgent('deepchat').find((row) => row.content === 'legacy episodic memory')
    ).toMatchObject({
      kind: 'episodic',
      category: null,
      importance: 0.7
    })
    expect(
      repo.listByAgent('deepchat').find((row) => row.content === 'invalid category memory')
    ).toMatchObject({
      kind: 'semantic',
      category: null,
      importance: 1
    })
  })

  it('absorbs candidate category on UPDATE only when the target category is null', async () => {
    const { presenter, repo } = makeLLM(
      '{"decision":"UPDATE","targetIndex":0,"mergedContent":"the user prefers redis and valkey"}'
    )
    repo.insert({
      id: 'target-null',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'the user prefers redis as primary cache',
      status: 'embedded'
    })

    const absorbed = await presenter.addUserMemory('deepchat', {
      content: 'the user prefers redis',
      category: 'user_preference'
    })

    expect(absorbed.action).toBe('updated')
    expect(repo.getById('target-null')?.category).toBe('user_preference')
  })

  it('preserves existing target category on UPDATE', async () => {
    const { presenter, repo } = makeLLM(
      '{"decision":"UPDATE","targetIndex":0,"mergedContent":"repo uses redis and valkey"}'
    )
    repo.insert({
      id: 'target-project',
      agentId: 'deepchat',
      kind: 'semantic',
      category: 'project_fact',
      content: 'repo uses redis as cache',
      status: 'embedded'
    })

    const outcome = await presenter.addUserMemory('deepchat', {
      content: 'repo uses redis',
      category: 'user_preference'
    })

    expect(outcome.action).toBe('updated')
    expect(repo.getById('target-project')?.category).toBe('project_fact')
  })

  it('carries candidate category into SUPERSEDE and CHALLENGE rows', async () => {
    const supersede = makeLLM(
      '{"decision":"SUPERSEDE","targetIndex":0,"mergedContent":"redis is an anti-pattern here"}'
    )
    supersede.repo.insert({
      id: 'old',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'redis target',
      status: 'embedded'
    })

    const supersedeOutcome = await supersede.presenter.addUserMemory('deepchat', {
      content: 'redis',
      category: 'anti_pattern'
    })

    expect(supersedeOutcome.action).toBe('superseded')
    const supersedeId = supersedeOutcome.action === 'superseded' ? supersedeOutcome.id : ''
    expect(supersede.repo.getById(supersedeId)).toMatchObject({
      kind: 'semantic',
      category: 'anti_pattern'
    })

    const challenge = makeLLM('{"decision":"CHALLENGE","targetIndex":0,"mergedContent":null}')
    challenge.repo.insert({
      id: 'target',
      agentId: 'deepchat',
      kind: 'semantic',
      content: 'redis target',
      status: 'embedded'
    })

    const challengeOutcome = await challenge.presenter.addUserMemory('deepchat', {
      content: 'redis',
      category: 'anti_pattern'
    })

    expect(challengeOutcome.action).toBe('challenged')
    const challengerId =
      challengeOutcome.action === 'challenged' ? challengeOutcome.challengerId : ''
    expect(challenge.repo.getById(challengerId)).toMatchObject({
      status: 'conflicted',
      category: 'anti_pattern'
    })
  })

  it('normalizes writeMemoriesSync before provenance key generation', () => {
    const { presenter, repo } = makePresenter(enabledConfig)

    const first = presenter.writeMemoriesSync(
      [{ content: 'invalid category should use semantic key', kind: 'episodic', category: 'bad' }],
      { agentId: 'deepchat' }
    )
    const second = presenter.writeMemoriesSync(
      [{ content: 'invalid category should use semantic key', kind: 'semantic' }],
      { agentId: 'deepchat' }
    )

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
    expect(repo.listByAgent('deepchat')).toHaveLength(1)
    expect(repo.listByAgent('deepchat')[0]).toMatchObject({ kind: 'semantic', category: null })
  })
})
