import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { UsageDashboardData } from '@shared/types/agent-interface'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>'
})

function buildDashboard(overrides: Partial<UsageDashboardData> = {}): UsageDashboardData {
  return {
    recordingStartedAt: new Date(2026, 2, 1, 12, 0, 0).getTime(),
    backfillStatus: {
      status: 'completed',
      startedAt: new Date(2026, 2, 1, 12, 0, 0).getTime(),
      finishedAt: new Date(2026, 2, 1, 12, 0, 5).getTime(),
      error: null,
      updatedAt: new Date(2026, 2, 1, 12, 0, 5).getTime()
    },
    summary: {
      messageCount: 2,
      inputTokens: 800,
      outputTokens: 400,
      totalTokens: 1200,
      cachedInputTokens: 200,
      cacheHitRate: 0.25,
      estimatedCostUsd: 0.0123
    },
    calendar: Array.from({ length: 28 }, (_, index) => ({
      date: `2026-03-${`${index + 1}`.padStart(2, '0')}`,
      messageCount: index % 4 === 0 ? 1 : 0,
      inputTokens: index % 4 === 0 ? 40 : 0,
      outputTokens: index % 4 === 0 ? 20 : 0,
      totalTokens: index % 4 === 0 ? 60 : 0,
      cachedInputTokens: index % 8 === 0 ? 10 : 0,
      estimatedCostUsd: index % 4 === 0 ? 0.0006 : null,
      level: index % 4 === 0 ? 3 : 0
    })),
    providerBreakdown: [
      {
        id: 'openai',
        label: 'OpenAI',
        messageCount: 2,
        inputTokens: 800,
        outputTokens: 400,
        totalTokens: 1200,
        cachedInputTokens: 200,
        estimatedCostUsd: 0.0123
      }
    ],
    modelBreakdown: [
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        messageCount: 2,
        inputTokens: 800,
        outputTokens: 400,
        totalTokens: 1200,
        cachedInputTokens: 200,
        estimatedCostUsd: 0.0123
      }
    ],
    ...overrides
  }
}

async function setup(data: UsageDashboardData) {
  vi.resetModules()
  const getUsageDashboard = vi.fn().mockResolvedValue(data)

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: () => ({
      getUsageDashboard
    })
  }))

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      locale: ref('en-US'),
      t: (key: string, params?: Record<string, unknown>) => {
        if (key === 'settings.dashboard.unavailable') return 'N/A'
        if (key === 'settings.dashboard.breakdown.messages') {
          return `${params?.count ?? 0} messages`
        }
        if (key === 'settings.dashboard.summary.inputTokensLabel') {
          return 'Input'
        }
        if (key === 'settings.dashboard.summary.outputTokensLabel') {
          return 'Output'
        }
        if (key === 'settings.dashboard.summary.withDeepChatDaysLabel') {
          return 'Days together'
        }
        if (key === 'settings.dashboard.summary.withDeepChatDaysSentence') {
          return `You are on day ${params?.days ?? '0'} with DeepChat.`
        }
        if (key === 'settings.dashboard.summary.withDeepChatDaysDescription') {
          return `Based on your earliest usage record from ${params?.date ?? 'unknown'}.`
        }
        if (key === 'settings.dashboard.summary.withDeepChatDaysDescriptionUnavailable') {
          return 'No usage record yet.'
        }
        if (key === 'settings.dashboard.calendar.tooltip') {
          return `${params?.date}: ${params?.tokens}`
        }
        return key
      }
    })
  }))

  const DashboardSettings = (
    await import('../../../src/renderer/settings/components/DashboardSettings.vue')
  ).default

  const wrapper = mount(DashboardSettings, {
    global: {
      stubs: {
        ScrollArea: passthrough('ScrollArea'),
        Button: buttonStub,
        Badge: passthrough('Badge'),
        Card: passthrough('Card'),
        CardContent: passthrough('CardContent'),
        CardDescription: passthrough('CardDescription'),
        CardHeader: passthrough('CardHeader'),
        CardTitle: passthrough('CardTitle'),
        Icon: defineComponent({ name: 'Icon', template: '<i />' })
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    getUsageDashboard
  }
}

describe('DashboardSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 17, 12, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the empty state when no stats are available', async () => {
    const { wrapper } = await setup(
      buildDashboard({
        summary: {
          messageCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          cacheHitRate: 0,
          estimatedCostUsd: null
        },
        providerBreakdown: [],
        modelBreakdown: []
      })
    )

    expect(wrapper.find('[data-testid="dashboard-empty"]').exists()).toBe(true)
  })

  it('renders the backfill banner while historical stats are initializing', async () => {
    const { wrapper } = await setup(
      buildDashboard({
        backfillStatus: {
          status: 'running',
          startedAt: new Date(2026, 2, 1, 12, 0, 0).getTime(),
          finishedAt: null,
          error: null,
          updatedAt: new Date(2026, 2, 1, 12, 0, 5).getTime()
        }
      })
    )

    expect(wrapper.find('[data-testid="dashboard-backfill-banner"]').exists()).toBe(true)
  })

  it('renders summary cards and breakdown rows when stats exist', async () => {
    const { wrapper, getUsageDashboard } = await setup(buildDashboard())

    expect(getUsageDashboard).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('OpenAI')
    expect(wrapper.text()).toContain('GPT-4o')
    expect(wrapper.text()).toContain('1.2k')
    expect(wrapper.text()).toContain('Input')
    expect(wrapper.text()).toContain('Output')
    expect(wrapper.text()).toContain('66.7%')
    expect(wrapper.text()).toContain('33.3%')
    expect(wrapper.text()).not.toContain('Shows the composition of input and output tokens.')
    expect(wrapper.text()).toContain('You are on day 17 with DeepChat.')
    expect(wrapper.text()).not.toContain('settings.dashboard.summary.cacheHitRate')
    expect(wrapper.find('[data-testid="summary-card-totalTokens"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="total-tokens-donut"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="summary-card-totalTokens"]').html()).toContain(
      'whitespace-normal'
    )
    expect(wrapper.find('[data-testid="summary-card-totalTokens"]').html()).not.toContain(
      'truncate'
    )
    expect(wrapper.find('[data-testid="provider-breakdown-scroll"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="model-breakdown-scroll"]').exists()).toBe(true)
    expect(wrapper.find('[title="1,200"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="calendar-cell"]').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-testid="summary-card-withDeepChatDays"]').html()).toContain(
      'whitespace-normal'
    )
  })

  it('renders an empty donut with 0% ratios when total tokens are zero', async () => {
    const { wrapper } = await setup(
      buildDashboard({
        summary: {
          messageCount: 1,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          cacheHitRate: 0,
          estimatedCostUsd: null
        }
      })
    )

    expect(wrapper.find('[data-testid="summary-card-totalTokens"]').text()).toContain('0')
    expect(wrapper.find('[data-testid="total-tokens-input-ratio"]').text()).toBe('0%')
    expect(wrapper.find('[data-testid="total-tokens-output-ratio"]').text()).toBe('0%')
  })

  it('renders N/A for days together when the first usage record is unavailable', async () => {
    const { wrapper } = await setup(
      buildDashboard({
        recordingStartedAt: null
      })
    )

    const summaryCard = wrapper.find('[data-testid="summary-card-withDeepChatDays"]')

    expect(summaryCard.exists()).toBe(true)
    expect(summaryCard.text()).toContain('N/A')
    expect(summaryCard.text()).toContain('No usage record yet.')
  })
})
