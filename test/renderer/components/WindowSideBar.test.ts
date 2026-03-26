import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

type SetupOptions = {
  groupMode?: 'time' | 'project'
  pinnedSessions?: Array<{ id: string; title: string; status: string; isPinned?: boolean }>
  groups?: Array<{
    label: string
    labelKey?: string
    sessions: Array<{ id: string; title: string; status: string; isPinned?: boolean }>
  }>
  remoteStatus?: {
    enabled: boolean
    state: 'disabled' | 'stopped' | 'starting' | 'running' | 'backoff' | 'error'
  }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

const setup = async (options: SetupOptions = {}) => {
  vi.resetModules()
  vi.useFakeTimers()

  const operations: string[] = []
  const remoteStatus = options.remoteStatus ?? {
    enabled: false,
    state: 'disabled' as const
  }
  const agentStore = reactive({
    selectedAgentId: 'deepchat' as string | null,
    selectedAgentName: 'DeepChat',
    enabledAgents: [{ id: 'acp-a', name: 'ACP A', type: 'acp' as const, enabled: true }],
    setSelectedAgent: vi.fn((id: string | null) => {
      operations.push(`set:${id ?? 'all'}`)
      agentStore.selectedAgentId = id
    })
  })

  const sessionStore = reactive({
    groupMode: (options.groupMode ?? 'time') as 'time' | 'project',
    activeSessionId: 'session-1' as string | null,
    hasActiveSession: true,
    selectSession: vi.fn(async (id: string) => {
      operations.push(`select:${id}`)
      sessionStore.activeSessionId = id
    }),
    closeSession: vi.fn(async () => {
      operations.push('close')
      sessionStore.hasActiveSession = false
      sessionStore.activeSessionId = null
    }),
    renameSession: vi.fn(async (id: string, title: string) => {
      operations.push(`rename:${id}:${title}`)
    }),
    clearSessionMessages: vi.fn(async (id: string) => {
      operations.push(`clear:${id}`)
    }),
    deleteSession: vi.fn(async (id: string) => {
      operations.push(`delete:${id}`)
    }),
    toggleSessionPinned: vi.fn(async (id: string, pinned: boolean) => {
      operations.push(`pin:${id}:${pinned}`)
    }),
    toggleGroupMode: vi.fn(),
    getPinnedSessions: vi.fn(() => options.pinnedSessions ?? []),
    getFilteredGroups: vi.fn(() => options.groups ?? [])
  })

  const themeStore = reactive({
    isDark: false
  })
  const windowPresenter = {
    openOrFocusSettingsWindow: vi.fn(),
    createSettingsWindow: vi.fn().mockResolvedValue(99),
    getSettingsWindowId: vi.fn().mockReturnValue(99),
    sendToWindow: vi.fn(),
    show: vi.fn()
  }
  const remoteControlPresenter = {
    getChannelStatus: vi.fn(async (channel: 'telegram' | 'feishu') =>
      channel === 'telegram'
        ? {
            channel: 'telegram' as const,
            enabled: remoteStatus.enabled,
            state: remoteStatus.state,
            pollOffset: 0,
            bindingCount: 0,
            allowedUserCount: 0,
            lastError: null,
            botUser: null
          }
        : {
            channel: 'feishu' as const,
            enabled: false,
            state: 'disabled' as const,
            bindingCount: 0,
            pairedUserCount: 0,
            lastError: null,
            botUser: null
          }
    ),
    getTelegramStatus: vi.fn().mockResolvedValue({
      enabled: remoteStatus.enabled,
      state: remoteStatus.state,
      pollOffset: 0,
      bindingCount: 0,
      allowedUserCount: 0,
      lastError: null,
      botUser: null
    })
  }

  vi.doMock('@/stores/ui/agent', () => ({
    useAgentStore: () => agentStore
  }))
  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => sessionStore
  }))
  vi.doMock('@/stores/theme', () => ({
    useThemeStore: () => themeStore
  }))
  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: () => windowPresenter,
    useRemoteControlPresenter: () => remoteControlPresenter
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  const passthrough = defineComponent({
    template: '<div><slot /></div>'
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

  const buttonStub = defineComponent({
    emits: ['click'],
    template: '<button @click="$emit(\'click\', $event)"><slot /></button>'
  })

  const inputStub = defineComponent({
    props: {
      modelValue: {
        type: String,
        default: ''
      }
    },
    emits: ['update:modelValue'],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  })

  const contextMenuItemStub = defineComponent({
    emits: ['select'],
    template: '<button type="button" @click="$emit(\'select\')"><slot /></button>'
  })

  const WindowSideBar = (await import('@/components/WindowSideBar.vue')).default
  const wrapper = mount(WindowSideBar, {
    global: {
      stubs: {
        TooltipProvider: passthrough,
        Tooltip: passthrough,
        TooltipContent: passthrough,
        TooltipTrigger: passthrough,
        ContextMenu: passthrough,
        ContextMenuTrigger: passthrough,
        ContextMenuContent: passthrough,
        ContextMenuSeparator: passthrough,
        ContextMenuItem: contextMenuItemStub,
        Dialog: dialogStub,
        DialogContent: passthrough,
        DialogDescription: passthrough,
        DialogFooter: passthrough,
        DialogHeader: passthrough,
        DialogTitle: passthrough,
        Button: buttonStub,
        Input: inputStub,
        Icon: true,
        ModelIcon: true
      }
    }
  })

  await flushPromises()

  return { wrapper, operations, agentStore, sessionStore, windowPresenter, remoteControlPresenter }
}

describe('WindowSideBar agent switch', () => {
  it('closes active session before applying selected agent', async () => {
    const { wrapper, operations, agentStore, sessionStore } = await setup()

    await (wrapper.vm as any).handleAgentSelect('acp-a')

    expect(sessionStore.closeSession).toHaveBeenCalledTimes(1)
    expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('acp-a')
    expect(operations).toEqual(['close', 'set:acp-a'])
  }, 10000)

  it('renders pinned sessions outside grouped sections', async () => {
    const { wrapper } = await setup({
      pinnedSessions: [
        {
          id: 'pinned-1',
          title: 'Pinned Session',
          status: 'none'
        }
      ],
      groups: [
        {
          label: 'common.time.today',
          labelKey: 'common.time.today',
          sessions: [
            {
              id: 'normal-1',
              title: 'Normal Session',
              status: 'none'
            }
          ]
        }
      ]
    })

    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Pinned Session')
    expect(wrapper.text()).toContain('chat.sidebar.pinned')
    expect(wrapper.text()).toContain('common.time.today')
    expect(wrapper.text()).toContain('Normal Session')
  }, 10000)

  it('collapses and expands pinned sessions from the pinned folder header', async () => {
    const { wrapper } = await setup({
      pinnedSessions: [
        {
          id: 'pinned-1',
          title: 'Pinned Session',
          status: 'none'
        }
      ]
    })

    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('chat.sidebar.pinned')
    expect(wrapper.text()).toContain('Pinned Session')

    await wrapper.find('[data-group-id="__pinned__"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).not.toContain('Pinned Session')

    await wrapper.find('[data-group-id="__pinned__"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Pinned Session')
  }, 10000)

  it('toggles pinned state from a session item action', async () => {
    const session = {
      id: 'normal-1',
      title: 'Normal Session',
      status: 'none',
      isPinned: false
    }
    const { wrapper, sessionStore } = await setup({
      groups: [
        {
          label: 'common.time.today',
          labelKey: 'common.time.today',
          sessions: [session]
        }
      ]
    })

    const item = wrapper.findComponent({ name: 'WindowSideBarSessionItem' })
    item.vm.$emit('toggle-pin', session)
    await flushPromises()

    expect(sessionStore.toggleSessionPinned).toHaveBeenCalledWith('normal-1', true)
  }, 10000)

  it('collapses and expands time groups from the folder header', async () => {
    const { wrapper } = await setup({
      groups: [
        {
          label: 'common.time.today',
          labelKey: 'common.time.today',
          sessions: [
            {
              id: 'time-1',
              title: 'Today Session',
              status: 'none'
            }
          ]
        }
      ]
    })

    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('common.time.today')
    expect(wrapper.text()).toContain('Today Session')

    await wrapper.find('[data-group-id="common.time.today"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).not.toContain('Today Session')

    await wrapper.find('[data-group-id="common.time.today"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Today Session')
  }, 10000)

  it('collapses and expands project groups from the folder header', async () => {
    const { wrapper } = await setup({
      groupMode: 'project',
      groups: [
        {
          label: 'DeepChat',
          sessions: [
            {
              id: 'project-1',
              title: 'Project Session',
              status: 'none'
            }
          ]
        }
      ]
    })

    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('DeepChat')
    expect(wrapper.text()).toContain('Project Session')

    await wrapper.find('[data-group-id="DeepChat"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).not.toContain('Project Session')

    await wrapper.find('[data-group-id="DeepChat"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Project Session')
  }, 10000)

  it('opens the delete dialog and dispatches delete actions', async () => {
    const session = {
      id: 'normal-1',
      title: 'Normal Session',
      status: 'none',
      isPinned: false
    }
    const { wrapper, sessionStore } = await setup({
      groups: [
        {
          label: 'common.time.today',
          labelKey: 'common.time.today',
          sessions: [session]
        }
      ]
    })

    const item = wrapper.findComponent({ name: 'WindowSideBarSessionItem' })

    item.vm.$emit('delete', session)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('dialog.delete.title')

    await (wrapper.vm as any).handleDeleteConfirm()
    expect(sessionStore.deleteSession).toHaveBeenCalledWith('normal-1')
  }, 10000)

  it('shows the remote control button only when remote control is enabled', async () => {
    const enabledSetup = await setup({
      remoteStatus: {
        enabled: true,
        state: 'starting'
      }
    })

    const button = enabledSetup.wrapper.find('[data-testid=\"remote-control-button\"]')

    expect(button.exists()).toBe(true)
    expect(button.classes().join(' ')).toContain('border-emerald-500/40')
    expect(enabledSetup.wrapper.text()).toContain('chat.sidebar.remoteControlStatus.starting')
    expect(enabledSetup.wrapper.html()).toContain('animate-pulse')

    enabledSetup.wrapper.unmount()

    const disabledSetup = await setup({
      remoteStatus: {
        enabled: false,
        state: 'disabled'
      }
    })

    expect(disabledSetup.wrapper.find('[data-testid=\"remote-control-button\"]').exists()).toBe(
      false
    )

    disabledSetup.wrapper.unmount()
  })

  it('opens settings and navigates to remote settings when remote button is clicked', async () => {
    const { wrapper, windowPresenter } = await setup({
      remoteStatus: {
        enabled: true,
        state: 'running'
      }
    })

    await wrapper.find('[data-testid=\"remote-control-button\"]').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(250)

    expect(windowPresenter.createSettingsWindow).toHaveBeenCalledTimes(1)
    expect(windowPresenter.sendToWindow).toHaveBeenNthCalledWith(1, 99, 'settings:navigate', {
      routeName: 'settings-remote'
    })
    expect(windowPresenter.sendToWindow).toHaveBeenNthCalledWith(2, 99, 'settings:navigate', {
      routeName: 'settings-remote'
    })

    wrapper.unmount()
  })
})
