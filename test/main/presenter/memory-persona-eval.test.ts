import { describe, expect, it, vi } from 'vitest'

import { MemoryPresenter } from '@/presenter/memoryPresenter'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import { FakeRepository, FakeVectorStore, textToVector } from './fakes/memoryFakes'

// Offline persona-evolution eval probes (US-6). Deterministic: a stub model stands in for the
// distillation call and a keyword-vector stub for embeddings, so the guarded loop
// (evolve -> draft -> approve -> inject) is reproducible with no real services. These guard the two
// release-gate contracts before the experimental flag is ever recommended on:
//   AC-6.1 cross-session self-model consistency + preference recall surviving evolution;
//   AC-6.2 no drift of the active self-model without an explicit approval.
// Runtime injection-seam coverage (resume / recovery) is owned by the stabilization injection
// unification; here the contract is exercised at the presenter's single buildInjection source.

const MODEL = { providerId: 'p', modelId: 'm' }
const PERSONA_ON: DeepChatAgentConfig = {
  memoryEnabled: true,
  personaEvolutionEnabled: true,
  memoryEmbedding: { providerId: 'p', modelId: 'm' }
}

function makeAgent(generateText: ReturnType<typeof vi.fn>) {
  const repo = new FakeRepository()
  const presenter = new MemoryPresenter({
    repository: repo,
    resolveAgentConfig: () => PERSONA_ON,
    getEmbeddings: async (_p: string, _m: string, texts: string[]) =>
      texts.map((text) => textToVector(text)),
    getDimensions: async () => ({
      data: { dimensions: textToVector('').length, normalized: false }
    }),
    generateText,
    createVectorStore: async () => new FakeVectorStore(),
    resetVectorStore: async () => {}
  })
  return { presenter, repo }
}

// The distiller answers with `text` only for the persona-evolution prompt (keyed off its stable
// marker), so an unrelated model call can never accidentally satisfy it.
function distiller(text: string): ReturnType<typeof vi.fn> {
  return vi.fn(async (_p: string, _m: string, prompt: string) =>
    prompt.includes('stable self-model') ? text : ''
  )
}

function seedUnits(repo: FakeRepository, agentId: string, n: number, from = 2000): void {
  for (let i = 0; i < n; i += 1) {
    repo.insert({
      id: `u-${agentId}-${i}-${from}`,
      agentId,
      kind: 'semantic',
      content: `durable fact number ${i}`,
      importance: 1,
      status: 'embedded',
      createdAt: from + i
    })
  }
}

describe('persona evolution eval probes (US-6)', () => {
  it('AC-6.1 injects the approved self-model identically across separate recall calls', async () => {
    const { presenter, repo } = makeAgent(distiller('I am concise, direct, and technical.'))
    seedUnits(repo, 'a', 6)

    const draft = await presenter.maybeEvolvePersona('a', MODEL)
    expect(draft).not.toBeNull()
    expect(await presenter.approvePersonaDraft('a', draft!.draftId)).toBe(true)

    // Two independent injections (distinct queries ~ distinct sessions) must read the same active
    // version — the version the user approved, never a stale or draft one.
    const sessionA = await presenter.buildInjection('a', 'first question')
    const sessionB = await presenter.buildInjection('a', 'an unrelated question much later')
    expect(sessionA?.selfModel).toBe('I am concise, direct, and technical.')
    expect(sessionB?.selfModel).toBe(sessionA?.selfModel)
    expect(repo.getActivePersona('a')?.content).toBe(sessionB?.selfModel)
  })

  it('AC-6.1 keeps preference memories recallable after the persona evolves', async () => {
    const { presenter, repo } = makeAgent(distiller('I default to redis-backed caching advice.'))
    // A durable preference the user stated earlier, embedded so it is recallable.
    presenter.writeMemoriesSync([{ kind: 'semantic', content: 'user prefers redis for caching' }], {
      agentId: 'a'
    })
    await presenter.processPendingEmbeddings('a')
    seedUnits(repo, 'a', 6)

    const draft = await presenter.maybeEvolvePersona('a', MODEL)
    expect(await presenter.approvePersonaDraft('a', draft!.draftId)).toBe(true)

    // Re-asking the preference several turns later still recalls it, alongside the evolved self-model.
    const payload = await presenter.buildInjection('a', 'redis')
    expect(payload?.selfModel).toBe('I default to redis-backed caching advice.')
    expect(payload?.memories.some((memory) => memory.content.includes('redis'))).toBe(true)
  })

  it('AC-6.2 never drifts the active self-model across evolution rounds without approval', async () => {
    const { presenter, repo } = makeAgent(distiller('a brand new distilled self-model'))
    const baselineId = presenter.evolvePersona('a', 'the approved baseline self-model', null)
    expect(await presenter.approvePersonaDraft('a', baselineId!)).toBe(true)
    const baseline = (await presenter.buildInjection('a', 'q'))?.selfModel
    expect(baseline).toBe('the approved baseline self-model')

    // Several evolution rounds, each adding fresh high-importance units; none of them approved.
    for (let round = 0; round < 3; round += 1) {
      seedUnits(repo, 'a', 6, 3000 + round * 100)
      await presenter.maybeEvolvePersona('a', MODEL)
      // The injected self-model is byte-for-byte unchanged on every round.
      expect((await presenter.buildInjection('a', 'q'))?.selfModel).toBe(baseline)
      expect(repo.getActivePersona('a')?.content).toBe(baseline)
    }
    // At most one outstanding draft accumulates; the rest are throttled before any model call.
    expect(presenter.listPersonaDrafts('a').length).toBeLessThanOrEqual(1)
  })
})
