import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
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
        cachedInputTokens: 200
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
        cachedInputTokens: 200
      }
    ],
    rtk: {
      scope: 'deepchat',
      enabled: true,
      effectiveEnabled: true,
      available: true,
      health: 'healthy',
      checkedAt: new Date(2026, 2, 1, 12, 0, 5).getTime(),
      source: 'bundled',
      failureStage: null,
      failureMessage: null,
      summary: {
        totalCommands: 12,
        totalInputTokens: 5000,
        totalOutputTokens: 1200,
        totalSavedTokens: 3800,
        avgSavingsPct: 76,
        totalTimeMs: 2400,
        avgTimeMs: 200
      },
      daily: []
    },
    ...overrides
  }
}

async function setup(
  data: UsageDashboardData,
  options: {
    getUsageDashboard?: ReturnType<typeof vi.fn>
    retryRtkHealthCheck?: ReturnType<typeof vi.fn>
    hideNostalgia?: boolean
  } = {}
) {
  vi.resetModules()
  const getUsageDashboard = options.getUsageDashboard ?? vi.fn().mockResolvedValue(data)
  const retryRtkHealthCheck = options.retryRtkHealthCheck ?? vi.fn().mockResolvedValue(undefined)

  vi.doMock('@api/SessionClient', () => ({
    createSessionClient: () => ({
      getUsageDashboard,
      retryRtkHealthCheck
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
        if (key === 'settings.dashboard.rtk.title') return 'RTK Savings'
        if (key === 'settings.dashboard.rtk.description') {
          return 'Estimated tokens prevented from reaching the model context by RTK during DeepChat native command execution.'
        }
        if (key === 'settings.dashboard.rtk.actions.retry') return 'Retry check'
        if (key === 'settings.dashboard.rtk.status.disabled') return 'Disabled'
        if (key === 'settings.dashboard.rtk.status.checking') return 'Checking'
        if (key === 'settings.dashboard.rtk.status.healthy') return 'Healthy'
        if (key === 'settings.dashboard.rtk.status.unhealthy') return 'Unavailable'
        if (key === 'settings.dashboard.rtk.descriptionDisabled') {
          return 'RTK is disabled for this app session.'
        }
        if (key === 'settings.dashboard.rtk.descriptionChecking') {
          return 'DeepChat is verifying whether RTK can run.'
        }
        if (key === 'settings.dashboard.rtk.descriptionUnhealthy') {
          return 'RTK failed startup health checks.'
        }
        if (key === 'settings.dashboard.rtk.sourceLabel') {
          return `Runtime source: ${params?.source ?? 'Unknown'}`
        }
        if (key === 'settings.dashboard.rtk.source.bundled') return 'Bundled'
        if (key === 'settings.dashboard.rtk.source.system') return 'System'
        if (key === 'settings.dashboard.rtk.source.none') return 'Not available'
        if (key === 'settings.dashboard.rtk.summary.savedTokens') return 'Saved tokens'
        if (key === 'settings.dashboard.rtk.summary.commands') return 'Tracked commands'
        if (key === 'settings.dashboard.rtk.summary.avgSavingsPct') return 'Average savings'
        if (key === 'settings.dashboard.rtk.summary.outputTokens') return 'Filtered output'
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
    props: {
      hideNostalgia: options.hideNostalgia
    },
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
    getUsageDashboard,
    retryRtkHealthCheck
  }
}

let mockedDocumentVisibility: DocumentVisibilityState

describe('DashboardSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 17, 12, 0, 0))
    mockedDocumentVisibility = 'visible'
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => mockedDocumentVisibility)
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

  it('polls every three seconds while backfill is running', async () => {
    const { getUsageDashboard } = await setup(
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

    await vi.advanceTimersByTimeAsync(2_999)
    expect(getUsageDashboard).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(getUsageDashboard).toHaveBeenCalledTimes(2)
  })

  it('polls every sixty seconds after backfill completes', async () => {
    const { getUsageDashboard } = await setup(buildDashboard())

    await vi.advanceTimersByTimeAsync(59_999)
    expect(getUsageDashboard).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(getUsageDashboard).toHaveBeenCalledTimes(2)
  })

  it('pauses while hidden and refreshes immediately when stale and visible again', async () => {
    const { getUsageDashboard } = await setup(buildDashboard())

    mockedDocumentVisibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(getUsageDashboard).toHaveBeenCalledTimes(1)

    mockedDocumentVisibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(getUsageDashboard).toHaveBeenCalledTimes(2)
  })

  it('pauses while unfocused and preserves the remaining delay after an early focus', async () => {
    const { getUsageDashboard } = await setup(buildDashboard())

    window.dispatchEvent(new Event('blur'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(getUsageDashboard).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(getUsageDashboard).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(29_999)
    expect(getUsageDashboard).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(getUsageDashboard).toHaveBeenCalledTimes(2)
  })

  it('deduplicates manual refreshes while a dashboard request is in flight', async () => {
    let resolveDashboard: ((value: UsageDashboardData) => void) | null = null
    const getUsageDashboard = vi.fn().mockImplementation(
      () =>
        new Promise<UsageDashboardData>((resolve) => {
          resolveDashboard = resolve
        })
    )
    const { wrapper } = await setup(buildDashboard(), { getUsageDashboard })

    await wrapper.get('[data-testid="dashboard-header"] button').trigger('click')
    await wrapper.get('[data-testid="dashboard-header"] button').trigger('click')
    expect(getUsageDashboard).toHaveBeenCalledTimes(1)

    resolveDashboard?.(buildDashboard())
    await flushPromises()
    expect(getUsageDashboard).toHaveBeenCalledTimes(1)
  })

  it('reuses a bounded set of Intl formatters for a full calendar render', async () => {
    const numberFormat = vi.spyOn(Intl, 'NumberFormat')
    const dateTimeFormat = vi.spyOn(Intl, 'DateTimeFormat')
    const firstDay = new Date(2025, 0, 1)
    const calendar = Array.from({ length: 365 }, (_, index) => {
      const date = new Date(firstDay)
      date.setDate(firstDay.getDate() + index)
      return {
        date: date.toISOString().slice(0, 10),
        messageCount: 1,
        inputTokens: 40,
        outputTokens: 20,
        totalTokens: 60,
        cachedInputTokens: 10,
        level: 3 as const
      }
    })

    const { wrapper } = await setup(buildDashboard({ calendar }), { hideNostalgia: true })

    expect(numberFormat).toHaveBeenCalledTimes(4)
    expect(dateTimeFormat).toHaveBeenCalledTimes(3)

    wrapper.vm.$forceUpdate()
    await nextTick()
    expect(numberFormat).toHaveBeenCalledTimes(4)
    expect(dateTimeFormat).toHaveBeenCalledTimes(3)
  })

  it('renders summary cards and breakdown rows when stats exist', async () => {
    const { wrapper, getUsageDashboard } = await setup(buildDashboard())
    const summaryCards = wrapper.findAll('[data-testid^="summary-card-"]')
    const header = wrapper.get('[data-testid="dashboard-header"]')
    const calendarHeatmap = wrapper.get('[data-testid="dashboard-calendar-heatmap"]')
    const calendarWeeks = wrapper.get('[data-testid="dashboard-calendar-weeks"]')
    const tokenUsageList = wrapper.get('[data-testid="token-usage-list"]')

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
    expect(header.classes()).toContain('flex-col')
    expect(header.classes()).toContain('sm:flex-row')
    expect(wrapper.find('[data-testid="summary-card-tokenUsage"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="summary-card-nostalgia"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="token-usage-trend-chart"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="token-usage-input-dot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="token-usage-input-dot"]').attributes('style')).toContain(
      'var(--primary-600)'
    )
    expect(wrapper.find('[data-testid="token-usage-output-dot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="token-usage-cached-dot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="token-usage-cost-dot"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="token-usage-total-row"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="token-usage-cost-row"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="token-usage-list"]').text()).not.toContain('Uncached')
    expect(wrapper.find('[data-testid="cached-tokens-bar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="provider-breakdown-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="model-breakdown-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="provider-breakdown-scroll"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="model-breakdown-scroll"]').exists()).toBe(true)
    expect(wrapper.find('[title="1,200"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="calendar-cell"]').length).toBeGreaterThan(0)
    expect(calendarHeatmap.classes()).toContain('calendar-heatmap')
    expect(calendarWeeks.attributes('style')).toContain('repeat(4, minmax(0, 1fr))')
    expect(tokenUsageList.classes()).toContain('dashboard-token-usage-list')
    expect(wrapper.find('[data-testid="summary-card-nostalgia"]').html()).toContain(
      'whitespace-normal'
    )
    expect(wrapper.find('[data-testid="usage-summary-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="summary-card-tokenUsage"]').html()).toContain('lg:border-l')
    expect(wrapper.find('[data-testid="nostalgia-details"]').html()).toContain('space-y-2')
    expect(wrapper.find('[data-testid="nostalgia-rotating-value"]').text()).toBe('17 days')

    await vi.advanceTimersByTimeAsync(4000)
    expect(wrapper.find('[data-testid="nostalgia-rotating-value"]').text()).toBe('3 sessions')

    await vi.advanceTimersByTimeAsync(4000)
    expect(wrapper.find('[data-testid="nostalgia-rotating-value"]').text()).toBe('2 messages')
  })

  it('renders RTK savings summary when RTK is healthy', async () => {
    const { wrapper } = await setup(buildDashboard())

    expect(wrapper.find('[data-testid="rtk-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="rtk-card"]').html()).toContain('dashboard-rtk-summary-grid')
    expect(wrapper.find('[data-testid="rtk-status-badge"]').text()).toBe('Bundled')
    expect(wrapper.find('[data-testid="rtk-summary-saved"]').text()).toContain('3.8k')
    expect(wrapper.find('[data-testid="rtk-summary-commands"]').text()).toContain('12')
    expect(wrapper.find('[data-testid="rtk-summary-rate"]').text()).toContain('76%')
    expect(wrapper.find('[data-testid="rtk-status-copy"]').exists()).toBe(false)
  })

  it('shows RTK retry action when health check fails', async () => {
    const retryRtkHealthCheck = vi.fn().mockResolvedValue(undefined)
    const { wrapper, getUsageDashboard } = await setup(
      buildDashboard({
        rtk: {
          ...buildDashboard().rtk,
          health: 'unhealthy',
          effectiveEnabled: false,
          failureMessage: 'rtk --version failed'
        }
      }),
      { retryRtkHealthCheck }
    )

    await wrapper.get('[data-testid="rtk-retry-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="rtk-status-copy"]').text()).toContain('rtk --version failed')
    expect(retryRtkHealthCheck).toHaveBeenCalledTimes(1)
    expect(getUsageDashboard).toHaveBeenCalledTimes(2)
  })

  it('renders calendar tooltip content with raw values for all series on hover', async () => {
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
            level: 1
          },
          {
            date: '2026-03-02',
            messageCount: 1,
            inputTokens: 25,
            outputTokens: 5,
            totalTokens: 30,
            cachedInputTokens: 4,
            level: 1
          }
        ]
      })
    )

    const cells = wrapper.findAll('[data-testid="calendar-cell"].opacity-100')
    await cells[cells.length - 1].trigger('mouseenter', { clientX: 40, clientY: 40 })

    const tooltip = document.body.querySelector('[data-testid="calendar-tooltip"]')
    expect(tooltip).not.toBeNull()
    expect(tooltip?.textContent).toContain('Mar 2, 2026')
    expect(tooltip?.textContent).toContain('input:25')
    expect(tooltip?.textContent).toContain('output:5')
    expect(tooltip?.textContent).toContain('cached:4')
    expect(tooltip?.textContent).not.toContain('$0.0007')
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
          mostActiveDay: {
            date: null,
            messageCount: 0
          }
        }
      })
    )

    expect(wrapper.find('[data-testid="summary-card-tokenUsage"]').text()).toContain('0')
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

  it('keeps the token usage summary when the last 30 days have no cost data', async () => {
    const { wrapper } = await setup(
      buildDashboard({
        calendar: Array.from({ length: 28 }, (_, index) => ({
          date: `2026-03-${`${index + 1}`.padStart(2, '0')}`,
          messageCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          level: 0 as const
        }))
      })
    )

    expect(wrapper.find('[data-testid="token-usage-trend-chart"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="token-usage-cost-row"]').exists()).toBe(false)
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
