import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, toRef } from 'vue'

const skillClient = vi.hoisted(() => ({
  getActiveSkills: vi.fn(),
  setActiveSkills: vi.fn(),
  removeActiveSkill: vi.fn(),
  onSessionChanged: vi.fn(() => () => undefined)
}))

vi.mock('@api/SkillClient', () => ({
  createSkillClient: () => skillClient
}))

vi.mock('@/stores/skillsStore', () => ({
  useSkillsStore: () => ({
    getSkillsForAgent: vi.fn(() => []),
    isSkillsLoading: vi.fn(() => false),
    ensureSkillsLoaded: vi.fn().mockResolvedValue(undefined)
  })
}))

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

let sessionChangedListener:
  | ((payload: {
      conversationId: string
      skills: string[]
      change: 'activated' | 'deactivated'
    }) => void)
  | null = null

describe('useSkillsData Session active Skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionChangedListener = null
    skillClient.onSessionChanged.mockImplementation((listener) => {
      sessionChangedListener = listener
      return () => undefined
    })
  })

  it('blocks overlapping removals and delegates the mutation atomically', async () => {
    skillClient.getActiveSkills.mockResolvedValueOnce(['review', 'database-migration'])
    const update = createDeferred<string[]>()
    skillClient.removeActiveSkill.mockReturnValue(update.promise)

    const { useSkillsData } = await import('@/components/chat-input/composables/useSkillsData')
    let skillsData!: ReturnType<typeof useSkillsData>
    const Harness = defineComponent({
      props: { sessionId: { type: String, required: true } },
      setup(props) {
        skillsData = useSkillsData(
          toRef(props, 'sessionId'),
          toRef(() => 'deepchat')
        )
        return () => null
      }
    })

    mount(Harness, { props: { sessionId: 'session-1' } })
    await flushPromises()

    const firstRemoval = skillsData.removeSessionActiveSkill('review')
    await skillsData.removeSessionActiveSkill('database-migration')

    expect(skillClient.removeActiveSkill).toHaveBeenCalledExactlyOnceWith('session-1', 'review')
    expect(skillsData.sessionActiveSkillRemoving.value).toBe('review')

    update.resolve(['database-migration', 'new-skill'])
    await firstRemoval

    expect(skillsData.sessionActiveSkills.value).toEqual(['database-migration', 'new-skill'])
    expect(skillsData.sessionActiveSkillRemoving.value).toBeNull()
  })

  it('clears the old Session state immediately and does not apply stale loads', async () => {
    const oldRefresh = createDeferred<string[]>()
    const newLoad = createDeferred<string[]>()
    let oldSessionLoadCount = 0
    skillClient.getActiveSkills.mockImplementation((sessionId: string) => {
      if (sessionId !== 'session-1') {
        return newLoad.promise
      }
      oldSessionLoadCount += 1
      return oldSessionLoadCount === 1 ? Promise.resolve(['old-session-skill']) : oldRefresh.promise
    })

    const { useSkillsData } = await import('@/components/chat-input/composables/useSkillsData')
    let skillsData!: ReturnType<typeof useSkillsData>
    const Harness = defineComponent({
      props: { sessionId: { type: String, required: true } },
      setup(props) {
        skillsData = useSkillsData(
          toRef(props, 'sessionId'),
          toRef(() => 'deepchat')
        )
        return () => null
      }
    })

    const wrapper = mount(Harness, { props: { sessionId: 'session-1' } })
    await flushPromises()
    expect(skillsData.sessionActiveSkills.value).toEqual(['old-session-skill'])

    const staleRefresh = skillsData.loadActiveSkills()
    await wrapper.setProps({ sessionId: 'session-2' })
    expect(skillsData.sessionActiveSkills.value).toEqual([])

    newLoad.resolve(['new-session-skill'])
    await flushPromises()
    expect(skillsData.sessionActiveSkills.value).toEqual(['new-session-skill'])

    oldRefresh.resolve(['stale-session-skill'])
    await staleRefresh
    expect(skillsData.sessionActiveSkills.value).toEqual(['new-session-skill'])
  })

  it('does not apply a completed removal after the Session changes', async () => {
    skillClient.getActiveSkills.mockImplementation(async (sessionId: string) =>
      sessionId === 'session-1' ? ['review'] : ['new-session-skill']
    )
    const update = createDeferred<string[]>()
    skillClient.removeActiveSkill.mockReturnValue(update.promise)

    const { useSkillsData } = await import('@/components/chat-input/composables/useSkillsData')
    let skillsData!: ReturnType<typeof useSkillsData>
    const Harness = defineComponent({
      props: { sessionId: { type: String, required: true } },
      setup(props) {
        skillsData = useSkillsData(
          toRef(props, 'sessionId'),
          toRef(() => 'deepchat')
        )
        return () => null
      }
    })

    const wrapper = mount(Harness, { props: { sessionId: 'session-1' } })
    await flushPromises()
    const oldSessionRemoval = skillsData.removeSessionActiveSkill('review')

    await wrapper.setProps({ sessionId: 'session-2' })
    await flushPromises()
    expect(skillsData.sessionActiveSkills.value).toEqual(['new-session-skill'])
    expect(skillsData.sessionActiveSkillRemoving.value).toBeNull()

    update.resolve([])
    await oldSessionRemoval
    expect(skillsData.sessionActiveSkills.value).toEqual(['new-session-skill'])
  })

  it('keeps overlapping old and new Session removals scoped to their captured IDs', async () => {
    skillClient.getActiveSkills.mockImplementation(async (sessionId: string) =>
      sessionId === 'session-1' ? ['old-skill'] : ['new-skill']
    )
    const oldUpdate = createDeferred<string[]>()
    const newUpdate = createDeferred<string[]>()
    skillClient.removeActiveSkill.mockImplementation((sessionId: string) =>
      sessionId === 'session-1' ? oldUpdate.promise : newUpdate.promise
    )

    const { useSkillsData } = await import('@/components/chat-input/composables/useSkillsData')
    let skillsData!: ReturnType<typeof useSkillsData>
    const Harness = defineComponent({
      props: { sessionId: { type: String, required: true } },
      setup(props) {
        skillsData = useSkillsData(
          toRef(props, 'sessionId'),
          toRef(() => 'deepchat')
        )
        return () => null
      }
    })

    const wrapper = mount(Harness, { props: { sessionId: 'session-1' } })
    await flushPromises()
    const oldRemoval = skillsData.removeSessionActiveSkill('old-skill')
    await flushPromises()

    await wrapper.setProps({ sessionId: 'session-2' })
    await flushPromises()
    const newRemoval = skillsData.removeSessionActiveSkill('new-skill')
    await flushPromises()

    expect(skillClient.removeActiveSkill).toHaveBeenNthCalledWith(1, 'session-1', 'old-skill')
    expect(skillClient.removeActiveSkill).toHaveBeenNthCalledWith(2, 'session-2', 'new-skill')

    oldUpdate.resolve([])
    await oldRemoval
    expect(skillsData.sessionActiveSkillRemoving.value).toBe('new-skill')

    newUpdate.resolve([])
    await newRemoval
    expect(skillsData.sessionActiveSkills.value).toEqual([])
    expect(skillsData.sessionActiveSkillRemoving.value).toBeNull()
  })

  it('reloads persistent Skills when the owning Agent changes', async () => {
    const agentBLoad = createDeferred<string[]>()
    skillClient.getActiveSkills.mockResolvedValueOnce(['agent-a-skill'])
    skillClient.getActiveSkills.mockReturnValueOnce(agentBLoad.promise)

    const { useSkillsData } = await import('@/components/chat-input/composables/useSkillsData')
    let skillsData!: ReturnType<typeof useSkillsData>
    const Harness = defineComponent({
      props: { agentId: { type: String, required: true } },
      setup(props) {
        skillsData = useSkillsData(
          toRef(() => 'session-1'),
          toRef(props, 'agentId')
        )
        return () => null
      }
    })

    const wrapper = mount(Harness, { props: { agentId: 'agent-a' } })
    await flushPromises()
    expect(skillsData.sessionActiveSkills.value).toEqual(['agent-a-skill'])

    await wrapper.setProps({ agentId: 'agent-b' })
    expect(skillsData.sessionActiveSkills.value).toEqual([])
    agentBLoad.resolve(['agent-b-skill'])
    await flushPromises()
    expect(skillsData.sessionActiveSkills.value).toEqual(['agent-b-skill'])
  })

  it('reloads authoritative state when a Session event races an active load', async () => {
    const staleLoad = createDeferred<string[]>()
    const authoritativeReload = createDeferred<string[]>()
    skillClient.getActiveSkills
      .mockReturnValueOnce(staleLoad.promise)
      .mockReturnValueOnce(authoritativeReload.promise)

    const { useSkillsData } = await import('@/components/chat-input/composables/useSkillsData')
    let skillsData!: ReturnType<typeof useSkillsData>
    const Harness = defineComponent({
      setup() {
        skillsData = useSkillsData(
          toRef(() => 'session-1'),
          toRef(() => 'deepchat')
        )
        return () => null
      }
    })

    mount(Harness)
    sessionChangedListener?.({
      conversationId: 'session-1',
      skills: ['latest-skill'],
      change: 'activated'
    })

    authoritativeReload.resolve(['latest-skill'])
    await flushPromises()
    expect(skillsData.sessionActiveSkills.value).toEqual(['latest-skill'])

    staleLoad.resolve(['stale-skill'])
    await flushPromises()
    expect(skillsData.sessionActiveSkills.value).toEqual(['latest-skill'])
  })

  it('surfaces current-Session removal failures and clears the busy state', async () => {
    skillClient.getActiveSkills.mockResolvedValue(['review'])
    skillClient.removeActiveSkill.mockRejectedValue(new Error('generation active'))

    const { useSkillsData } = await import('@/components/chat-input/composables/useSkillsData')
    let skillsData!: ReturnType<typeof useSkillsData>
    const Harness = defineComponent({
      setup() {
        skillsData = useSkillsData(
          toRef(() => 'session-1'),
          toRef(() => 'deepchat')
        )
        return () => null
      }
    })

    mount(Harness)
    await flushPromises()

    await expect(skillsData.removeSessionActiveSkill('review')).rejects.toThrow('generation active')
    expect(skillsData.sessionActiveSkills.value).toEqual(['review'])
    expect(skillsData.sessionActiveSkillRemoving.value).toBeNull()
  })
})
