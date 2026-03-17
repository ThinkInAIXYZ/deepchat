import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import type { PropType } from 'vue'
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

const chartCrosshairStub = defineComponent({
  name: 'ChartCrosshair',
  props: {
    template: {
      type: Function as PropType<
        | ((
            datum: unknown,
            x: number | Date,
            data: unknown[],
            leftNearestDatumIndex?: number
          ) => HTMLElement | undefined)
        | undefined
      >,
      default: undefined
    },
    tooltip: {
      type: Object as PropType<Record<string, unknown> | undefined>,
      default: undefined
    },
    hideWhenFarFromPointer: {
      type: Boolean,
      default: false
    },
    data: {
      type: Array as PropType<unknown[]>,
      default: () => []
    },
    x: {
      type: Function as PropType<((point: unknown) => number) | undefined>,
      default: undefined
    },
    y: {
      type: Array as PropType<Array<(point: unknown) => number>>,
      default: () => []
    }
  },
  template: '<div data-testid="chart-crosshair" />'
})

const chartTooltipStub = defineComponent({
  name: 'ChartTooltip',
  props: {
    attributes: {
      type: Object as PropType<Record<string, unknown>>,
      default: () => ({})
    }
  },
  setup(props, { expose }) {
    expose({
      component: {
        attributes: props.attributes
      }
    })

    return {}
  },
  template: '<div data-testid="chart-tooltip" />'
})

const chartTooltipContentStub = defineComponent({
  name: 'ChartTooltipContent',
  props: {
    payload: {
      type: Object as PropType<Record<string, unknown>>,
      default: () => ({})
    },
    x: {
      type: [String, Number, Date] as PropType<string | number | Date | undefined>,
      default: undefined
    },
    labelFormatter: {
      type: Function as PropType<((value: string | number | Date) => string) | undefined>,
      default: undefined
    }
  },
  template: `
    <div data-testid="chart-tooltip-content">
      <div data-testid="chart-tooltip-label">
        {{ labelFormatter && x !== undefined ? labelFormatter(x) : x }}
      </div>
      <div
        v-for="(value, key) in payload"
        :key="String(key)"
        :data-testid="'chart-tooltip-value-' + String(key)"
      >
        {{ String(key) }}:{{ value }}
      </div>
    </div>
  `
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
      sessionCount: 3,
      inputTokens: 800,
      outputTokens: 400,
      totalTokens: 1200,
      cachedInputTokens: 200,
      cacheHitRate: 0.25,
      estimatedCostUsd: 0.0123,
      mostActiveDay: {
        date: '2026-03-09',
        messageCount: 2
      }
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

async function setup(
  data: UsageDashboardData,
  options: {
    getUsageDashboard?: ReturnType<typeof vi.fn>
  } = {}
) {
  vi.resetModules()
  const getUsageDashboard = options.getUsageDashboard ?? vi.fn().mockResolvedValue(data)

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: () => ({
      getUsageDashboard
    })
  }))

  vi.doMock('@shadcn/components/ui/chart', () => ({
    ChartContainer: passthrough('ChartContainer'),
    ChartCrosshair: chartCrosshairStub,
    ChartTooltip: chartTooltipStub,
    ChartTooltipContent: chartTooltipContentStub
  }))

  vi.doMock('@unovis/vue', () => ({
    VisSingleContainer: passthrough('VisSingleContainer'),
    VisXYContainer: passthrough('VisXYContainer'),
    VisDonut: passthrough('VisDonut'),
    VisArea: passthrough('VisArea'),
    VisStackedBar: passthrough('VisStackedBar')
  }))

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      locale: ref('en-US'),
      t: (key: string, params?: Record<string, unknown>) => {
        if (key === 'settings.dashboard.unavailable') return 'N/A'
        if (key === 'settings.dashboard.breakdown.messages') {
          return `${params?.count ?? 0} messages`
        }
        if (key === 'settings.dashboard.summary.cachedTokensCachedLabel') {
          return 'Cached'
        }
        if (key === 'settings.dashboard.summary.cachedTokensUncachedLabel') {
          return 'Uncached'
        }
        if (key === 'settings.dashboard.summary.inputTokensLabel') {
          return 'Input'
        }
        if (key === 'settings.dashboard.summary.outputTokensLabel') {
          return 'Output'
        }
        if (key === 'settings.dashboard.summary.tokenUsage') {
          return 'Token usage'
        }
        if (key === 'settings.dashboard.summary.estimatedCostTrendLabel') {
          return 'Trend over the last 30 days'
        }
        if (key === 'settings.dashboard.summary.estimatedCostTrendEmpty') {
          return 'No cost recorded in the last 30 days.'
        }
        if (key === 'settings.dashboard.summary.nostalgiaLabel') {
          return 'Echoes'
        }
        if (key === 'settings.dashboard.summary.nostalgiaDaysValue') {
          return `${params?.days ?? '0'} days`
        }
        if (key === 'settings.dashboard.summary.nostalgiaSessionsValue') {
          return `${params?.count ?? '0'} sessions`
        }
        if (key === 'settings.dashboard.summary.nostalgiaMessagesValue') {
          return `${params?.count ?? '0'} messages`
        }
        if (key === 'settings.dashboard.summary.nostalgiaDaysDetailLabel') {
          return 'Days together'
        }
        if (key === 'settings.dashboard.summary.nostalgiaDaysDetail') {
          return `You and DeepChat have spent ${params?.days ?? '0'} days together.`
        }
        if (key === 'settings.dashboard.summary.nostalgiaSessionsDetailLabel') {
          return 'Sessions'
        }
        if (key === 'settings.dashboard.summary.nostalgiaSessionsDetail') {
          return `You have shared ${params?.count ?? '0'} sessions together.`
        }
        if (key === 'settings.dashboard.summary.nostalgiaMessagesDetailLabel') {
          return 'Messages'
        }
        if (key === 'settings.dashboard.summary.nostalgiaMessagesDetail') {
          return `You have exchanged ${params?.count ?? '0'} messages.`
        }
        if (key === 'settings.dashboard.summary.nostalgiaMostActiveDayLabel') {
          return 'Most active day'
        }
        if (key === 'settings.dashboard.summary.nostalgiaMostActiveDayDetail') {
          return `${params?.date ?? 'unknown'} was your most active day, with ${params?.count ?? '0'} messages.`
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
          sessionCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          cacheHitRate: 0,
          estimatedCostUsd: null,
          mostActiveDay: {
            date: null,
            messageCount: 0
          }
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
    const summaryCards = wrapper.findAll('[data-testid^="summary-card-"]')

    expect(getUsageDashboard).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('OpenAI')
    expect(wrapper.text()).toContain('GPT-4o')
    expect(wrapper.text()).toContain('1.2k')
    expect(wrapper.text()).toContain('Input')
    expect(wrapper.text()).toContain('Output')
    expect(wrapper.text()).toContain('66.7%')
    expect(wrapper.text()).toContain('33.3%')
    expect(wrapper.text()).toContain('Cached')
    expect(wrapper.text()).toContain('25%')
    expect(wrapper.text()).toContain('17 days')
    expect(wrapper.text()).toContain('You and DeepChat have spent 17 days together.')
    expect(wrapper.text()).toContain('You have shared 3 sessions together.')
    expect(wrapper.text()).toContain('You have exchanged 2 messages.')
    expect(wrapper.text()).toContain('Mar 9, 2026 was your most active day, with 2 messages.')
    expect(wrapper.text()).not.toContain('settings.dashboard.summary.cacheHitRate')
    expect(summaryCards).toHaveLength(2)
    expect(wrapper.find('[data-testid="summary-card-tokenUsage"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="summary-card-nostalgia"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="token-usage-trend-chart"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ChartTooltip' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ChartCrosshair' }).exists()).toBe(true)
    expect(wrapper.find('[data-testid="token-usage-input-dot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="token-usage-input-dot"]').attributes('style')).toContain(
      'var(--primary-600)'
    )
    expect(wrapper.find('[data-testid="token-usage-output-dot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="token-usage-cached-dot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="token-usage-cost-dot"]').exists()).toBe(true)
    expect(wrapper.findAllComponents({ name: 'VisArea' })).toHaveLength(4)
    expect(wrapper.find('[data-testid="token-usage-total-row"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="token-usage-cost-row"]').text()).toContain(
      'Trend over the last 30 days'
    )
    expect(wrapper.find('[data-testid="token-usage-list"]').text()).not.toContain('Uncached')
    expect(wrapper.find('[data-testid="cached-tokens-bar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="provider-breakdown-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="model-breakdown-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="provider-breakdown-scroll"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="model-breakdown-scroll"]').exists()).toBe(true)
    expect(wrapper.find('[title="1,200"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="calendar-cell"]').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-testid="summary-card-nostalgia"]').html()).toContain(
      'whitespace-normal'
    )
    expect(wrapper.find('[data-testid="summary-card-nostalgia"]').html()).toContain('md:col-span-2')
    expect(wrapper.find('[data-testid="summary-card-nostalgia"]').html()).toContain(
      'md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]'
    )
    expect(wrapper.find('[data-testid="nostalgia-details"]').html()).toContain('space-y-2')
    expect(wrapper.find('[data-testid="nostalgia-rotating-value"]').text()).toBe('17 days')

    await vi.advanceTimersByTimeAsync(4000)
    expect(wrapper.find('[data-testid="nostalgia-rotating-value"]').text()).toBe('3 sessions')

    await vi.advanceTimersByTimeAsync(4000)
    expect(wrapper.find('[data-testid="nostalgia-rotating-value"]').text()).toBe('2 messages')
  })

  it('renders token usage tooltip content with raw values for all series', async () => {
    const { wrapper } = await setup(
      buildDashboard({
        calendar: [
          {
            date: '2026-03-01',
            messageCount: 1,
            inputTokens: 50,
            outputTokens: 20,
            totalTokens: 70,
            cachedInputTokens: 10,
            estimatedCostUsd: 0.0012,
            level: 1
          },
          {
            date: '2026-03-02',
            messageCount: 1,
            inputTokens: 25,
            outputTokens: 5,
            totalTokens: 30,
            cachedInputTokens: 4,
            estimatedCostUsd: 0.0007,
            level: 1
          }
        ]
      })
    )

    const crosshair = wrapper.getComponent({ name: 'ChartCrosshair' })
    const template = crosshair.props('template') as (
      datum: {
        index: number
        date: string
        inputTokens: number
        outputTokens: number
        cachedTokens: number
        cost: number
        inputValue: number
        outputValue: number
        cachedValue: number
        costValue: number
      },
      x: number | Date,
      data: unknown[],
      leftNearestDatumIndex?: number
    ) => HTMLElement | undefined

    const tooltip = template(
      {
        index: 1,
        date: '2026-03-02',
        inputTokens: 25,
        outputTokens: 5,
        cachedTokens: 4,
        cost: 0.0007,
        inputValue: 50,
        outputValue: 25,
        cachedValue: 40,
        costValue: 58.3
      },
      1,
      [],
      1
    )

    expect(tooltip).toBeInstanceOf(HTMLElement)
    expect(tooltip?.textContent).toContain('Mar 2, 2026')
    expect(tooltip?.textContent).toContain('input:25')
    expect(tooltip?.textContent).toContain('output:5')
    expect(tooltip?.textContent).toContain('cached:4')
    expect(tooltip?.textContent).toContain('cost:$0.0007')
    expect(tooltip?.textContent).not.toContain('input:50')
  })

  it('renders an empty trend summary with 0% ratios when total tokens are zero', async () => {
    const { wrapper } = await setup(
      buildDashboard({
        summary: {
          messageCount: 1,
          sessionCount: 1,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          cacheHitRate: 0,
          estimatedCostUsd: null,
          mostActiveDay: {
            date: null,
            messageCount: 0
          }
        }
      })
    )

    expect(wrapper.find('[data-testid="summary-card-tokenUsage"]').text()).toContain('0')
    expect(wrapper.find('[data-testid="token-usage-trend-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="total-tokens-input-ratio"]').text()).toBe('0%')
    expect(wrapper.find('[data-testid="total-tokens-output-ratio"]').text()).toBe('0%')
    expect(wrapper.find('[data-testid="cached-tokens-cached-ratio"]').text()).toBe('0%')
  })

  it('renders cached token ratio without uncached rows when input tokens are zero', async () => {
    const { wrapper } = await setup(
      buildDashboard({
        summary: {
          messageCount: 1,
          sessionCount: 1,
          inputTokens: 0,
          outputTokens: 400,
          totalTokens: 400,
          cachedInputTokens: 0,
          cacheHitRate: 0,
          estimatedCostUsd: 0.0123,
          mostActiveDay: {
            date: '2026-03-10',
            messageCount: 1
          }
        }
      })
    )

    expect(wrapper.find('[data-testid="cached-tokens-bar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cached-tokens-cached-ratio"]').text()).toBe('0%')
    expect(wrapper.find('[data-testid="cached-tokens-uncached-ratio"]').exists()).toBe(false)
  })

  it('keeps the merged token usage chart when the last 30 days have no cost data', async () => {
    const { wrapper } = await setup(
      buildDashboard({
        calendar: Array.from({ length: 28 }, (_, index) => ({
          date: `2026-03-${`${index + 1}`.padStart(2, '0')}`,
          messageCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          estimatedCostUsd: null,
          level: 0 as const
        }))
      })
    )

    expect(wrapper.find('[data-testid="token-usage-trend-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="token-usage-cost-row"]').text()).toContain(
      'Trend over the last 30 days'
    )
  })

  it('renders N/A for days together when the first usage record is unavailable', async () => {
    const { wrapper } = await setup(
      buildDashboard({
        recordingStartedAt: null
      })
    )

    const summaryCard = wrapper.find('[data-testid="summary-card-nostalgia"]')

    expect(summaryCard.exists()).toBe(true)
    expect(summaryCard.text()).toContain('N/A')
    expect(summaryCard.text()).toContain('You have shared 3 sessions together.')
    expect(wrapper.find('[data-testid="nostalgia-rotating-value"]').text()).toBe('3 sessions')
  })

  it('renders N/A for the most active day when that summary is unavailable', async () => {
    const { wrapper } = await setup(
      buildDashboard({
        summary: {
          messageCount: 2,
          sessionCount: 3,
          inputTokens: 800,
          outputTokens: 400,
          totalTokens: 1200,
          cachedInputTokens: 200,
          cacheHitRate: 0.25,
          estimatedCostUsd: 0.0123,
          mostActiveDay: {
            date: null,
            messageCount: 0
          }
        }
      })
    )

    expect(wrapper.find('[data-testid="nostalgia-detail-most-active-day"]').text()).toContain('N/A')
  })

  it('cleans up scheduled timers when the component unmounts', async () => {
    const { wrapper } = await setup(buildDashboard())

    expect(vi.getTimerCount()).toBeGreaterThan(0)

    wrapper.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not reschedule timers when an async dashboard load resolves after unmount', async () => {
    let resolveDashboard: ((value: UsageDashboardData) => void) | null = null
    const getUsageDashboard = vi.fn().mockImplementation(
      () =>
        new Promise<UsageDashboardData>((resolve) => {
          resolveDashboard = resolve
        })
    )

    const { wrapper } = await setup(buildDashboard(), { getUsageDashboard })

    expect(getUsageDashboard).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    resolveDashboard?.(buildDashboard())
    await flushPromises()

    expect(vi.getTimerCount()).toBe(0)
  })
})
