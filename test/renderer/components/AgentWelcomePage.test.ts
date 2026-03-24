import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { SETTINGS_EVENTS } from '@/events'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('AgentWelcomePage', () => {
  it('renders up to nine agents and navigates to DeepChat agent settings', async () => {
    vi.resetModules()
    vi.useFakeTimers()

    const windowPresenter = {
      createSettingsWindow: vi.fn().mockResolvedValue(9),
      sendToWindow: vi.fn(() => true)
    }
    const agentStore = {
      enabledAgents: Array.from({ length: 12 }, (_, index) => ({
        id: `agent-${index + 1}`,
        name: `Agent ${index + 1}`,
        type: index === 0 ? 'deepchat' : 'acp',
        enabled: true
      })),
      setSelectedAgent: vi.fn()
    }

    vi.doMock('@/composables/usePresenter', () => ({
      usePresenter: (name: string) => {
        if (name === 'windowPresenter') return windowPresenter
        return {}
      }
    }))
    vi.doMock('@/stores/ui/agent', () => ({
      useAgentStore: () => agentStore
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) =>
          (
            ({
              'welcome.agentPage.title': '选择 Agent 开始创作',
              'welcome.agentPage.manageAgents': '管理 DeepChat Agent',
              'welcome.agentPage.deepchatType': 'DeepChat Agent',
              'welcome.agentPage.acpType': 'ACP Agent Localized'
            }) as Record<string, string>
          )[key] ?? key
      })
    }))
    vi.doMock('@iconify/vue', () => ({
      Icon: {
        name: 'Icon',
        template: '<span />'
      }
    }))
    vi.doMock('@/components/icons/AgentAvatar.vue', () => ({
      default: {
        name: 'AgentAvatar',
        template: '<span />'
      }
    }))

    const AgentWelcomePage = (await import('@/pages/AgentWelcomePage.vue')).default
    const wrapper = mount(AgentWelcomePage, {
      global: {
        stubs: {
          Icon: true,
          AgentAvatar: true
        }
      }
    })

    expect(wrapper.text()).toContain('选择 Agent 开始创作')
    expect(wrapper.text()).not.toContain('welcome.agentPage.description')
    expect(wrapper.find('.grid').classes()).toContain('grid-cols-3')

    const agentButtons = wrapper
      .findAll('button')
      .filter((button) => button.text().includes('Agent '))

    expect(agentButtons).toHaveLength(9)
    expect(wrapper.text()).not.toContain('Agent 10')
    expect(wrapper.text()).toContain('ACP Agent Localized')

    await agentButtons[0].trigger('click')
    expect(agentStore.setSelectedAgent).toHaveBeenCalledWith('agent-1')

    const manageButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('管理 DeepChat Agent'))

    expect(manageButton).toBeDefined()

    await manageButton!.trigger('click')
    await vi.runAllTimersAsync()

    expect(windowPresenter.createSettingsWindow).toHaveBeenCalledTimes(1)
    expect(windowPresenter.sendToWindow).toHaveBeenCalledWith(9, SETTINGS_EVENTS.NAVIGATE, {
      routeName: 'settings-deepchat-agents'
    })
    expect(windowPresenter.sendToWindow).toHaveBeenCalledTimes(1)
  })
})
