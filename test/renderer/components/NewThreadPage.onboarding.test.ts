import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const chatInputFocusMock = vi.fn()
const chatInputTriggerAttachMock = vi.fn()

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const createChatInputBoxStub = () =>
  defineComponent({
    name: 'ChatInputBox',
    props: {
      modelValue: { type: String, default: '' },
      files: { type: Array, default: () => [] },
      sessionId: { type: String, default: null },
      workspacePath: { type: String, default: null },
      isAcpSession: { type: Boolean, default: false },
      submitDisabled: { type: Boolean, default: false }
    },
    emits: [
      'update:modelValue',
      'update:files',
      'submit',
      'command-submit',
      'pending-skills-change'
    ],
    setup(_props, { expose, slots }) {
      expose({
        triggerAttach: chatInputTriggerAttachMock,
        getPendingSkillsSnapshot: () => [],
        focusInput: chatInputFocusMock
      })

      return () =>
        h('div', { 'data-testid': 'chat-input-box' }, [
          h('div', {
            'data-testid': 'chat-input-contenteditable',
            contenteditable: 'true'
          }),
          slots.toolbar?.()
        ])
    }
  })

const setup = async () => {
  vi.resetModules()
  chatInputFocusMock.mockReset()
  chatInputTriggerAttachMock.mockReset()

  const projectStore = reactive({
    selectedProject: {
      path: '/tmp/workspace',
      name: 'workspace'
    },
    defaultProjectPath: null,
    selectionSource: 'manual' as const,
    projects: [],
    environments: [],
    archivedEnvironments: [],
    removedEnvironments: [],
    selectProject: vi.fn(),
    openFolderPicker: vi.fn()
  })

  const sessionStore = {
    createSession: vi.fn().mockResolvedValue(undefined),
    selectSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined)
  }

  const agentStore = reactive({
    selectedAgentId: 'deepchat',
    selectedAgent: { id: 'deepchat', name: 'DeepChat', type: 'deepchat' as const, enabled: true },
    agents: [{ id: 'deepchat', type: 'deepchat' as const }]
  })

  const modelStore = reactive({
    initialized: true,
    initialize: vi.fn().mockResolvedValue(undefined),
    enabledModels: [
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }]
      }
    ],
    get chatSelectableModelGroups() {
      return modelStore.enabledModels
    },
    findChatSelectableModel: vi.fn((providerId: string, modelId: string) => {
      const group = modelStore.enabledModels.find((entry) => entry.providerId === providerId)
      const model = group?.models.find((entry) => entry.id === modelId)
      if (!group || !model) {
        return null
      }
      return {
        providerId,
        providerName: group.providerName,
        model
      }
    }),
    pickFirstChatSelectableModel: vi.fn(() => ({
      providerId: 'openai',
      providerName: 'OpenAI',
      model: { id: 'gpt-4.1', name: 'GPT-4.1' }
    }))
  })

  const draftStore = reactive({
    projectDir: '/tmp/workspace',
    providerId: 'openai' as string | undefined,
    modelId: 'gpt-4.1' as string | undefined,
    permissionMode: 'full_access' as const,
    disabledAgentTools: [] as string[],
    subagentEnabled: false,
    systemPrompt: undefined as string | undefined,
    temperature: undefined as number | undefined,
    contextLength: undefined as number | undefined,
    maxTokens: undefined as number | undefined,
    timeout: undefined as number | undefined,
    thinkingBudget: undefined as number | undefined,
    reasoningEffort: undefined as string | undefined,
    reasoningVisibility: undefined as string | undefined,
    verbosity: undefined as string | undefined,
    forceInterleavedThinkingCompat: undefined as boolean | undefined,
    imageGeneration: undefined as Record<string, unknown> | undefined,
    pendingStartDeeplink: null as null,
    updateGenerationSettings: vi.fn(),
    toGenerationSettings: vi.fn(() => undefined),
    resetGenerationSettings: vi.fn()
  })

  const configClient = {
    getSetting: vi.fn().mockResolvedValue(undefined),
    resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({
      disabledAgentTools: [],
      permissionMode: 'full_access'
    }),
    openSettings: vi.fn().mockResolvedValue(undefined)
  }

  const sessionClient = {
    ensureAcpDraftSession: vi.fn().mockResolvedValue(null)
  }

  vi.doMock('@/stores/ui/project', () => ({
    useProjectStore: () => projectStore
  }))
  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => sessionStore
  }))
  vi.doMock('@/stores/ui/agent', () => ({
    useAgentStore: () => agentStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@/stores/ui/draft', () => ({
    useDraftStore: () => draftStore
  }))
  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: vi.fn(() => configClient)
  }))
  vi.doMock('@api/SessionClient', () => ({
    createSessionClient: vi.fn(() => sessionClient)
  }))
  vi.doMock('@/lib/startupDeferred', () => ({
    scheduleStartupDeferredTask: vi.fn((task: () => void | Promise<void>) => {
      void task()
      return () => {}
    })
  }))
  vi.doMock('@/composables/useGuidedOnboardingStep', () => ({
    useGuidedOnboardingStep: (stepId: string) => ({
      onboardingState: ref(null),
      currentStepId: ref(stepId === 'first-chat' ? 'first-chat' : null),
      stepState: ref(
        stepId === 'first-chat' ? { id: 'first-chat', status: 'in_progress', required: true } : null
      ),
      showGuide: ref(stepId === 'first-chat'),
      stepIndex: ref(3),
      totalSteps: ref(3),
      canGoPrevious: ref(true),
      dismissGuide: vi.fn(),
      completeStep: vi.fn().mockResolvedValue(null),
      skipStep: vi.fn().mockResolvedValue(null),
      activatePreviousStep: vi.fn().mockResolvedValue(null),
      forceComplete: vi.fn().mockResolvedValue(null)
    })
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key,
      locale: { value: 'zh-CN' }
    })
  }))
  vi.doMock('@/components/chat/ChatInputBox.vue', () => ({
    default: createChatInputBoxStub()
  }))
  vi.doMock('@/components/chat/ChatInputToolbar.vue', () => ({
    default: passthrough('ChatInputToolbar')
  }))
  vi.doMock('@/components/chat/ChatStatusBar.vue', () => ({
    default: passthrough('ChatStatusBar')
  }))
  vi.doMock('@shadcn/components/ui/tooltip', () => ({
    TooltipProvider: passthrough('TooltipProvider')
  }))

  const NewThreadPage = (await import('@/pages/NewThreadPage.vue')).default
  const wrapper = mount(NewThreadPage, {
    attachTo: document.body,
    global: {
      stubs: {
        TooltipProvider: passthrough('TooltipProvider'),
        Button: {
          template: '<button type="button" v-bind="$attrs"><slot /></button>'
        },
        DropdownMenu: true,
        DropdownMenuTrigger: true,
        DropdownMenuContent: true,
        DropdownMenuItem: {
          template: '<button type="button" v-bind="$attrs"><slot /></button>'
        },
        DropdownMenuLabel: true,
        DropdownMenuSeparator: true,
        Icon: true,
        ChatInputToolbar: true,
        ChatStatusBar: true,
        GuidedOnboardingOverlay: defineComponent({
          name: 'GuidedOnboardingOverlay',
          props: {
            visible: {
              type: Boolean,
              default: false
            },
            primaryLabel: {
              type: String,
              default: undefined
            }
          },
          emits: ['primary'],
          template:
            '<button v-if="visible && primaryLabel" data-testid="first-chat-guide-primary" type="button" @click="$emit(\'primary\')">primary</button>'
        })
      }
    }
  })

  await flushPromises()

  return { wrapper }
}

describe('NewThreadPage guided onboarding', () => {
  it('does not render a popup primary action for the first-chat guide', async () => {
    const { wrapper } = await setup()

    expect(wrapper.find('[data-testid="first-chat-guide-primary"]').exists()).toBe(false)
  })
})
