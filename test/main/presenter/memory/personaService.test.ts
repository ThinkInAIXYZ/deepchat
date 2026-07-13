import { describe, expect, it, vi } from 'vitest'

import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import {
  createFakeRepository,
  enabledConfig,
  FakeVectorStore,
  makePresenter,
  type FakeRepository
} from '../fakes/memoryFakes'

import { MemoryPresenter } from './serviceTestSupport'

describe('MemoryPresenter guarded persona evolution', () => {
  it('evolvePersona writes a draft that is not active and not injected', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const draft = presenter.evolvePersona('a', 'a draft self-model', null)
    expect(repo.getById(draft!)?.persona_state).toBe('draft')
    expect(repo.getActivePersona('a')).toBeUndefined()
    const payload = await presenter.buildInjection('a', 'anything')
    expect(payload?.payload.selfModel ?? null).toBeNull()
  })

  it('evolvePersona refuses unmanaged or disabled agents', () => {
    const unmanagedRepo = createFakeRepository()
    const unmanagedPresenter = new MemoryPresenter({
      repository: unmanagedRepo,
      resolveAgentConfig: () => enabledConfig,
      isManagedAgent: () => false,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [1, 0, 0, 0]),
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => {}
    })
    expect(unmanagedPresenter.evolvePersona('a', 'draft', null)).toBeNull()
    expect(unmanagedRepo.listPersonaVersions('a')).toHaveLength(0)

    const disabledRepo = createFakeRepository()
    const disabledPresenter = new MemoryPresenter({
      repository: disabledRepo,
      resolveAgentConfig: () => ({ memoryEnabled: false, personaEvolutionEnabled: true }),
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [1, 0, 0, 0]),
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => {}
    })
    expect(disabledPresenter.evolvePersona('a', 'draft', null)).toBeNull()
    expect(disabledRepo.listPersonaVersions('a')).toHaveLength(0)
  })

  it('approve promotes the draft to active and supersedes the previous active', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    await presenter.approvePersonaDraft('a', v1!)
    const v2 = presenter.evolvePersona('a', 'v2', null)
    // The pending draft is not yet injected.
    expect((await presenter.buildInjection('a', 'q'))?.payload.selfModel).toBe('v1')
    await presenter.approvePersonaDraft('a', v2!)
    expect(repo.getById(v1!)?.superseded_by).toBe(v2)
    expect(repo.getById(v1!)?.persona_state).toBe('superseded')
    expect(repo.getActivePersona('a')?.id).toBe(v2)
    expect((await presenter.buildInjection('a', 'q'))?.payload.selfModel).toBe('v2')
  })

  it('reject discards the draft and leaves the active persona unchanged', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    await presenter.approvePersonaDraft('a', v1!)
    const draft = presenter.evolvePersona('a', 'unwanted', null)
    expect(await presenter.rejectPersonaDraft('a', draft!)).toBe(true)
    expect(repo.getById(draft!)?.persona_state).toBe('rejected')
    expect(presenter.listPersonaDrafts('a')).toHaveLength(0)
    expect(repo.getActivePersona('a')?.content).toBe('v1')
  })

  it('approving anchored active still replaces it (explicit user action)', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    await presenter.approvePersonaDraft('a', v1!)
    expect(await presenter.setPersonaAnchor('a', v1!, true)).toBe(true)
    expect(repo.getById(v1!)?.is_anchor).toBe(1)
    const v2 = presenter.evolvePersona('a', 'v2', null)
    await presenter.approvePersonaDraft('a', v2!)
    expect(repo.getActivePersona('a')?.id).toBe(v2)
    // The anchored predecessor is superseded, never left as a second active row (single-active invariant).
    expect(repo.getById(v1!)?.persona_state).toBe('superseded')
    expect(
      repo.listPersonaVersions('a').filter((row) => row.persona_state === 'active')
    ).toHaveLength(1)
  })

  it('rollback refuses while the current active is anchored', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    await presenter.approvePersonaDraft('a', v1!)
    const v2 = presenter.evolvePersona('a', 'v2', null)
    await presenter.approvePersonaDraft('a', v2!)
    await presenter.setPersonaAnchor('a', v2!, true)
    expect(await presenter.rollbackPersona('a', v1!)).toBe(false)
    expect(repo.getActivePersona('a')?.id).toBe(v2)
    expect(repo.getById(v2!)?.superseded_by).toBeNull()
  })

  it('rollback re-activates a historical version when not anchored', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const v1 = presenter.evolvePersona('a', 'v1', null)
    await presenter.approvePersonaDraft('a', v1!)
    const v2 = presenter.evolvePersona('a', 'v2', null)
    await presenter.approvePersonaDraft('a', v2!)
    expect(await presenter.rollbackPersona('a', v1!)).toBe(true)
    expect(repo.getActivePersona('a')?.id).toBe(v1)
    expect(repo.getById(v2!)?.superseded_by).toBe(v1)
  })

  it('rollback refuses a pending draft so an unapproved self-model cannot be activated', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const active = presenter.evolvePersona('a', 'approved', null)
    await presenter.approvePersonaDraft('a', active!)
    const draft = presenter.evolvePersona('a', 'unapproved draft', null)
    expect(repo.getById(draft!)?.persona_state).toBe('draft')
    expect(await presenter.rollbackPersona('a', draft!)).toBe(false)
    expect(repo.getById(draft!)?.persona_state).toBe('draft')
    expect(repo.getActivePersona('a')?.id).toBe(active)
  })

  it('rollback refuses a rejected version so a discarded self-model can never return', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    const active = presenter.evolvePersona('a', 'approved', null)
    await presenter.approvePersonaDraft('a', active!)
    const draft = presenter.evolvePersona('a', 'rejected draft', null)
    await presenter.rejectPersonaDraft('a', draft!)
    expect(repo.getById(draft!)?.persona_state).toBe('rejected')
    expect(await presenter.rollbackPersona('a', draft!)).toBe(false)
    expect(repo.getById(draft!)?.persona_state).toBe('rejected')
    expect(repo.getActivePersona('a')?.id).toBe(active)
  })

  it('legacy persona rows (persona_state NULL) are interpreted by superseded_by', () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'old-active',
      agentId: 'a',
      kind: 'persona',
      content: 'old',
      createdAt: 10
    })
    repo.insert({
      id: 'old-super',
      agentId: 'a',
      kind: 'persona',
      content: 'older',
      createdAt: 20
    })
    repo.markSuperseded('old-super', 'old-active')
    expect(presenter.getStatus('a').hasPersona).toBe(true)
    expect(repo.getActivePersona('a')?.id).toBe('old-active')
  })
})

describe('MemoryPresenter.maybeEvolvePersona (guarded, default off)', () => {
  const model = { providerId: 'p', modelId: 'm' }
  const seedUnits = (repo: FakeRepository, agentId: string, n: number, from = 2000): void => {
    for (let i = 0; i < n; i += 1) {
      repo.insert({
        id: `u-${agentId}-${i}`,
        agentId,
        kind: 'semantic',
        content: `durable fact number ${i}`,
        importance: 1,
        status: 'embedded',
        createdAt: from + i
      })
    }
  }
  const personaLLM = (text: string): ReturnType<typeof vi.fn> =>
    vi.fn(async (_p: string, _m: string, prompt: string) =>
      prompt.includes('stable self-model') ? text : ''
    )
  const makePersona = (config: DeepChatAgentConfig, generateText: ReturnType<typeof vi.fn>) => {
    const repo = createFakeRepository()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => config,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [1, 0, 0, 0]),
      generateText,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => {}
    })
    return { presenter, repo, generateText }
  }

  it('produces no draft and never calls the model when the flag is off (default)', async () => {
    const generateText = personaLLM('I am concise.')
    const { presenter, repo } = makePersona({ memoryEnabled: true }, generateText)
    seedUnits(repo, 'a', 6)
    expect(await presenter.maybeEvolvePersona('a', model)).toBeNull()
    expect(generateText).not.toHaveBeenCalled()
    expect(presenter.listPersonaDrafts('a')).toHaveLength(0)
  })

  it('stays off while memory stays on (decoupled switches)', async () => {
    const generateText = personaLLM('I am concise.')
    const { presenter, repo } = makePersona(
      { memoryEnabled: true, personaEvolutionEnabled: false },
      generateText
    )
    seedUnits(repo, 'a', 6)
    expect(await presenter.maybeEvolvePersona('a', model)).toBeNull()
    // Memory recall still works with the flag off.
    expect((await presenter.recall('a', 'durable fact')).length).toBeGreaterThan(0)
  })

  it('writes a draft once enough importance accumulates; the draft is not injected', async () => {
    const generateText = personaLLM('I am concise and technical.')
    const { presenter, repo } = makePersona(
      { memoryEnabled: true, personaEvolutionEnabled: true },
      generateText
    )
    seedUnits(repo, 'a', 6)
    const result = await presenter.maybeEvolvePersona('a', model)
    expect(result?.draftId).toBeTruthy()
    expect(result?.needsReview).toBe(false)
    expect(repo.getById(result!.draftId)?.persona_state).toBe('draft')
    expect(repo.getActivePersona('a')).toBeUndefined()
    expect((await presenter.buildInjection('a', 'q'))?.payload.selfModel ?? null).toBeNull()
  })

  it('does not write a draft when the agent is deleted during persona generation', async () => {
    let managed = true
    let resolveText!: (value: string) => void
    const generateText = vi.fn(
      async () =>
        new Promise<string>((resolve) => {
          resolveText = resolve
        })
    )
    const repo = createFakeRepository()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true, personaEvolutionEnabled: true }),
      isManagedAgent: () => managed,
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [1, 0, 0, 0]),
      generateText,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => {}
    })
    seedUnits(repo, 'a', 6)

    const pending = presenter.maybeEvolvePersona('a', model)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(generateText).toHaveBeenCalledTimes(1)

    managed = false
    resolveText('I am concise and technical.')

    expect(await pending).toBeNull()
    expect(repo.listPersonaVersions('a')).toHaveLength(0)
  })

  it('does not write a draft when memories are cleared during persona generation', async () => {
    let resolveText!: (value: string) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const generateText = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveText = resolve
          markStarted()
        })
    )
    const repo = createFakeRepository()
    const presenter = new MemoryPresenter({
      repository: repo,
      resolveAgentConfig: () => ({ memoryEnabled: true, personaEvolutionEnabled: true }),
      getEmbeddings: async (_p, _m, texts) => texts.map(() => [1, 0, 0, 0]),
      generateText,
      createVectorStore: async () => new FakeVectorStore(),
      resetVectorStore: async () => undefined
    })
    seedUnits(repo, 'a', 6)

    const pending = presenter.maybeEvolvePersona('a', model)
    await started
    expect(await presenter.clearMemories('a')).toBe(6)
    resolveText('I am concise and technical.')

    await expect(pending).resolves.toBeNull()
    expect(repo.countByAgent('a')).toBe(0)
  })

  it('flags needsReview when the draft drifts far from the active self-model', async () => {
    const generateText = personaLLM(
      'I am a wholly different self-model that bears no resemblance to before.'
    )
    const { presenter, repo } = makePersona(
      { memoryEnabled: true, personaEvolutionEnabled: true },
      generateText
    )
    const v1 = presenter.evolvePersona('a', 'short', null)
    await presenter.approvePersonaDraft('a', v1!)
    seedUnits(repo, 'a', 6, 3000)
    const result = await presenter.maybeEvolvePersona('a', model)
    expect(result?.needsReview).toBe(true)
  })

  it('keeps at most one outstanding draft and serializes concurrent passes', async () => {
    const generateText = personaLLM('I am concise.')
    const { presenter, repo } = makePersona(
      { memoryEnabled: true, personaEvolutionEnabled: true },
      generateText
    )
    seedUnits(repo, 'a', 6)
    const [first, second] = await Promise.all([
      presenter.maybeEvolvePersona('a', model),
      presenter.maybeEvolvePersona('a', model)
    ])
    const produced = [first, second].filter(Boolean)
    expect(produced).toHaveLength(1)
    expect(presenter.listPersonaDrafts('a')).toHaveLength(1)
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite an active self-model and never injects an unapproved draft (no silent drift)', async () => {
    const generateText = personaLLM('I am a freshly distilled self-model.')
    const { presenter, repo } = makePersona(
      { memoryEnabled: true, personaEvolutionEnabled: true },
      generateText
    )
    const v1 = presenter.evolvePersona('a', 'approved self-model', null)
    await presenter.approvePersonaDraft('a', v1!)
    seedUnits(repo, 'a', 6, 3000)
    await presenter.maybeEvolvePersona('a', model)
    // The active persona text is unchanged until the new draft is explicitly approved.
    expect((await presenter.buildInjection('a', 'q'))?.payload.selfModel).toBe(
      'approved self-model'
    )
    expect(repo.getActivePersona('a')?.content).toBe('approved self-model')
  })
})
