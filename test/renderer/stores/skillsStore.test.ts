import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

const createSkill = (name: string, description: string): UnifiedSkillItem => ({
  name,
  description,
  path: `/skills/${name}/SKILL.md`,
  skillRoot: `/skills/${name}`,
  canonicalPath: `/skills/${name}/SKILL.md`,
  sourceType: 'created',
  deepchatDisabled: false,
  agentLinks: {},
  mutable: true
})

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('skillsStore catalog events', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('ignores catalog changes scoped only to a manual Agent', async () => {
    let catalogListener: ((payload: { agentIds?: string[] }) => void) | undefined
    const skillClient = {
      getUnifiedSkillCatalog: vi.fn().mockResolvedValue([]),
      onCatalogChanged: vi.fn((listener: (payload: { agentIds?: string[] }) => void) => {
        catalogListener = listener
        return () => undefined
      })
    }
    vi.doMock('@api/SkillClient', () => ({
      createSkillClient: () => skillClient
    }))

    const { useSkillsStore } = await import('@/stores/skillsStore')
    useSkillsStore()

    catalogListener?.({ agentIds: ['manual-agent'] })
    await Promise.resolve()
    expect(skillClient.getUnifiedSkillCatalog).not.toHaveBeenCalled()

    catalogListener?.({ agentIds: ['deepchat'] })
    await Promise.resolve()
    expect(skillClient.getUnifiedSkillCatalog).toHaveBeenCalledTimes(1)

    catalogListener?.({})
    await Promise.resolve()
    expect(skillClient.getUnifiedSkillCatalog).toHaveBeenCalledTimes(2)
  })

  it('uses the catalog event as the single refresh after disabling a skill', async () => {
    let catalogListener: ((payload: { agentIds?: string[] }) => void) | undefined
    const skillClient = {
      setSkillDisabled: vi.fn().mockResolvedValue(undefined),
      getUnifiedSkillCatalog: vi.fn().mockResolvedValue([]),
      onCatalogChanged: vi.fn((listener: (payload: { agentIds?: string[] }) => void) => {
        catalogListener = listener
        return () => undefined
      })
    }
    vi.doMock('@api/SkillClient', () => ({
      createSkillClient: () => skillClient
    }))

    const { useSkillsStore } = await import('@/stores/skillsStore')
    const store = useSkillsStore()
    await store.setSkillDisabled('skill-a', true)

    expect(skillClient.setSkillDisabled).toHaveBeenCalledWith('skill-a', true)
    expect(skillClient.getUnifiedSkillCatalog).not.toHaveBeenCalled()

    catalogListener?.({ agentIds: ['deepchat'] })
    await Promise.resolve()
    expect(skillClient.getUnifiedSkillCatalog).toHaveBeenCalledTimes(1)
  })

  it('keeps concurrent Agent catalogs isolated when the earlier request resolves last', async () => {
    const resolvers = new Map<string, (skills: UnifiedSkillItem[]) => void>()
    const skillClient = {
      getUnifiedSkillCatalog: vi.fn(
        (agentId: string) =>
          new Promise<UnifiedSkillItem[]>((resolve) => {
            resolvers.set(agentId, resolve)
          })
      ),
      onCatalogChanged: vi.fn(() => () => undefined)
    }
    vi.doMock('@api/SkillClient', () => ({
      createSkillClient: () => skillClient
    }))

    const { useSkillsStore } = await import('@/stores/skillsStore')
    const store = useSkillsStore()
    const loadAgentA = store.loadSkills('agent-a')
    const loadAgentB = store.loadSkills('agent-b')

    resolvers.get('agent-b')?.([
      createSkill('shared-skill', 'Agent B description'),
      createSkill('b-only-skill', 'Only Agent B')
    ])
    await loadAgentB

    expect(store.getSkillsForAgent('agent-b')).toEqual([
      expect.objectContaining({ name: 'shared-skill', description: 'Agent B description' }),
      expect.objectContaining({ name: 'b-only-skill', description: 'Only Agent B' })
    ])

    resolvers.get('agent-a')?.([createSkill('shared-skill', 'Agent A description')])
    await loadAgentA

    expect(store.getSkillsForAgent('agent-a')).toEqual([
      expect.objectContaining({ name: 'shared-skill', description: 'Agent A description' })
    ])
    expect(store.getSkillsForAgent('agent-b')).toEqual([
      expect.objectContaining({ name: 'shared-skill', description: 'Agent B description' }),
      expect.objectContaining({ name: 'b-only-skill', description: 'Only Agent B' })
    ])
  })

  it('does not let an older builtin refresh overwrite newer runtime metadata', async () => {
    const catalogRequests: Array<ReturnType<typeof createDeferred<UnifiedSkillItem[]>>> = []
    const runtimeRequests = new Map<string, ReturnType<typeof createDeferred<null>>>()
    const skillClient = {
      getUnifiedSkillCatalog: vi.fn(() => {
        const request = createDeferred<UnifiedSkillItem[]>()
        catalogRequests.push(request)
        return request.promise
      }),
      getSkillExtension: vi.fn((name: string) => {
        const request = createDeferred<null>()
        runtimeRequests.set(name, request)
        return request.promise
      }),
      listSkillScripts: vi.fn().mockResolvedValue([]),
      onCatalogChanged: vi.fn(() => () => undefined)
    }
    vi.doMock('@api/SkillClient', () => ({
      createSkillClient: () => skillClient
    }))

    const { useSkillsStore } = await import('@/stores/skillsStore')
    const store = useSkillsStore()
    const olderLoad = store.loadSkills('deepchat')
    catalogRequests[0].resolve([createSkill('older-skill', 'Older catalog')])
    await vi.waitFor(() => expect(runtimeRequests.has('older-skill')).toBe(true))

    const newerLoad = store.loadSkills('deepchat')
    catalogRequests[1].resolve([createSkill('newer-skill', 'Newer catalog')])
    await vi.waitFor(() => expect(runtimeRequests.has('newer-skill')).toBe(true))
    runtimeRequests.get('newer-skill')?.resolve(null)
    await newerLoad

    runtimeRequests.get('older-skill')?.resolve(null)
    await olderLoad

    expect(store.getSkillsForAgent('deepchat')).toEqual([
      expect.objectContaining({ name: 'newer-skill' })
    ])
    expect(store.skillExtensions).toHaveProperty('newer-skill')
    expect(store.skillExtensions).not.toHaveProperty('older-skill')
  })
})
