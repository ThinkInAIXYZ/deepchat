import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const buttonStub = defineComponent({
  name: 'Button',
  inheritAttrs: false,
  props: { disabled: Boolean },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
})

const settingsPageShellStub = defineComponent({
  name: 'SettingsPageShell',
  inheritAttrs: false,
  template: '<main v-bind="$attrs"><slot /></main>'
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
const upgradeStoreMock = reactive({
  isMockUpdate: false,
  refreshStatus: vi.fn()
})

vi.mock('@api/DebugClient', () => ({ createDebugClient: () => debugClientMock }))
vi.mock('@api/UpgradeClient', () => ({ createUpgradeClient: () => upgradeClientMock }))
vi.mock('@api/WindowClient', () => ({ createWindowClient: () => windowClientMock }))
vi.mock('@/stores/upgrade', () => ({ useUpgradeStore: () => upgradeStoreMock }))
vi.mock('@/components/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: { title?: string; count?: number }) => {
      const messages: Record<string, string> = {
        'routes.settings-debug': '调试',
        'settings.debug.description': '仅开发环境可用',
        'settings.controlCenter.groups.system': '系统',
        'settings.debug.guidance.title': '调试工具',
        'settings.debug.guidance.description': '用于本地调试',
        'about.mockOnboardingButton': '模拟首次进入引导',
        'about.mockChatButton': '创建长会话Mock数据',
        'about.mockChatCreating': '创建中...',
        'about.mockUpdateButton': '模拟已下载更新',
        'about.clearMockUpdateButton': '清除模拟更新',
        'about.mockChatCreated': 'Mock会话已创建',
        'about.mockChatCreatedDesc': `已创建${params?.title ?? ''}，共${params?.count ?? ''}条消息`,
        'about.mockChatCreateUnavailable': 'Mock会话只在开发模式可用',
        'about.mockChatCreateFailed': '创建Mock会话失败',
        'settings.debug.unavailableDescription': '当前不可用',
        'settings.debug.guidance.failed': '操作失败',
        'common.error.operationFailed': '操作失败'
      }
      return messages[key] ?? key
    }
  })
}))

describe('DebugSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upgradeStoreMock.isMockUpdate = false
    upgradeStoreMock.refreshStatus.mockResolvedValue(undefined)
    windowClientMock.startGuidedOnboarding.mockResolvedValue({ started: true, focused: true })
    debugClientMock.createMockChatSession.mockResolvedValue({
      created: true,
      sessionId: 'debug-long-chat-test',
      title: 'Debug long chat test',
      messageCount: 200
    })
    upgradeClientMock.mockDownloadedUpdate.mockResolvedValue(true)
    upgradeClientMock.clearMockUpdate.mockResolvedValue(true)
  })

  const mountPage = async () => {
    const { default: DebugSettings } =
      await import('../../../src/renderer/settings/components/DebugSettings.vue')
    return mount(DebugSettings, {
      global: {
        stubs: {
          Button: buttonStub,
          Icon: true,
          Spinner: true,
          SettingsPageShell: settingsPageShellStub
        }
      }
    })
  }

  it('renders debug controls and refreshes update status on mount', async () => {
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.get('[data-testid="settings-debug-page"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('模拟首次进入引导')
    expect(wrapper.text()).toContain('创建长会话Mock数据')
    expect(wrapper.text()).toContain('模拟已下载更新')
    expect(upgradeStoreMock.refreshStatus).toHaveBeenCalledTimes(1)
  })

  it('runs onboarding, creates mock chat with pending state, and shows success feedback', async () => {
    let resolveMockChat!: (value: {
      created: boolean
      sessionId: string
      title: string
      messageCount: number
    }) => void
    debugClientMock.createMockChatSession.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMockChat = resolve
      })
    )
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('button').trigger('click')
    expect(windowClientMock.startGuidedOnboarding).toHaveBeenCalledTimes(1)

    const chatButton = wrapper
      .findAll('button')
      .find((button) => button.text() === '创建长会话Mock数据')
    await chatButton!.trigger('click')
    await nextTick()
    expect(chatButton!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('创建中...')

    resolveMockChat({
      created: true,
      sessionId: 'debug-long-chat-test',
      title: 'Debug long chat test',
      messageCount: 200
    })
    await flushPromises()
    expect(toastMock).toHaveBeenCalledWith({
      title: 'Mock会话已创建',
      description: '已创建Debug long chat test，共200条消息'
    })
  })

  it('prevents duplicate debug actions while an action is running', async () => {
    let resolveOnboarding!: (value: { started: boolean; focused: boolean }) => void
    windowClientMock.startGuidedOnboarding.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOnboarding = resolve
      })
    )
    const wrapper = await mountPage()
    await flushPromises()

    const onboardingButton = wrapper.get('button')
    await onboardingButton.trigger('click')
    await nextTick()

    expect(onboardingButton.attributes('disabled')).toBeDefined()
    expect(windowClientMock.startGuidedOnboarding).toHaveBeenCalledTimes(1)

    resolveOnboarding({ started: true, focused: true })
    await flushPromises()
    expect(onboardingButton.attributes('disabled')).toBeUndefined()
  })

  it('switches update action between create and clear based on mock state', async () => {
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '模拟已下载更新')!
      .trigger('click')
    expect(upgradeClientMock.mockDownloadedUpdate).toHaveBeenCalledTimes(1)

    upgradeStoreMock.isMockUpdate = true
    await nextTick()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '清除模拟更新')!
      .trigger('click')
    expect(upgradeClientMock.clearMockUpdate).toHaveBeenCalledTimes(1)
  })
})
