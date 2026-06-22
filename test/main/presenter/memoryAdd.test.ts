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
    expect(JSON.parse(event.input_refs_json)).toEqual({ kind: 'semantic', importance: 0.8 })
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
})
