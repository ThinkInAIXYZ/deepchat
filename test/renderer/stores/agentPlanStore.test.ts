import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vueuse/core', () => ({
  useStorage: <T>(_key: string, initialValue: T) => ({
    value: initialValue
  })
}))

describe('agentPlanStore', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doUnmock('pinia')
    const { createPinia, setActivePinia } = await vi.importActual<typeof import('pinia')>('pinia')
    setActivePinia(createPinia())
  })

  it('defaults new session progress panels to collapsed and ignores stale snapshots', async () => {
    const { useAgentPlanStore } = await import('@/stores/ui/agentPlan')
    const store = useAgentPlanStore()

    expect(store.isCollapsed('s1')).toBe(true)

    store.toggleCollapsed('s1')
    expect(store.isCollapsed('s1')).toBe(false)

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
})
