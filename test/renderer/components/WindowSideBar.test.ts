import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { mount } from '@vue/test-utils'

const setup = async () => {
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
    closeSession: vi.fn(async () => {
      operations.push('close')
      sessionStore.hasActiveSession = false
      sessionStore.activeSessionId = null
    }),
    toggleGroupMode: vi.fn(),
    getFilteredGroups: vi.fn(() => [])
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
      openOrFocusSettingsTab: vi.fn(),
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

  const buttonStub = defineComponent({
    emits: ['click'],
    template: '<button @click="$emit(\'click\', $event)"><slot /></button>'
  })

  const WindowSideBar = (await import('@/components/WindowSideBar.vue')).default
  const wrapper = mount(WindowSideBar, {
    global: {
      stubs: {
        TooltipProvider: passthrough,
        Tooltip: passthrough,
        TooltipContent: passthrough,
        TooltipTrigger: passthrough,
        DropdownMenu: passthrough,
        DropdownMenuTrigger: passthrough,
        DropdownMenuContent: passthrough,
        DropdownMenuItem: passthrough,
        Button: buttonStub,
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
  })
})
