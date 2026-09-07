import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LiveDelegationDetail,
  LiveDelegationSummary
} from '@shared/orchestration/liveDelegation'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

const client = vi.hoisted(() => {
  let changed: ((payload: { delegation: LiveDelegationSummary }) => void) | null = null
  return {
    listLiveDelegations: vi.fn(),
    inspectLiveDelegation: vi.fn(),
    interruptLiveDelegation: vi.fn(),
    stop: vi.fn(),
    onLiveDelegationChanged: vi.fn(
      (listener: (payload: { delegation: LiveDelegationSummary }) => void) => {
        changed = listener
        return client.stop
      }
    ),
    emitChanged(delegation: LiveDelegationSummary) {
      changed?.({ delegation })
    },
    reset() {
      changed = null
    }
  }
})

vi.mock('@api/OrchestrationClient', () => ({
  createOrchestrationClient: () => client
}))

import { useLiveDelegationStore } from '@/stores/ui/liveDelegation'

function summary(overrides: Partial<LiveDelegationSummary> = {}): LiveDelegationSummary {
  return {
    schemaVersion: 1,
    id: 'delegation-1',
    parentSessionId: 'parent-1',
    childSessionId: 'child-1',
    slotId: 'reviewer',
    targetAgentId: 'deepchat',
    title: 'Review architecture',
    status: 'running',
    lastTurnSeq: 1,
    createdAt: 10,
    updatedAt: 20,
    revision: 1,
    summaryPreview: null,
    errorPreview: null,
    ...overrides
  }
}

describe('liveDelegation store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    client.reset()
    setActivePinia(createPinia())
  })

  it('shares one event subscription and deduplicates initial loads', async () => {
    let resolveList: ((items: LiveDelegationSummary[]) => void) | null = null
    client.listLiveDelegations.mockReturnValue(
      new Promise<LiveDelegationSummary[]>((resolve) => {
        resolveList = resolve
      })
    )
    const store = useLiveDelegationStore()

    const first = store.ensureLoaded('parent-1')
    const second = store.ensureLoaded('parent-1')
    expect(client.onLiveDelegationChanged).toHaveBeenCalledOnce()
    expect(client.listLiveDelegations).toHaveBeenCalledOnce()

    resolveList?.([summary()])
    await Promise.all([first, second])
    expect(store.listAuthoritative('parent-1')).toHaveLength(1)
  })

  it('revalidates a loaded projection when the activity surface remounts', async () => {
    client.listLiveDelegations
      .mockResolvedValueOnce([summary()])
      .mockResolvedValueOnce([
        summary({ status: 'idle', revision: 2, updatedAt: 30, summaryPreview: 'Done.' })
      ])
    const store = useLiveDelegationStore()

    await store.ensureLoaded('parent-1')
    await store.ensureLoaded('parent-1', { revalidate: true })

    expect(client.listLiveDelegations).toHaveBeenCalledTimes(2)
    expect(store.getDelegation('parent-1', 'delegation-1')).toMatchObject({
      status: 'idle',
      revision: 2,
      summaryPreview: 'Done.'
    })
  })

  it('keeps a newer event projection ahead of a stale list response', async () => {
    let resolveList: ((items: LiveDelegationSummary[]) => void) | null = null
    client.listLiveDelegations.mockReturnValue(
      new Promise<LiveDelegationSummary[]>((resolve) => {
        resolveList = resolve
      })
    )
    const store = useLiveDelegationStore()
    const loading = store.ensureLoaded('parent-1')

    client.emitChanged(summary({ revision: 2, updatedAt: 30, summaryPreview: 'Newest result.' }))
    resolveList?.([summary({ revision: 1, summaryPreview: 'Stale result.' })])
    await loading

    expect(store.getDelegation('parent-1', 'delegation-1')?.summaryPreview).toBe('Newest result.')
  })

  it('prunes missing authoritative summaries without dropping a concurrent newer event', async () => {
    client.listLiveDelegations.mockResolvedValueOnce([
      summary(),
      summary({ id: 'delegation-stale', childSessionId: 'child-stale' })
    ])
    const store = useLiveDelegationStore()
    await store.ensureLoaded('parent-1')

    let resolveList: ((items: LiveDelegationSummary[]) => void) | null = null
    client.listLiveDelegations.mockReturnValueOnce(
      new Promise<LiveDelegationSummary[]>((resolve) => {
        resolveList = resolve
      })
    )
    const refreshing = store.refresh('parent-1')
    client.emitChanged(summary({ revision: 2, updatedAt: 30, summaryPreview: 'Still active.' }))
    resolveList?.([])
    await refreshing

    expect(store.getDelegation('parent-1', 'delegation-1')).toMatchObject({
      revision: 2,
      summaryPreview: 'Still active.'
    })
    expect(store.getDelegation('parent-1', 'delegation-stale')).toBeNull()
  })

  it('deduplicates interrupts and merges the returned revision', async () => {
    let resolveInterrupt: ((detail: LiveDelegationDetail) => void) | null = null
    client.interruptLiveDelegation.mockReturnValue(
      new Promise<LiveDelegationDetail>((resolve) => {
        resolveInterrupt = resolve
      })
    )
    client.inspectLiveDelegation.mockResolvedValue({ delegation: summary(), turns: [] })
    const store = useLiveDelegationStore()
    store.seed(summary())

    const first = store.interrupt('parent-1', 'delegation-1')
    const second = store.interrupt('parent-1', 'delegation-1')
    await vi.waitFor(() => expect(client.interruptLiveDelegation).toHaveBeenCalledOnce())
    expect(store.isInterrupting('parent-1', 'delegation-1')).toBe(true)

    resolveInterrupt?.({
      delegation: summary({ status: 'interrupted', revision: 2, updatedAt: 30 }),
      turns: []
    })
    await Promise.all([first, second])

    expect(store.isInterrupting('parent-1', 'delegation-1')).toBe(false)
    expect(store.getDelegation('parent-1', 'delegation-1')?.status).toBe('interrupted')
  })

  it('requires host confirmation before trusting transcript-seeded navigation data', async () => {
    const store = useLiveDelegationStore()
    store.seed(
      summary({
        childSessionId: 'forged-child',
        revision: 999,
        updatedAt: 999
      })
    )
    client.listLiveDelegations.mockResolvedValue([])
    client.inspectLiveDelegation.mockResolvedValue({
      delegation: summary({ childSessionId: 'real-child', revision: 2, updatedAt: 30 }),
      turns: []
    })

    await store.ensureLoaded('parent-1')
    expect(store.isAuthoritative('parent-1', 'delegation-1')).toBe(false)
    expect(store.listAuthoritative('parent-1')).toEqual([])
    expect(store.getDelegation('parent-1', 'delegation-1')?.childSessionId).toBe('forged-child')

    const confirmed = await store.confirm('parent-1', 'delegation-1')
    expect(client.inspectLiveDelegation).toHaveBeenCalledWith('parent-1', 'delegation-1')
    expect(confirmed.childSessionId).toBe('real-child')
    expect(store.isAuthoritative('parent-1', 'delegation-1')).toBe(true)
    expect(store.listAuthoritative('parent-1')).toEqual([confirmed])
    expect(store.getDelegation('parent-1', 'delegation-1')?.revision).toBe(2)
  })

  it('rejects a host response that does not match the requested delegation relationship', async () => {
    const store = useLiveDelegationStore()
    store.seed(summary({ childSessionId: 'transcript-child' }))
    client.inspectLiveDelegation.mockResolvedValue({
      delegation: summary({ id: 'other-delegation', childSessionId: 'other-child' }),
      turns: []
    })

    await expect(store.confirm('parent-1', 'delegation-1')).rejects.toThrow(
      'requested relationship'
    )

    expect(store.isAuthoritative('parent-1', 'delegation-1')).toBe(false)
    expect(store.getDelegation('parent-1', 'other-delegation')).toBeNull()
  })

  it('purges deleted parent projections without reviving them from an in-flight refresh', async () => {
    let resolveList: ((items: LiveDelegationSummary[]) => void) | null = null
    client.listLiveDelegations.mockReturnValue(
      new Promise<LiveDelegationSummary[]>((resolve) => {
        resolveList = resolve
      })
    )
    const store = useLiveDelegationStore()
    store.seed(summary())

    const refreshing = store.refresh('parent-1')
    store.purge('parent-1')
    resolveList?.([summary({ revision: 2, updatedAt: 30 })])

    await expect(refreshing).resolves.toBe(false)
    expect(store.getDelegation('parent-1', 'delegation-1')).toBeNull()
    expect(store.getLoadState('parent-1')).toEqual({
      loaded: false,
      loading: false,
      loadFailed: false
    })
  })

  it('does not start an interrupt after its parent projection is purged during confirmation', async () => {
    let resolveInspect: ((detail: LiveDelegationDetail) => void) | null = null
    client.inspectLiveDelegation.mockReturnValue(
      new Promise<LiveDelegationDetail>((resolve) => {
        resolveInspect = resolve
      })
    )
    const store = useLiveDelegationStore()
    store.seed(summary())

    const interrupting = store.interrupt('parent-1', 'delegation-1')
    await vi.waitFor(() => expect(client.inspectLiveDelegation).toHaveBeenCalledOnce())
    store.purge('parent-1')
    resolveInspect?.({ delegation: summary(), turns: [] })

    await expect(interrupting).rejects.toThrow('parent Session was removed')
    expect(client.interruptLiveDelegation).not.toHaveBeenCalled()
    expect(store.getDelegation('parent-1', 'delegation-1')).toBeNull()
  })
})
