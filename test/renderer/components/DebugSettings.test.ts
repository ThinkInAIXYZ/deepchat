import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>'
})

const passthroughStub = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const debugClientMock = vi.hoisted(() => ({
  createMockChatSession: vi.fn()
}))
const upgradeClientMock = vi.hoisted(() => ({
  mockDownloadedUpdate: vi.fn(),
  clearMockUpdate: vi.fn()
}))
const windowClientMock = vi.hoisted(() => ({
  startGuidedOnboarding: vi.fn()
}))
const toastMock = vi.hoisted(() => vi.fn())

const upgradeStoreMock = {
  isMockUpdate: false,
  refreshStatus: vi.fn()
}

vi.mock('@api/DebugClient', () => ({
  createDebugClient: () => debugClientMock
}))
vi.mock('@api/UpgradeClient', () => ({
  createUpgradeClient: () => upgradeClientMock
}))
vi.mock('@api/WindowClient', () => ({
  createWindowClient: () => windowClientMock
}))
vi.mock('@/stores/upgrade', () => ({
  useUpgradeStore: () => upgradeStoreMock
}))
vi.mock('@/components/use-toast', () => ({
  useToast: () => ({ toast: toastMock })
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: { title?: string; count?: number }) => {
      const messages: Record<string, string> = {
        'routes.settings-debug': 'Debug',
        'settings.debug.description': 'Development-only tools',
        'settings.controlCenter.groups.system': 'System',
        'settings.debug.guidance.title': 'Guidance and data',
        'settings.debug.guidance.description': 'Create development mocks',
        'settings.debug.guidance.failed': 'Unable to start the debug guided flow.',
        'settings.debug.unavailableDescription':
          'This action is available only in development mode.',
        'common.error.operationFailed': 'Operation failed',
        'about.mockOnboardingButton': 'Start mock onboarding',
        'about.mockChatButton': 'Create mock chat',
        'about.mockChatCreating': 'Creating...',
        'about.mockChatCreated': 'Mock chat created',
        'about.mockChatCreatedDesc': `Created ${params?.title ?? ''} with ${params?.count ?? ''} messages`,
        'about.mockChatCreateUnavailable': 'Mock chat unavailable',
        'about.mockChatCreateFailed': 'Unable to create mock chat',
        'about.mockUpdateButton': 'Mock downloaded update',
        'about.clearMockUpdateButton': 'Clear mock update'
      }
      return messages[key] ?? key
    }
  })
}))

describe('DebugSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(upgradeStoreMock, {
      isMockUpdate: false,
      refreshStatus: vi.fn().mockResolvedValue(undefined)
    })
    debugClientMock.createMockChatSession.mockResolvedValue({
      created: true,
      sessionId: 'debug-long-chat-test',
      title: 'Debug long chat test',
      messageCount: 200
    })
    upgradeClientMock.mockDownloadedUpdate.mockResolvedValue(true)
    upgradeClientMock.clearMockUpdate.mockResolvedValue(true)
    windowClientMock.startGuidedOnboarding.mockResolvedValue({ started: true, focused: true })
  })

  const mountSettings = async () => {
    const { default: DebugSettings } =
      await import('../../../src/renderer/settings/components/DebugSettings.vue')
    return mount(DebugSettings, {
      global: {
        stubs: {
          Button: buttonStub,
          Icon: true,
          Spinner: true,
          SettingsPageShell: passthroughStub('SettingsPageShell')
        }
      }
    })
  }

  it('renders the development mock controls and refreshes update status', async () => {
    const wrapper = await mountSettings()
    await flushPromises()

    expect(wrapper.attributes('data-testid')).toBe('settings-debug-page')
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
      'Start mock onboarding',
      'Create mock chat',
      'Mock downloaded update'
    ])
    expect(upgradeStoreMock.refreshStatus).toHaveBeenCalledTimes(1)
  })

  it('invokes the debug clients and reports a created mock chat', async () => {
    const wrapper = await mountSettings()
    await flushPromises()

    const buttons = wrapper.findAll('button')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    await buttons[2]!.trigger('click')
    await flushPromises()

    expect(windowClientMock.startGuidedOnboarding).toHaveBeenCalledTimes(1)
    expect(debugClientMock.createMockChatSession).toHaveBeenCalledTimes(1)
    expect(upgradeClientMock.mockDownloadedUpdate).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith({
      title: 'Mock chat created',
      description: 'Created Debug long chat test with 200 messages'
    })
  })
})
