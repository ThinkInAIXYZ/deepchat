import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

type EnvironmentFixture = {
  path: string
  name: string
  sessionCount: number
  lastUsedAt: number
  isTemp: boolean
  exists: boolean
  status?: 'active' | 'archived'
  sortOrder?: number
  archivedAt?: number | null
  removedAt?: number | null
}

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

const draggableStub = defineComponent({
  name: 'draggable',
  props: {
    modelValue: {
      type: Array,
      default: () => []
    }
  },
  emits: ['update:modelValue'],
  template:
    '<div data-testid="draggable"><slot v-for="item in modelValue" name="item" :element="item" /></div>'
})

const dialogStub = defineComponent({
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  template: '<div v-if="open"><slot /></div>'
})

const dropdownItemStub = defineComponent({
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['select'],
  template:
    '<button type="button" :disabled="disabled" @click="$emit(\'select\')"><slot /></button>'
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
    case 'settings.environments.tabs.active':
      return `Active (${params?.count ?? 0})`
    case 'settings.environments.tabs.archived':
      return `Archived (${params?.count ?? 0})`
    case 'settings.environments.actions.more':
      return 'More'
    case 'settings.environments.actions.dragTarget':
      return `Drag ${params?.name ?? ''}`
    case 'settings.environments.actions.moveTop':
      return 'Move Top'
    case 'settings.environments.actions.moveUp':
      return 'Move Up'
    case 'settings.environments.actions.moveDown':
      return 'Move Down'
    case 'settings.environments.actions.moveBottom':
      return 'Move Bottom'
    case 'settings.environments.actions.archive':
      return 'Archive'
    case 'settings.environments.actions.restore':
      return 'Restore'
    case 'settings.environments.actions.remove':
      return 'Remove from DeepChat'
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
    case 'settings.environments.meta.archivedAt':
      return `Archived: ${params?.value ?? 'never'}`
    case 'settings.environments.meta.never':
      return 'Never'
    case 'settings.environments.empty.regular':
      return 'No environments to show'
    case 'settings.environments.empty.temp':
      return 'No temp environments'
    case 'settings.environments.empty.archived':
      return 'No archived environments'
    case 'settings.environments.confirm.archiveTitle':
      return `Archive ${params?.name ?? ''}?`
    case 'settings.environments.confirm.archiveDescription':
      return 'Archive keeps sessions'
    case 'settings.environments.confirm.removeTitle':
      return `Remove ${params?.name ?? ''}?`
    case 'settings.environments.confirm.removeDescription':
      return 'Remove keeps files'
    case 'settings.environments.errors.openTitle':
      return 'Open failed'
    case 'settings.environments.errors.reorderTitle':
      return 'Reorder failed'
    case 'settings.environments.errors.archiveTitle':
      return 'Archive failed'
    case 'settings.environments.errors.restoreTitle':
      return 'Restore failed'
    case 'settings.environments.errors.removeTitle':
      return 'Remove failed'
    case 'common.cancel':
      return 'Cancel'
    default:
      return key
  }
}

async function setup(overrides?: {
  defaultProjectPath?: string | null
  pathExists?: boolean
  environments?: EnvironmentFixture[]
  archivedEnvironments?: EnvironmentFixture[]
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
        exists: true,
        status: 'active',
        sortOrder: 0,
        archivedAt: null,
        removedAt: null
      },
      {
        path: '/system/temp/deepchat-agent/workspaces/tmp-1',
        name: 'tmp-1',
        sessionCount: 1,
        lastUsedAt: 1700000001000,
        isTemp: true,
        exists: true,
        status: 'active',
        sortOrder: 1,
        archivedAt: null,
        removedAt: null
      }
    ],
    archivedEnvironments: overrides?.archivedEnvironments ?? [],
    refreshEnvironmentData: vi.fn().mockResolvedValue(undefined),
    openDirectory: vi.fn().mockResolvedValue(undefined),
    setDefaultProject: vi.fn().mockResolvedValue(undefined),
    clearDefaultProject: vi.fn().mockResolvedValue(undefined),
    reorderEnvironments: vi.fn().mockResolvedValue(undefined),
    archiveEnvironment: vi.fn().mockResolvedValue(undefined),
    restoreEnvironment: vi.fn().mockResolvedValue(undefined),
    removeEnvironment: vi.fn().mockResolvedValue({ clearedSessionIds: [] })
  })
  const projectClient = {
    pathExists: vi.fn().mockResolvedValue(overrides?.pathExists ?? true)
  }

  vi.doMock('@/stores/ui/project', () => ({
    useProjectStore: () => projectStore
  }))
  vi.doMock('@api/ProjectClient', () => ({
    createProjectClient: () => projectClient
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
  vi.doMock('vuedraggable', () => ({
    default: draggableStub
  }))
  vi.doMock('@shadcn/components/ui/dropdown-menu', () => ({
    DropdownMenu: passthrough('DropdownMenu'),
    DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
    DropdownMenuContent: passthrough('DropdownMenuContent'),
    DropdownMenuItem: dropdownItemStub,
    DropdownMenuSeparator: passthrough('DropdownMenuSeparator')
  }))
  vi.doMock('@shadcn/components/ui/dialog', () => ({
    Dialog: dialogStub,
    DialogContent: passthrough('DialogContent'),
    DialogDescription: passthrough('DialogDescription'),
    DialogFooter: passthrough('DialogFooter'),
    DialogHeader: passthrough('DialogHeader'),
    DialogTitle: passthrough('DialogTitle')
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
        draggable: draggableStub,
        Icon: passthrough('Icon')
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    projectStore,
    projectClient,
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
    const openButton = regularCardButtons.find(
      (button) => button.attributes('aria-label') === 'Open'
    )
    const setDefaultButton = regularCardButtons.find(
      (button) => button.attributes('aria-label') === 'Set Default'
    )

    expect(openButton).toBeTruthy()
    expect(setDefaultButton).toBeTruthy()

    await openButton!.trigger('click')
    await setDefaultButton!.trigger('click')
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

    const setDefaultButton = wrapper
      .get('[data-testid="environment-row"]')
      .findAll('button')
      .find((button) => button.attributes('aria-label') === 'Set Default')

    expect(setDefaultButton).toBeTruthy()
    expect(setDefaultButton!.attributes('disabled')).toBeDefined()

    await setDefaultButton!.trigger('click')

    expect(projectStore.setDefaultProject).not.toHaveBeenCalled()
  })

  it('persists reordered visible environments without dropping hidden entries', async () => {
    const appEnvironment = {
      path: '/work/app',
      name: 'app',
      sessionCount: 1,
      lastUsedAt: 100,
      isTemp: false,
      exists: true,
      status: 'active' as const,
      sortOrder: 0,
      archivedAt: null,
      removedAt: null
    }
    const missingEnvironment = {
      path: '/work/missing',
      name: 'missing',
      sessionCount: 1,
      lastUsedAt: 200,
      isTemp: false,
      exists: false,
      status: 'active' as const,
      sortOrder: 1,
      archivedAt: null,
      removedAt: null
    }
    const betaEnvironment = {
      path: '/work/beta',
      name: 'beta',
      sessionCount: 1,
      lastUsedAt: 300,
      isTemp: false,
      exists: true,
      status: 'active' as const,
      sortOrder: 2,
      archivedAt: null,
      removedAt: null
    }
    const { wrapper, projectStore } = await setup({
      environments: [appEnvironment, missingEnvironment, betaEnvironment]
    })

    wrapper
      .getComponent({ name: 'draggable' })
      .vm.$emit('update:modelValue', [betaEnvironment, appEnvironment])
    await flushPromises()

    expect(projectStore.reorderEnvironments).toHaveBeenCalledWith([
      '/work/beta',
      '/work/missing',
      '/work/app'
    ])
  })

  it('shows a toast when reordered environments fail to persist', async () => {
    const appEnvironment = {
      path: '/work/app',
      name: 'app',
      sessionCount: 1,
      lastUsedAt: 100,
      isTemp: false,
      exists: true,
      status: 'active' as const,
      sortOrder: 0,
      archivedAt: null,
      removedAt: null
    }
    const betaEnvironment = {
      path: '/work/beta',
      name: 'beta',
      sessionCount: 1,
      lastUsedAt: 300,
      isTemp: false,
      exists: true,
      status: 'active' as const,
      sortOrder: 1,
      archivedAt: null,
      removedAt: null
    }
    const { wrapper, projectStore, toast } = await setup({
      environments: [appEnvironment, betaEnvironment]
    })
    projectStore.reorderEnvironments.mockRejectedValueOnce(new Error('reorder failed'))

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Move Down')!
      .trigger('click')
    await flushPromises()

    expect(toast).toHaveBeenCalledWith({
      title: 'Reorder failed',
      description: 'reorder failed',
      variant: 'destructive'
    })
  })

  it('archives an active environment after confirmation', async () => {
    const { wrapper, projectStore } = await setup()
    const archiveMenuItem = wrapper.findAll('button').find((button) => button.text() === 'Archive')

    expect(archiveMenuItem).toBeTruthy()
    await archiveMenuItem!.trigger('click')
    await flushPromises()

    const archiveButtons = wrapper.findAll('button').filter((button) => button.text() === 'Archive')
    expect(archiveButtons.length).toBeGreaterThan(1)

    await archiveButtons[archiveButtons.length - 1].trigger('click')
    await flushPromises()

    expect(projectStore.archiveEnvironment).toHaveBeenCalledWith('/work/app')
  })

  it('restores archived environments from the archived tab', async () => {
    const { wrapper, projectStore } = await setup({
      archivedEnvironments: [
        {
          path: '/work/old',
          name: 'old',
          sessionCount: 3,
          lastUsedAt: 500,
          isTemp: false,
          exists: true,
          status: 'archived',
          sortOrder: 0,
          archivedAt: 600,
          removedAt: null
        }
      ]
    })

    await wrapper.get('[data-testid="environments-archived-tab"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.environment-folder-drag-target').exists()).toBe(false)

    await wrapper.get('button[aria-label="Restore"]').trigger('click')
    await flushPromises()

    expect(projectStore.restoreEnvironment).toHaveBeenCalledWith('/work/old')
  })

  it('removes an archived environment after confirmation', async () => {
    const { wrapper, projectStore } = await setup({
      archivedEnvironments: [
        {
          path: '/work/old',
          name: 'old',
          sessionCount: 3,
          lastUsedAt: 500,
          isTemp: false,
          exists: true,
          status: 'archived',
          sortOrder: 0,
          archivedAt: 600,
          removedAt: null
        }
      ]
    })

    await wrapper.get('[data-testid="environments-archived-tab"]').trigger('click')
    await flushPromises()

    const removeMenuItem = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Remove from DeepChat')

    expect(removeMenuItem).toBeTruthy()
    await removeMenuItem!.trigger('click')
    await flushPromises()

    const removeButtons = wrapper
      .findAll('button')
      .filter((button) => button.text() === 'Remove from DeepChat')
    expect(removeButtons.length).toBeGreaterThan(1)

    await removeButtons[removeButtons.length - 1].trigger('click')
    await flushPromises()

    expect(projectStore.removeEnvironment).toHaveBeenCalledWith('/work/old')
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
