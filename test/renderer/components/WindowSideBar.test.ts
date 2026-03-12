import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { mount } from '@vue/test-utils'

type SetupOptions = {
  pinnedSessions?: Array<{ id: string; title: string; status: string; isPinned?: boolean }>
  groups?: Array<{
    label: string
    labelKey?: string
    sessions: Array<{ id: string; title: string; status: string; isPinned?: boolean }>
  }>
}

const setup = async (options: SetupOptions = {}) => {
  vi.resetModules()

  const operations: string[] = []
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
    groupMode: 'time' as const,
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
    usePresenter: () => ({
      openOrFocusSettingsWindow: vi.fn(),
      show: vi.fn()
    })
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

  return { wrapper, operations, agentStore, sessionStore }
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
    expect(wrapper.text()).toContain('common.time.today')
    expect(wrapper.text()).toContain('Normal Session')
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
    await wrapper.vm.$nextTick()

    expect(sessionStore.toggleSessionPinned).toHaveBeenCalledWith('normal-1', true)
  }, 10000)

  it('opens dialogs and dispatches rename, clear, and delete actions', async () => {
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

    item.vm.$emit('rename', session)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('dialog.rename.title')
    ;(wrapper.vm as any).renameValue = 'Renamed Session'
    await (wrapper.vm as any).handleRenameConfirm()
    expect(sessionStore.renameSession).toHaveBeenCalledWith('normal-1', 'Renamed Session')

    item.vm.$emit('clear', session)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('dialog.cleanMessages.title')

    await (wrapper.vm as any).handleClearConfirm()
    expect(sessionStore.clearSessionMessages).toHaveBeenCalledWith('normal-1')

    item.vm.$emit('delete', session)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('dialog.delete.title')

    await (wrapper.vm as any).handleDeleteConfirm()
    expect(sessionStore.deleteSession).toHaveBeenCalledWith('normal-1')
  }, 10000)
})
