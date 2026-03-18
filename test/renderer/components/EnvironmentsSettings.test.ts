import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
})

const switchStub = defineComponent({
  name: 'Switch',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue'],
  template:
    '<button role="switch" :aria-checked="String(modelValue)" v-bind="$attrs" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>'
})

const createTranslator = () => (key: string, params?: Record<string, unknown>) => {
  switch (key) {
    case 'routes.settings-environments':
      return 'Environments'
    case 'settings.environments.title':
      return 'Environments'
    case 'settings.environments.description':
      return 'Environment settings'
    case 'settings.environments.default.title':
      return 'Default directory'
    case 'settings.environments.default.description':
      return 'Used for new chats'
    case 'settings.environments.default.empty':
      return 'No default directory'
    case 'settings.environments.history.title':
      return 'History'
    case 'settings.environments.history.description':
      return 'Session-used directories'
    case 'settings.environments.temp.title':
      return 'Temp directories'
    case 'settings.environments.temp.description':
      return 'Hidden by default'
    case 'settings.environments.actions.refresh':
      return 'Refresh'
    case 'settings.environments.actions.showMissing':
      return 'Show Missing'
    case 'settings.environments.actions.open':
      return 'Open'
    case 'settings.environments.actions.setDefault':
      return 'Set Default'
    case 'settings.environments.actions.clearDefault':
      return 'Clear Default'
    case 'settings.environments.actions.showTemp':
      return 'Show Temp'
    case 'settings.environments.actions.hideTemp':
      return 'Hide Temp'
    case 'settings.environments.badges.default':
      return 'Default'
    case 'settings.environments.badges.temp':
      return 'Temp'
    case 'settings.environments.badges.missing':
      return 'Missing'
    case 'settings.environments.badges.notInHistory':
      return 'Not in history'
    case 'settings.environments.meta.sessions':
      return `${params?.count ?? 0} sessions`
    case 'settings.environments.meta.lastUsed':
      return `Last used: ${params?.value ?? 'never'}`
    case 'settings.environments.meta.never':
      return 'Never'
    case 'settings.environments.empty.regular':
      return 'No environments to show'
    case 'settings.environments.empty.temp':
      return 'No temp environments'
    case 'settings.environments.errors.openTitle':
      return 'Open failed'
    default:
      return key
  }
}

async function setup(overrides?: {
  defaultProjectPath?: string | null
  pathExists?: boolean
  environments?: Array<{
    path: string
    name: string
    sessionCount: number
    lastUsedAt: number
    isTemp: boolean
    exists: boolean
  }>
}) {
  vi.resetModules()

  const toast = vi.fn()
  const projectStore = reactive({
    defaultProjectPath:
      overrides && 'defaultProjectPath' in overrides
        ? (overrides.defaultProjectPath ?? null)
        : null,
    environments: overrides?.environments ?? [
      {
        path: '/work/app',
        name: 'app',
        sessionCount: 2,
        lastUsedAt: 1700000000000,
        isTemp: false,
        exists: true
      },
      {
        path: '/system/temp/deepchat-agent/workspaces/tmp-1',
        name: 'tmp-1',
        sessionCount: 1,
        lastUsedAt: 1700000001000,
        isTemp: true,
        exists: true
      }
    ],
    refreshEnvironmentData: vi.fn().mockResolvedValue(undefined),
    openDirectory: vi.fn().mockResolvedValue(undefined),
    setDefaultProject: vi.fn().mockResolvedValue(undefined),
    clearDefaultProject: vi.fn().mockResolvedValue(undefined)
  })

  vi.doMock('@/stores/ui/project', () => ({
    useProjectStore: () => projectStore
  }))
  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: () => ({
      pathExists: vi.fn().mockResolvedValue(overrides?.pathExists ?? true)
    })
  }))
  vi.doMock('@/components/use-toast', () => ({
    useToast: () => ({ toast })
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: createTranslator(),
      locale: { value: 'en-US' }
    })
  }))

  const EnvironmentsSettings = (
    await import('../../../src/renderer/settings/components/EnvironmentsSettings.vue')
  ).default

  const wrapper = mount(EnvironmentsSettings, {
    global: {
      stubs: {
        ScrollArea: passthrough('ScrollArea'),
        Button: buttonStub,
        Switch: switchStub,
        Icon: passthrough('Icon')
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    projectStore,
    toast
  }
}

describe('EnvironmentsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders non-temp environments by default and refreshes on mount', async () => {
    const { wrapper, projectStore } = await setup()

    expect(projectStore.refreshEnvironmentData).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('[data-testid="environment-row"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('app')
    expect(wrapper.text()).not.toContain('tmp-1')
    expect(wrapper.get('[data-testid="missing-toggle"]').attributes('aria-checked')).toBe('false')
  })

  it('keeps the current default visible even when it is a temp directory', async () => {
    const { wrapper } = await setup({
      defaultProjectPath: '/system/temp/deepchat-agent/workspaces/tmp-1'
    })

    expect(wrapper.findAll('[data-testid="environment-row"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('tmp-1')
    expect(wrapper.get('button[aria-label="Clear Default"]').exists()).toBe(true)
  })

  it('dispatches open and set default actions from an item', async () => {
    const { wrapper, projectStore } = await setup()
    const regularCardButtons = wrapper.get('[data-testid="environment-row"]').findAll('button')

    await regularCardButtons[0].trigger('click')
    await regularCardButtons[1].trigger('click')
    await flushPromises()

    expect(projectStore.openDirectory).toHaveBeenCalledWith('/work/app')
    expect(projectStore.setDefaultProject).toHaveBeenCalledWith('/work/app')
  })

  it('dispatches clear default from the default item', async () => {
    const { wrapper, projectStore } = await setup({
      defaultProjectPath: '/work/app'
    })
    const clearDefaultButton = wrapper.get('button[aria-label="Clear Default"]')

    await clearDefaultButton.trigger('click')

    expect(projectStore.clearDefaultProject).toHaveBeenCalledTimes(1)
  })

  it('shows a missing environment only after enabling the missing filter', async () => {
    const { wrapper } = await setup({
      environments: [
        {
          path: '/work/app',
          name: 'app',
          sessionCount: 1,
          lastUsedAt: 100,
          isTemp: false,
          exists: true
        },
        {
          path: '/work/missing',
          name: 'missing',
          sessionCount: 1,
          lastUsedAt: 200,
          isTemp: false,
          exists: false
        }
      ]
    })

    expect(wrapper.text()).not.toContain('missing')
    expect(wrapper.findAll('[data-testid="environment-row"]')).toHaveLength(1)

    await wrapper.get('[data-testid="missing-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('missing')
    expect(wrapper.text()).toContain('Missing')
    expect(wrapper.findAll('[data-testid="environment-row"]')).toHaveLength(2)
  })

  it('does not allow setting a missing environment as default', async () => {
    const { wrapper, projectStore } = await setup({
      environments: [
        {
          path: '/work/missing',
          name: 'missing',
          sessionCount: 1,
          lastUsedAt: 200,
          isTemp: false,
          exists: false
        }
      ]
    })

    await wrapper.get('[data-testid="missing-toggle"]').trigger('click')
    await flushPromises()

    const buttons = wrapper.get('[data-testid="environment-row"]').findAll('button')

    expect(buttons[1].attributes('disabled')).toBeDefined()

    await buttons[1].trigger('click')

    expect(projectStore.setDefaultProject).not.toHaveBeenCalled()
  })

  it('keeps synthetic defaults visible and hides missing history by default', async () => {
    const { wrapper } = await setup({
      defaultProjectPath: '/work/missing-default',
      environments: [
        {
          path: '/work/app',
          name: 'app',
          sessionCount: 1,
          lastUsedAt: 0,
          isTemp: false,
          exists: false
        }
      ]
    })

    expect(wrapper.text()).toContain('Not in history')
    expect(wrapper.text()).not.toContain('/work/app')
  })

  it('hides missing synthetic defaults until the missing filter is enabled', async () => {
    const { wrapper } = await setup({
      defaultProjectPath: '/work/missing-default',
      pathExists: false,
      environments: []
    })

    expect(wrapper.text()).not.toContain('/work/missing-default')
    expect(wrapper.find('[data-testid="environments-empty"]').exists()).toBe(true)

    await wrapper.get('[data-testid="missing-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('/work/missing-default')
    expect(wrapper.text()).toContain('Missing')
    expect(wrapper.text()).toContain('Not in history')
  })

  it('renders empty states when no environments are available', async () => {
    const { wrapper } = await setup({
      defaultProjectPath: null,
      environments: [
        {
          path: '/system/temp/deepchat-agent/workspaces/tmp-1',
          name: 'tmp-1',
          sessionCount: 1,
          lastUsedAt: 1700000001000,
          isTemp: true,
          exists: true
        }
      ]
    })

    expect(wrapper.get('[data-testid="environments-empty"]').text()).toContain(
      'No environments to show'
    )
    expect(wrapper.text()).not.toContain('tmp-1')
  })
})
