import { describe, expect, it } from 'vitest'

import { enabledConfig, makePresenter } from '../fakes/memoryFakes'

describe('reflection rows (T3)', () => {
  it('participate in recall alongside atomic units', async () => {
    const { presenter, repo } = makePresenter(enabledConfig)
    repo.insert({
      id: 'r1',
      agentId: 'deepchat',
      kind: 'reflection',
      content: 'the user works on redis backends',
      status: 'embedded',
      importance: 0.8
    })
    const results = await presenter.recall('deepchat', 'redis')
    expect(results.map((item) => item.id)).toContain('r1')
    expect(results.find((item) => item.id === 'r1')?.kind).toBe('reflection')
  })
})
