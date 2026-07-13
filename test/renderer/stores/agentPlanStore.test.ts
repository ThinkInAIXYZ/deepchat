import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vueuse/core', () => ({
  useStorage: <T>(_key: string, initialValue: T) => ({
    value: initialValue
  })
}))

type StoredAgentPlanViewState = {
  collapsed?: boolean
  dismissedMessageId?: string
}

const getViewStateBySession = (store: {
  viewStateBySession: unknown
}): Record<string, StoredAgentPlanViewState> => {
  const storage = store.viewStateBySession as
    | { value?: Record<string, StoredAgentPlanViewState> }
    | Record<string, StoredAgentPlanViewState>
  return 'value' in storage && storage.value ? storage.value : storage
}

describe('agentPlanStore', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doUnmock('pinia')
    const { createPinia, setActivePinia } = await vi.importActual<typeof import('pinia')>('pinia')
    setActivePinia(createPinia())
  })

  it('defaults new session progress panels to expanded and ignores stale snapshots', async () => {
    const { useAgentPlanStore } = await import('@/stores/ui/agentPlan')
    const store = useAgentPlanStore()

    expect(store.isCollapsed('s1')).toBe(false)
    expect(getViewStateBySession(store).s1).toBeUndefined()
    expect(store.isVisible('missing')).toBe(false)
    expect(getViewStateBySession(store).missing).toBeUndefined()

    store.toggleCollapsed('s1')
    expect(store.isCollapsed('s1')).toBe(true)
    expect(getViewStateBySession(store).s1).toEqual({ collapsed: true })

    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Newer', status: 'in_progress' }],
      revision: 2,
      updatedAt: '2026-05-18T00:00:00.000Z'
    })
    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Older', status: 'pending' }],
      revision: 1,
      updatedAt: '2026-05-17T00:00:00.000Z'
    })

    expect(store.snapshots.s1.plan[0]?.step).toBe('Newer')
  })

  it('rebaselines each turn so revision 1 renders after a clear', async () => {
    const { useAgentPlanStore } = await import('@/stores/ui/agentPlan')
    const store = useAgentPlanStore()

    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Old', status: 'completed' }],
      revision: 4,
      updatedAt: '2026-05-18T00:00:00.000Z'
    })

    store.beginTurn('s1')
    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm2',
      plan: [{ step: 'Fresh', status: 'in_progress' }],
      revision: 1,
      updatedAt: '2026-05-18T00:01:00.000Z'
    })

    expect(store.snapshots.s1.plan[0]?.step).toBe('Fresh')
    expect(store.isVisible('s1')).toBe(true)
  })

  it('accepts a new message snapshot without an explicit beginTurn', async () => {
    const { useAgentPlanStore } = await import('@/stores/ui/agentPlan')
    const store = useAgentPlanStore()

    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Old turn', status: 'in_progress' }],
      revision: 4,
      updatedAt: '2026-05-18T00:00:00.000Z'
    })
    store.dismiss('s1')

    expect(store.isVisible('s1')).toBe(false)
    expect(store.isCollapsed('s1')).toBe(true)
    expect(getViewStateBySession(store).s1).toEqual({
      collapsed: true,
      dismissedMessageId: 'm1'
    })

    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm2',
      plan: [{ step: 'Auto queued turn', status: 'in_progress' }],
      revision: 1,
      updatedAt: '2026-05-18T00:01:00.000Z'
    })

    expect(store.snapshots.s1.messageId).toBe('m2')
    expect(store.snapshots.s1.plan[0]?.step).toBe('Auto queued turn')
    expect(store.isVisible('s1')).toBe(true)
    expect(store.isCollapsed('s1')).toBe(false)
    expect(getViewStateBySession(store).s1).toEqual({ collapsed: false })
  })

  it('auto-collapses only when the same message first becomes fully completed', async () => {
    const { useAgentPlanStore } = await import('@/stores/ui/agentPlan')
    const store = useAgentPlanStore()

    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Current', status: 'in_progress' }],
      revision: 1,
      updatedAt: '2026-05-18T00:00:00.000Z'
    })

    expect(store.isCollapsed('s1')).toBe(false)

    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Current', status: 'completed' }],
      revision: 2,
      updatedAt: '2026-05-18T00:00:01.000Z'
    })

    expect(store.isCollapsed('s1')).toBe(true)

    store.setCollapsed('s1', false)
    expect(store.isCollapsed('s1')).toBe(false)

    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Current', status: 'completed' }],
      revision: 3,
      updatedAt: '2026-05-18T00:00:02.000Z'
    })

    expect(store.isCollapsed('s1')).toBe(false)
  })

  it('drops same-revision non-terminal snapshots for the same message', async () => {
    const { useAgentPlanStore } = await import('@/stores/ui/agentPlan')
    const store = useAgentPlanStore()

    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Current', status: 'in_progress' }],
      revision: 2,
      updatedAt: '2026-05-18T00:00:00.000Z'
    })
    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Duplicate same revision', status: 'completed' }],
      revision: 2,
      updatedAt: '2026-05-18T00:00:01.000Z'
    })

    expect(store.snapshots.s1.plan[0]?.step).toBe('Current')
    expect(store.snapshots.s1.terminalReason).toBeUndefined()
  })

  it('accepts same-revision terminal updates', async () => {
    const { useAgentPlanStore } = await import('@/stores/ui/agentPlan')
    const store = useAgentPlanStore()

    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Current', status: 'in_progress' }],
      revision: 2,
      updatedAt: '2026-05-18T00:00:00.000Z'
    })
    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Current', status: 'in_progress' }],
      revision: 2,
      updatedAt: '2026-05-18T00:00:01.000Z',
      terminalReason: 'error'
    })

    expect(store.snapshots.s1.terminalReason).toBe('error')
  })

  it('allows backend terminal reason to replace optimistic freeze', async () => {
    const { useAgentPlanStore } = await import('@/stores/ui/agentPlan')
    const store = useAgentPlanStore()

    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Current', status: 'in_progress' }],
      revision: 2,
      updatedAt: '2026-05-18T00:00:00.000Z'
    })
    store.freezeActive('s1')
    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Current', status: 'in_progress' }],
      revision: 2,
      updatedAt: '2026-05-18T00:00:01.000Z',
      terminalReason: 'max_steps'
    })

    expect(store.snapshots.s1.terminalReason).toBe('max_steps')
  })

  it('keeps dismiss sticky until the next turn begins', async () => {
    const { useAgentPlanStore } = await import('@/stores/ui/agentPlan')
    const store = useAgentPlanStore()

    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Current', status: 'in_progress' }],
      revision: 2,
      updatedAt: '2026-05-18T00:00:00.000Z'
    })
    store.dismiss('s1')

    expect(store.isVisible('s1')).toBe(false)

    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Later same turn', status: 'in_progress' }],
      revision: 3,
      updatedAt: '2026-05-18T00:00:01.000Z'
    })

    expect(store.isVisible('s1')).toBe(false)

    store.beginTurn('s1')
    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm2',
      plan: [{ step: 'Next turn', status: 'in_progress' }],
      revision: 1,
      updatedAt: '2026-05-18T00:01:00.000Z'
    })

    expect(store.isVisible('s1')).toBe(true)
  })

  it('freezes active plans and purges session state', async () => {
    const { useAgentPlanStore } = await import('@/stores/ui/agentPlan')
    const store = useAgentPlanStore()

    store.applySnapshot({
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Current', status: 'in_progress' }],
      revision: 1,
      updatedAt: '2026-05-18T00:00:00.000Z'
    })
    store.freezeActive('s1')
    store.dismiss('s1')

    expect(store.snapshots.s1.terminalReason).toBe('aborted')
    expect(getViewStateBySession(store).s1).toEqual({
      collapsed: true,
      dismissedMessageId: 'm1'
    })

    store.purge('s1')
    expect(store.snapshots.s1).toBeUndefined()
    expect(getViewStateBySession(store).s1).toBeUndefined()
  })
})
