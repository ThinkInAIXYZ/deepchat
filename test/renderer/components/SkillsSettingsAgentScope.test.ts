import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

const mocks = vi.hoisted(() => ({
  configClient: {
    getSkillDraftSuggestionsEnabled: vi.fn(),
    listAgents: vi.fn(),
    resolveDeepChatAgentConfig: vi.fn(),
    updateDeepChatAgent: vi.fn(),
    onAgentsChanged: vi.fn(),
    getSetting: vi.fn()
  },
  skillClient: {
    getUnifiedSkillCatalog: vi.fn(),
    getSkillExtension: vi.fn(),
    listSkillScripts: vi.fn(),
    onCatalogChanged: vi.fn(),
    readSkillFile: vi.fn(),
    setSkillDisabled: vi.fn(),
    updateSkillFile: vi.fn(),
    uninstallSkill: vi.fn()
  }
}))

let catalogChangedListener: ((payload: { agentIds?: string[] }) => void) | undefined

vi.mock('@api/ConfigClient', () => ({
  createConfigClient: () => mocks.configClient
}))
vi.mock('@api/SkillClient', () => ({
  createSkillClient: () => mocks.skillClient
}))
vi.mock('@api/WindowClient', () => ({
  createWindowClient: () => ({})
}))
vi.mock('@/composables/useGuidedOnboardingStep', () => ({
  useGuidedOnboardingStep: () => ({
    showGuide: { value: false },
    stepIndex: { value: 1 },
    totalSteps: { value: 1 },
    currentStepId: { value: 'skills' },
    stepState: { value: null },
    canGoPrevious: { value: false },
    dismissGuide: vi.fn(),
    completeStep: vi.fn(),
    activatePreviousStep: vi.fn(),
    skipStep: vi.fn(),
    forceComplete: vi.fn()
  })
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.name ? `${key}:${String(params.name)}` : key
  })
}))
vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({ name: 'Icon', template: '<span />' })
}))

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot name="actions" /><slot /></div>'
  })

const tabsContentStub = defineComponent({
  name: 'TabsContent',
  props: {
    value: {
      type: String,
      required: true
    }
  },
  template: '<div v-if="value === \'library\'"><slot /></div>'
})

const SkillCardStub = defineComponent({
  name: 'SkillCard',
  props: {
    skill: { type: Object, required: true }
  },
  emits: ['toggle-disabled', 'view'],
  template:
    '<div><button :data-testid="`skill-${skill.name}`" @click="$emit(\'toggle-disabled\', !skill.deepchatDisabled)">{{ skill.name }}:{{ skill.deepchatDisabled }}</button><button :data-testid="`view-${skill.name}`" @click="$emit(\'view\')">view</button></div>'
})

const SkillDetailDialogStub = defineComponent({
  name: 'SkillDetailDialog',
  props: {
    open: Boolean,
    markdown: String
  },
  emits: ['save'],
  template:
    '<div data-testid="skill-detail-state" :data-open="String(open)">{{ markdown ?? "" }}<button v-if="open" data-testid="detail-save" @click="$emit(\'save\', \'# Updated\')">save</button></div>'
})

const mountSkillsSettings = async (scope: 'global' | 'agent') => {
  const SkillsSettings = (
    await import('../../../src/renderer/settings/components/skills/SkillsSettings.vue')
  ).default
  return mount(SkillsSettings, {
    props: {
      scope
    },
    global: {
      stubs: {
        SettingsPageShell: passthrough('SettingsPageShell'),
        GuidedOnboardingOverlay: true,
        Separator: true,
        DcButton: defineComponent({ name: 'Button', template: '<button><slot /></button>' }),
        Input: true,
        Switch: true,
        Tabs: passthrough('Tabs'),
        TabsList: passthrough('TabsList'),
        TabsTrigger: passthrough('TabsTrigger'),
        TabsContent: tabsContentStub,
        DropdownMenu: passthrough('DropdownMenu'),
        DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
        DropdownMenuContent: passthrough('DropdownMenuContent'),
        DropdownMenuItem: passthrough('DropdownMenuItem'),
        SkillCard: SkillCardStub,
        SkillAgentsTab: true,
        SkillImportExportTab: true,
        SkillInstallDialog: true,
        InstallFromGitDialog: true,
        ImportSkillsFromAgentDialog: true,
        SkillDetailDialog: SkillDetailDialogStub,
        Icon: true
      }
    }
  })
}

const mountAgentScopeSkillsSettings = () => mountSkillsSettings('agent')
const mountGlobalSkillsSettings = () => mountSkillsSettings('global')

describe('SkillsSettings agent scope', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setActivePinia(createPinia())

    mocks.configClient.getSkillDraftSuggestionsEnabled.mockResolvedValue(false)
    mocks.configClient.listAgents.mockResolvedValue([
      {
        id: 'agent-a',
        type: 'deepchat',
        name: 'Agent A',
        enabled: true,
        config: {
          enabledSkillNames: ['skill-alpha']
        }
      }
    ])
    mocks.configClient.resolveDeepChatAgentConfig.mockResolvedValue({
      enabledSkillNames: ['skill-alpha']
    })
    mocks.configClient.updateDeepChatAgent.mockResolvedValue({
      id: 'agent-a',
      type: 'deepchat',
      name: 'Agent A',
      enabled: true,
      config: {
        enabledSkillNames: ['skill-alpha', 'skill-beta']
      }
    })
    mocks.configClient.onAgentsChanged.mockReturnValue(() => undefined)
    mocks.configClient.getSetting.mockResolvedValue(null)
    mocks.skillClient.getUnifiedSkillCatalog.mockResolvedValue([
      {
        name: 'skill-alpha',
        description: 'Alpha',
        path: '',
        skillRoot: '',
        deepchatDisabled: false,
        mutable: true
      },
      {
        name: 'skill-beta',
        description: 'Beta',
        path: '',
        skillRoot: '',
        deepchatDisabled: true,
        mutable: true
      }
    ])
    mocks.skillClient.getSkillExtension.mockResolvedValue(null)
    mocks.skillClient.listSkillScripts.mockResolvedValue([])
    catalogChangedListener = undefined
    mocks.skillClient.onCatalogChanged.mockImplementation((listener) => {
      catalogChangedListener = listener
      return () => undefined
    })
    mocks.skillClient.readSkillFile.mockResolvedValue('# Skill')
    mocks.skillClient.updateSkillFile.mockResolvedValue({ success: true })
    mocks.skillClient.uninstallSkill.mockResolvedValue({ success: true })
  })

  it('keeps the skills management view and saves toggles to the current agent only', async () => {
    const { useAgentStore } = await import('@/stores/ui/agent')
    useAgentStore().setSelectedAgent('agent-a')

    const wrapper = await mountAgentScopeSkillsSettings()

    await flushPromises()

    expect(wrapper.text()).toContain('settings.skills.addSkill')
    expect(wrapper.text()).not.toContain('settings.skills.tabs.agents')
    expect(wrapper.text()).not.toContain('settings.skills.tabs.syncDirectory')
    const grid = wrapper.get('[data-testid="skills-library-grid"]')
    expect(grid.classes()).toContain('grid')
    expect(grid.classes()).toContain('grid-cols-[repeat(auto-fit,minmax(min(100%,26rem),1fr))]')
    expect(wrapper.find('[data-testid="skill-skill-alpha"]').text()).toContain('skill-alpha:false')
    expect(wrapper.find('[data-testid="skill-skill-beta"]').text()).toContain('skill-beta:true')

    await wrapper.find('[data-testid="skill-skill-beta"]').trigger('click')
    await flushPromises()

    expect(mocks.skillClient.setSkillDisabled).toHaveBeenCalledWith('skill-beta', false, 'agent-a')
    expect(mocks.configClient.updateDeepChatAgent).not.toHaveBeenCalled()
    expect(mocks.skillClient.getUnifiedSkillCatalog).toHaveBeenCalledTimes(1)

    catalogChangedListener?.({ agentIds: ['agent-a'] })
    await flushPromises()
    expect(mocks.skillClient.getUnifiedSkillCatalog).toHaveBeenCalledTimes(2)
  })

  it('keeps a global Skill detail open when the selected Agent changes', async () => {
    const { useAgentStore } = await import('@/stores/ui/agent')
    const agentStore = useAgentStore()
    agentStore.setSelectedAgent('agent-a')
    const wrapper = await mountGlobalSkillsSettings()
    await flushPromises()

    await wrapper.get('[data-testid="view-skill-alpha"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="skill-detail-state"]').attributes('data-open')).toBe('true')

    agentStore.setSelectedAgent('agent-b')
    await flushPromises()

    expect(wrapper.get('[data-testid="skill-detail-state"]').attributes('data-open')).toBe('true')
    expect(mocks.skillClient.readSkillFile).toHaveBeenCalledTimes(1)
  })

  it('hides Add Skill actions when the selected target is not a DeepChat Agent', async () => {
    const { useAgentStore } = await import('@/stores/ui/agent')
    useAgentStore().setSelectedAgent('acp-agent')
    mocks.configClient.listAgents.mockResolvedValueOnce([])
    mocks.skillClient.getUnifiedSkillCatalog.mockResolvedValueOnce([])

    const wrapper = await mountAgentScopeSkillsSettings()
    await flushPromises()

    expect(wrapper.text()).not.toContain('settings.skills.addSkill')
  })

  it('ignores stale agent policy responses after the selected agent changes', async () => {
    const { useAgentStore } = await import('@/stores/ui/agent')
    const agentStore = useAgentStore()
    agentStore.setSelectedAgent('agent-a')

    let resolveAgentA: ((agents: unknown[]) => void) | undefined
    let resolveCatalogA: ((skills: unknown[]) => void) | undefined
    mocks.skillClient.getUnifiedSkillCatalog.mockImplementation((agentId?: string) => {
      if (agentId === 'agent-a') {
        return new Promise((resolve) => {
          resolveCatalogA = resolve
        })
      }
      return Promise.resolve([
        {
          name: 'skill-beta',
          description: 'Beta',
          path: '',
          skillRoot: '',
          deepchatDisabled: false,
          mutable: true
        }
      ])
    })
    mocks.configClient.listAgents.mockImplementation(({ ids }: { ids: string[] }) => {
      if (ids[0] === 'agent-a') {
        return new Promise((resolve) => {
          resolveAgentA = resolve
        })
      }
      return Promise.resolve([
        {
          id: 'agent-b',
          type: 'deepchat',
          name: 'Agent B',
          enabled: true,
          config: {
            enabledSkillNames: ['skill-beta']
          }
        }
      ])
    })
    mocks.configClient.resolveDeepChatAgentConfig.mockImplementation((agentId: string) =>
      Promise.resolve({
        enabledSkillNames: agentId === 'agent-b' ? ['skill-beta'] : ['skill-alpha']
      })
    )

    const wrapper = await mountAgentScopeSkillsSettings()

    await Promise.resolve()
    agentStore.setSelectedAgent('agent-b')
    await flushPromises()

    expect(wrapper.find('[data-testid="skill-skill-alpha"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="skill-skill-beta"]').text()).toContain('skill-beta:false')

    resolveCatalogA?.([
      {
        name: 'skill-alpha',
        description: 'Alpha',
        path: '',
        skillRoot: '',
        deepchatDisabled: false,
        mutable: true
      }
    ])
    resolveAgentA?.([
      {
        id: 'agent-a',
        type: 'deepchat',
        name: 'Agent A',
        enabled: true,
        config: {
          enabledSkillNames: ['skill-alpha']
        }
      }
    ])
    await flushPromises()

    expect(wrapper.find('[data-testid="skill-skill-alpha"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="skill-skill-beta"]').text()).toContain('skill-beta:false')
  })

  it('settles a stale toggle error without blocking the next Agent', async () => {
    const { useAgentStore } = await import('@/stores/ui/agent')
    const agentStore = useAgentStore()
    agentStore.setSelectedAgent('agent-a')
    let rejectToggle!: (reason: Error) => void
    mocks.skillClient.setSkillDisabled.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectToggle = reject
      })
    )
    const wrapper = await mountAgentScopeSkillsSettings()
    await flushPromises()

    await wrapper.get('[data-testid="skill-skill-beta"]').trigger('click')
    mocks.skillClient.getUnifiedSkillCatalog.mockResolvedValueOnce([
      {
        name: 'skill-beta',
        description: 'Beta',
        path: '',
        skillRoot: '',
        deepchatDisabled: false,
        mutable: true
      }
    ])
    mocks.configClient.listAgents.mockResolvedValueOnce([
      {
        id: 'agent-b',
        type: 'deepchat',
        name: 'Agent B',
        enabled: true,
        config: {}
      }
    ])
    agentStore.setSelectedAgent('agent-b')
    await flushPromises()

    rejectToggle(new Error('Agent A toggle failed'))
    await flushPromises()

    expect(wrapper.text()).not.toContain('Agent A toggle failed')
    await wrapper.get('[data-testid="view-skill-beta"]').trigger('click')
    await flushPromises()
    expect(mocks.skillClient.readSkillFile).toHaveBeenCalledWith('skill-beta', 'agent-b')
  })

  it('clears the previous Agent catalog when the next scoped load fails', async () => {
    const { useAgentStore } = await import('@/stores/ui/agent')
    const agentStore = useAgentStore()
    agentStore.setSelectedAgent('agent-a')
    const wrapper = await mountAgentScopeSkillsSettings()
    await flushPromises()

    expect(wrapper.find('[data-testid="skill-skill-alpha"]').exists()).toBe(true)
    mocks.skillClient.getUnifiedSkillCatalog.mockRejectedValueOnce(new Error('catalog unavailable'))
    mocks.configClient.listAgents.mockResolvedValueOnce([
      {
        id: 'agent-b',
        type: 'deepchat',
        name: 'Agent B',
        enabled: true,
        config: {}
      }
    ])

    agentStore.setSelectedAgent('agent-b')
    await flushPromises()

    expect(wrapper.find('[data-testid="skill-skill-alpha"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('settings.skills.agents.loadFailed')
    expect(wrapper.text()).toContain('common.error.requestFailed')
    expect(wrapper.text()).not.toContain('catalog unavailable')
  })

  it('drops a stale detail response after the selected Agent changes', async () => {
    const { useAgentStore } = await import('@/stores/ui/agent')
    const agentStore = useAgentStore()
    agentStore.setSelectedAgent('agent-a')
    let resolveDetail!: (content: string) => void
    mocks.skillClient.readSkillFile.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDetail = resolve
      })
    )
    const wrapper = await mountAgentScopeSkillsSettings()
    await flushPromises()

    await wrapper.get('[data-testid="view-skill-alpha"]').trigger('click')
    mocks.skillClient.getUnifiedSkillCatalog.mockResolvedValueOnce([
      {
        name: 'skill-beta',
        description: 'Beta',
        path: '',
        skillRoot: '',
        deepchatDisabled: false,
        mutable: true
      }
    ])
    mocks.configClient.listAgents.mockResolvedValueOnce([
      {
        id: 'agent-b',
        type: 'deepchat',
        name: 'Agent B',
        enabled: true,
        config: {}
      }
    ])
    agentStore.setSelectedAgent('agent-b')
    await flushPromises()

    resolveDetail('# Agent A Skill')
    await flushPromises()

    const detailState = wrapper.get('[data-testid="skill-detail-state"]')
    expect(detailState.attributes('data-open')).toBe('false')
    expect(detailState.text()).not.toContain('Agent A Skill')
  })

  it('settles the previous Agent save before opening the next Agent Skill detail', async () => {
    const { useAgentStore } = await import('@/stores/ui/agent')
    const agentStore = useAgentStore()
    agentStore.setSelectedAgent('agent-a')
    let resolveSave!: (result: { success: boolean }) => void
    mocks.skillClient.updateSkillFile.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve
      })
    )
    const wrapper = await mountAgentScopeSkillsSettings()
    await flushPromises()

    await wrapper.get('[data-testid="view-skill-alpha"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="detail-save"]').trigger('click')

    mocks.skillClient.getUnifiedSkillCatalog.mockResolvedValueOnce([
      {
        name: 'skill-beta',
        description: 'Beta',
        path: '',
        skillRoot: '',
        deepchatDisabled: false,
        mutable: true
      }
    ])
    mocks.configClient.listAgents.mockResolvedValueOnce([
      {
        id: 'agent-b',
        type: 'deepchat',
        name: 'Agent B',
        enabled: true,
        config: {}
      }
    ])
    agentStore.setSelectedAgent('agent-b')
    await flushPromises()
    await wrapper.get('[data-testid="view-skill-beta"]').trigger('click')
    await flushPromises()

    expect(mocks.skillClient.readSkillFile).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="skill-detail-state"]').attributes('data-open')).toBe('false')

    resolveSave({ success: true })
    await flushPromises()
    await wrapper.get('[data-testid="view-skill-beta"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="skill-detail-state"]').attributes('data-open')).toBe('true')
    expect(mocks.skillClient.updateSkillFile).toHaveBeenCalledWith(
      'skill-alpha',
      '# Updated',
      'agent-a'
    )
  })
})
