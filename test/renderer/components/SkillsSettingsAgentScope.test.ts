import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

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
    setSkillDisabled: vi.fn()
  }
}))

vi.mock('@api/ConfigClient', () => ({
  createConfigClient: () => mocks.configClient
}))
vi.mock('@api/SkillClient', () => ({
  createSkillClient: () => mocks.skillClient
}))
vi.mock('@api/WindowClient', () => ({
  createWindowClient: () => ({})
}))
vi.mock('@/components/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
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
  emits: ['toggle-disabled'],
  template:
    '<button :data-testid="`skill-${skill.name}`" @click="$emit(\'toggle-disabled\', !skill.deepchatDisabled)">{{ skill.name }}:{{ skill.deepchatDisabled }}</button>'
})

const mountAgentScopeSkillsSettings = async () => {
  const SkillsSettings = (
    await import('../../../src/renderer/settings/components/skills/SkillsSettings.vue')
  ).default
  return mount(SkillsSettings, {
    props: {
      scope: 'agent'
    },
    global: {
      stubs: {
        SettingsPageShell: passthrough('SettingsPageShell'),
        GuidedOnboardingOverlay: true,
        Separator: true,
        Button: defineComponent({ name: 'Button', template: '<button><slot /></button>' }),
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
        InstallSkillToAgentDialog: true,
        SkillDetailDialog: true,
        Icon: true
      }
    }
  })
}

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
        deepchatDisabled: false,
        mutable: true
      }
    ])
    mocks.skillClient.getSkillExtension.mockResolvedValue(null)
    mocks.skillClient.listSkillScripts.mockResolvedValue([])
    mocks.skillClient.onCatalogChanged.mockReturnValue(() => undefined)
  })

  it('keeps the skills management view and saves toggles to the current agent only', async () => {
    const { useAgentStore } = await import('@/stores/ui/agent')
    useAgentStore().setSelectedAgent('agent-a')

    const wrapper = await mountAgentScopeSkillsSettings()

    await flushPromises()

    expect(wrapper.text()).toContain('settings.skills.addSkill')
    expect(wrapper.find('[data-testid="skill-skill-alpha"]').text()).toContain('skill-alpha:false')
    expect(wrapper.find('[data-testid="skill-skill-beta"]').text()).toContain('skill-beta:true')

    await wrapper.find('[data-testid="skill-skill-beta"]').trigger('click')
    await flushPromises()

    expect(mocks.skillClient.setSkillDisabled).not.toHaveBeenCalled()
    expect(mocks.configClient.updateDeepChatAgent).toHaveBeenCalledWith('agent-a', {
      config: {
        enabledSkillNames: ['skill-alpha', 'skill-beta']
      }
    })
  })

  it('ignores stale agent policy responses after the selected agent changes', async () => {
    const { useAgentStore } = await import('@/stores/ui/agent')
    const agentStore = useAgentStore()
    agentStore.setSelectedAgent('agent-a')

    let resolveAgentA: ((agents: unknown[]) => void) | undefined
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

    expect(wrapper.find('[data-testid="skill-skill-alpha"]').text()).toContain('skill-alpha:true')
    expect(wrapper.find('[data-testid="skill-skill-beta"]').text()).toContain('skill-beta:false')

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

    expect(wrapper.find('[data-testid="skill-skill-alpha"]').text()).toContain('skill-alpha:true')
    expect(wrapper.find('[data-testid="skill-skill-beta"]').text()).toContain('skill-beta:false')
  })
})
