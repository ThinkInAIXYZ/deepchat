import { describe, expect, it } from 'vitest'

import { createEmptyMemoryHealth } from '@shared/contracts/routes'
import { enabledConfig, makePresenter } from './fakes/memoryFakes'

describe('MemoryPresenter facade', () => {
  it('composes the required runtime health contract for an empty Agent', async () => {
    const { presenter } = makePresenter(enabledConfig)

    expect(presenter.getHealth('deepchat')).toEqual(createEmptyMemoryHealth())
    await presenter.dispose()
  })

  it('delegates a write, embedding drain, recall, and cleanup across services', async () => {
    const { presenter } = makePresenter(enabledConfig)
    const [memoryId] = presenter.writeMemoriesSync(
      [{ kind: 'semantic', content: 'Redis listens on port 6379', importance: 0.8 }],
      { agentId: 'deepchat' }
    )

    await presenter.processPendingEmbeddings('deepchat')
    const recalled = await presenter.recall('deepchat', 'redis port', 5)
    expect(recalled.map((item) => item.id)).toContain(memoryId)
    expect(await presenter.clearMemories('deepchat')).toBe(1)
    expect(presenter.getStatus('deepchat').total).toBe(0)
    await presenter.dispose()
  })

  it('keeps dispose idempotent at the facade boundary', async () => {
    const { presenter } = makePresenter(enabledConfig)

    await presenter.dispose()
    await expect(presenter.dispose()).resolves.toBeUndefined()
  })
})
