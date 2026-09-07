import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatTopBar from '@/components/chat/ChatTopBar.vue'

const stores = vi.hoisted(() => ({
  session: {
    sessions: [
      {
        id: 'session-1',
        title: 'Conversation',
        projectDir: '',
        agentId: 'deepchat',
        sessionKind: 'regular',
        status: 'idle',
        isPinned: false
      }
    ],
    newConversationTargetAgentId: null as string | null,
    startNewConversation: vi.fn(),
    toggleSessionPinned: vi.fn(),
    renameSession: vi.fn(),
    clearSessionMessages: vi.fn(),
    deleteSession: vi.fn(),
    exportSession: vi.fn(),
    selectSession: vi.fn(),
    moveSessionToAgent: vi.fn()
  },
  agent: {
    agents: [] as Array<{ id: string; name: string; type: string; enabled: boolean }>,
    enabledAgents: [] as Array<{ id: string; name: string; type: string; enabled: boolean }>,
    fetchAgents: vi.fn()
  },
  sidepanel: {
    toggleWorkspace: vi.fn(),
    openTapeInspector: vi.fn()
  },
  sidebar: {
    collapsed: false
  },
  uiSettings: {
    traceDebugEnabled: true
  }
}))

const notifyRenderer = vi.hoisted(() => vi.fn())

vi.mock('@/stores/ui/session', () => ({
  useSessionStore: () => stores.session
}))
vi.mock('@/stores/ui/agent', () => ({
  useAgentStore: () => stores.agent
}))
vi.mock('@/stores/ui/sidepanel', () => ({
  useSidepanelStore: () => stores.sidepanel
}))
vi.mock('@/stores/ui/sidebar', () => ({
  useSidebarStore: () => stores.sidebar
}))
vi.mock('@/stores/uiSettingsStore', () => ({
  useUiSettingsStore: () => stores.uiSettings
}))
vi.mock('@renderer-notifications/rendererNotificationPort', () => ({
  notifyRenderer
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))
vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    props: {
      icon: {
        type: String,
        required: true
      }
    },
    template: '<span :data-icon="icon" />'
  })
}))
vi.mock('@/components/agent/AgentTransferDialog.vue', () => ({
  default: defineComponent({
    name: 'AgentTransferDialog',
    template: '<div />'
  })
}))

vi.mock('@shadcn/components/ui/dropdown-menu', () => {
  const passthrough = (name: string) => ({
    name,
    template: '<div><slot /></div>'
  })
  return {
    DropdownMenu: passthrough('DropdownMenu'),
    DropdownMenuContent: passthrough('DropdownMenuContent'),
    DropdownMenuItem: passthrough('DropdownMenuItem'),
    DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
    DropdownMenuTrigger: passthrough('DropdownMenuTrigger')
  }
})
vi.mock('@dc-ui/components/button', () => ({
  DcButton: defineComponent({
    name: 'Button',
    props: {
      disabled: {
        type: Boolean,
        default: false
      },
      variant: {
        type: String,
        default: undefined
      }
    },
    emits: ['click'],
    template:
      '<button type="button" :disabled="disabled" :data-variant="variant" v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>'
  })
}))
vi.mock('@shadcn/components/ui/dialog', () => {
  const passthrough = (name: string) => ({
    name,
    template: '<div><slot /></div>'
  })
  return {
    Dialog: {
      name: 'Dialog',
      props: {
        open: {
          type: Boolean,
          default: false
        }
      },
      emits: ['update:open'],
      template: '<div v-if="open"><slot /></div>'
    },
    DialogContent: passthrough('DialogContent'),
    DialogDescription: passthrough('DialogDescription'),
    DialogFooter: passthrough('DialogFooter'),
    DialogHeader: passthrough('DialogHeader'),
    DialogTitle: passthrough('DialogTitle')
  }
})
vi.mock('@shadcn/components/ui/alert-dialog', () => {
  const passthrough = (name: string) => ({
    name,
    template: '<div><slot /></div>'
  })
  return {
    AlertDialog: {
      name: 'AlertDialog',
      props: {
        open: {
          type: Boolean,
          default: false
        }
      },
      emits: ['update:open'],
      template: '<div v-if="open"><slot /></div>'
    },
    AlertDialogAction: passthrough('AlertDialogAction'),
    AlertDialogAsyncAction: passthrough('AlertDialogAsyncAction'),
    AlertDialogCancel: passthrough('AlertDialogCancel'),
    AlertDialogContent: passthrough('AlertDialogContent'),
    AlertDialogDescription: passthrough('AlertDialogDescription'),
    AlertDialogFooter: passthrough('AlertDialogFooter'),
    AlertDialogHeader: passthrough('AlertDialogHeader'),
    AlertDialogTitle: passthrough('AlertDialogTitle'),
    AlertDialogTrigger: passthrough('AlertDialogTrigger')
  }
})

const mountTopBar = () =>
  mount(ChatTopBar, {
    props: {
      sessionId: 'session-1',
      title: 'Conversation',
      project: ''
    }
  })

afterEach(() => {
  stores.uiSettings.traceDebugEnabled = true
})

describe('ChatTopBar action buttons', () => {
  it('uses ghost DcButtons for workspace, share, and more actions', () => {
    const wrapper = mountTopBar()

    for (const icon of ['lucide:folder-tree', 'lucide:share', 'lucide:ellipsis']) {
      const button = wrapper
        .findAll('button')
        .find(
          (candidate) =>
            candidate.attributes('icon') === icon ||
            candidate.find(`[data-icon="${icon}"]`).exists()
        )

      expect(button?.attributes('data-variant')).toBe('ghost')
    }
  })

  it('opens the session Inspector only when diagnostics are enabled', async () => {
    stores.uiSettings.traceDebugEnabled = true
    const wrapper = mountTopBar()

    await wrapper.get('[data-testid="open-tape-inspector-button"]').trigger('click')
    expect(stores.sidepanel.openTapeInspector).toHaveBeenCalledWith('session-1')

    stores.uiSettings.traceDebugEnabled = false
    const hiddenWrapper = mountTopBar()
    expect(hiddenWrapper.find('[data-testid="open-tape-inspector-button"]').exists()).toBe(false)
  })
})

describe('ChatTopBar destructive operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stores.session.clearSessionMessages.mockResolvedValue(undefined)
    stores.session.deleteSession.mockResolvedValue(undefined)
  })

  it('keeps the clear dialog open and shows an inline error when clearing fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stores.session.clearSessionMessages.mockRejectedValueOnce(new Error('database busy'))
    const wrapper = mountTopBar()
    const viewModel = wrapper.vm as unknown as {
      clearDialogOpen: boolean
      handleClearConfirm(): Promise<void>
    }
    viewModel.clearDialogOpen = true

    await viewModel.handleClearConfirm()
    await flushPromises()

    expect(viewModel.clearDialogOpen).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toBe('common.error.requestFailed')
    expect(notifyRenderer).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('closes the clear dialog only after clearing succeeds', async () => {
    const wrapper = mountTopBar()
    const viewModel = wrapper.vm as unknown as {
      clearDialogOpen: boolean
      handleClearConfirm(): Promise<void>
    }
    viewModel.clearDialogOpen = true

    await viewModel.handleClearConfirm()

    expect(stores.session.clearSessionMessages).toHaveBeenCalledWith('session-1')
    expect(viewModel.clearDialogOpen).toBe(false)
  })

  it('keeps the delete dialog open and shows an inline error when deletion fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stores.session.deleteSession.mockRejectedValueOnce(new Error('database busy'))
    const wrapper = mountTopBar()
    const viewModel = wrapper.vm as unknown as {
      deleteDialogOpen: boolean
      handleDeleteConfirm(): Promise<void>
    }
    viewModel.deleteDialogOpen = true

    await viewModel.handleDeleteConfirm()
    await flushPromises()

    expect(viewModel.deleteDialogOpen).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toBe('common.error.requestFailed')
    expect(notifyRenderer).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
