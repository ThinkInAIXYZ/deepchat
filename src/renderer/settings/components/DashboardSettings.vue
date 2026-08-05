<template>
  <ScrollArea class="h-full w-full">
    <div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4">
      <div
        data-testid="dashboard-header"
        class="flex flex-col gap-3 px-2 py-2 sm:flex-row sm:items-start sm:justify-between"
      >
        <div class="min-w-0 flex-1">
          <h2 class="text-sm font-bold text-foreground">
            {{ t('settings.dashboard.title') }}
          </h2>
          <p class="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
            {{ t('settings.dashboard.description') }}
          </p>
        </div>
        <DcButton
          variant="outline"
          size="sm"
          class="w-full shrink-0 sm:w-auto"
          :disabled="isLoading"
          @click="void loadDashboard()"
        >
          <Spinner v-if="isLoading" class="mr-2 size-4" data-icon="inline-start" />
          <Icon v-else icon="lucide:refresh-cw" class="mr-2 size-4" data-icon="inline-start" />
          {{ t('settings.dashboard.actions.refresh') }}
        </DcButton>
      </div>

      <section
        v-if="dashboard?.backfillStatus.status === 'running'"
        data-testid="dashboard-backfill-banner"
        class="rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-foreground"
      >
        <div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <span class="h-2 w-2 animate-pulse rounded-full bg-primary"></span>
          <div class="flex-1">
            <p class="font-bold">{{ t('settings.dashboard.backfill.runningTitle') }}</p>
            <p class="text-muted-foreground">
              {{ t('settings.dashboard.backfill.runningDescription') }}
            </p>
          </div>
        </div>
      </section>

      <section
        v-else-if="dashboard?.backfillStatus.status === 'failed'"
        class="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm"
      >
        <p class="font-bold text-destructive">
          {{ t('settings.dashboard.backfill.failedTitle') }}
        </p>
        <p class="text-muted-foreground">
          {{ dashboard.backfillStatus.error || t('settings.dashboard.backfill.failedDescription') }}
        </p>
      </section>

      <section
        v-if="errorMessage"
        class="rounded-lg border border-destructive/30 bg-destructive/10 p-4"
      >
        <p class="font-bold text-destructive">{{ t('settings.dashboard.error.title') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ errorMessage }}</p>
      </section>

      <section v-if="isLoading && !dashboard">
        <div class="h-68 animate-pulse rounded-xl bg-muted"></div>
      </section>

      <template v-else-if="dashboard">
        <section v-if="hasData">
          <Card data-testid="usage-summary-panel" class="border-none bg-card py-5 shadow-none">
            <CardContent :class="['grid gap-6', props.hideNostalgia ? '' : 'lg:grid-cols-2']">
              <UsageNostalgiaCard
                v-if="!props.hideNostalgia"
                :dashboard="dashboard"
                class="min-w-0"
              />

              <div
                v-if="tokenUsageCard"
                data-testid="summary-card-tokenUsage"
                :class="[
                  'flex min-w-0 flex-col gap-3',
                  props.hideNostalgia ? '' : 'lg:border-l lg:border-border lg:pl-6'
                ]"
              >
                <p class="text-sm text-muted-foreground">
                  {{ t('settings.dashboard.summary.tokenUsage') }}
                </p>
                <div
                  data-testid="token-usage-list"
                  class="dashboard-token-usage-list flex flex-col gap-3"
                >
                  <div data-testid="token-usage-total-row">
                    <p class="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                      {{ t('settings.dashboard.summary.totalTokens') }}
                    </p>
                    <p
                      class="mt-1 text-2xl font-bold tabular-nums tracking-tight"
                      :title="formatFullTokens(tokenUsageCard.totalTokens)"
                    >
                      {{ formatTokens(tokenUsageCard.totalTokens) }}
                    </p>
                  </div>

                  <div class="flex flex-col">
                    <div
                      data-testid="total-tokens-input-row"
                      class="flex items-center justify-between gap-3 border-b border-border py-1.5"
                    >
                      <div class="flex min-w-0 items-center gap-2">
                        <span
                          data-testid="token-usage-input-dot"
                          class="h-2 w-2 shrink-0 rounded-full"
                          :style="tokenUsageMetricDotStyle('input')"
                        ></span>
                        <span
                          class="truncate text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
                        >
                          {{ t('settings.dashboard.summary.inputTokensLabel') }}
                        </span>
                      </div>
                      <div class="flex shrink-0 items-baseline gap-3">
                        <span
                          class="text-sm font-bold tabular-nums tracking-tight"
                          :title="formatFullTokens(tokenUsageCard.inputTokens)"
                        >
                          {{ formatTokens(tokenUsageCard.inputTokens) }}
                        </span>
                        <span
                          data-testid="total-tokens-input-ratio"
                          class="w-12 text-right text-[11px] tabular-nums text-muted-foreground"
                        >
                          {{ formatPercent(tokenUsageCard.inputRatio) }}
                        </span>
                      </div>
                    </div>

                    <div
                      data-testid="total-tokens-output-row"
                      class="flex items-center justify-between gap-3 border-b border-border py-1.5"
                    >
                      <div class="flex min-w-0 items-center gap-2">
                        <span
                          data-testid="token-usage-output-dot"
                          class="h-2 w-2 shrink-0 rounded-full"
                          :style="tokenUsageMetricDotStyle('output')"
                        ></span>
                        <span
                          class="truncate text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
                        >
                          {{ t('settings.dashboard.summary.outputTokensLabel') }}
                        </span>
                      </div>
                      <div class="flex shrink-0 items-baseline gap-3">
                        <span
                          class="text-sm font-bold tabular-nums tracking-tight"
                          :title="formatFullTokens(tokenUsageCard.outputTokens)"
                        >
                          {{ formatTokens(tokenUsageCard.outputTokens) }}
                        </span>
                        <span
                          data-testid="total-tokens-output-ratio"
                          class="w-12 text-right text-[11px] tabular-nums text-muted-foreground"
                        >
                          {{ formatPercent(tokenUsageCard.outputRatio) }}
                        </span>
                      </div>
                    </div>

                    <div
                      data-testid="cached-tokens-cached-row"
                      class="flex items-center justify-between gap-3 py-1.5"
                    >
                      <div class="flex min-w-0 items-center gap-2">
                        <span
                          data-testid="token-usage-cached-dot"
                          class="h-2 w-2 shrink-0 rounded-full"
                          :style="tokenUsageMetricDotStyle('cached')"
                        ></span>
                        <span
                          class="truncate text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
                        >
                          {{ t('settings.dashboard.summary.cachedTokensCachedLabel') }}
                        </span>
                      </div>
                      <div class="flex shrink-0 items-baseline gap-3">
                        <span
                          class="text-sm font-bold tabular-nums tracking-tight"
                          :title="formatFullTokens(tokenUsageCard.cachedTokens)"
                        >
                          {{ formatTokens(tokenUsageCard.cachedTokens) }}
                        </span>
                        <span
                          data-testid="cached-tokens-cached-ratio"
                          class="w-12 text-right text-[11px] tabular-nums text-muted-foreground"
                        >
                          {{ formatPercent(tokenUsageCard.cachedRatio) }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section
          v-else
          data-testid="dashboard-empty"
          class="rounded-xl border border-dashed border-border p-8 text-center"
        >
          <div class="mx-auto max-w-xl space-y-3">
            <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
              <Icon icon="lucide:layout-dashboard" class="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 class="text-lg font-bold">{{ t('settings.dashboard.empty.title') }}</h3>
            <p class="text-sm text-muted-foreground">
              {{ t('settings.dashboard.empty.description') }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.dashboard.empty.historyNote') }}
            </p>
          </div>
        </section>

        <Card class="overflow-hidden border-none bg-card shadow-none">
          <CardHeader class="pb-4">
            <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div class="space-y-1">
                <CardTitle>{{ t('settings.dashboard.calendar.title') }}</CardTitle>
                <CardDescription>
                  {{ t('settings.dashboard.calendar.description') }}
                </CardDescription>
              </div>
              <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{{ t('settings.dashboard.calendar.legend') }}</span>
                <div class="flex items-center gap-1">
                  <span
                    class="h-3 w-3 rounded-sm border border-border"
                    :style="calendarCellStyles[0]"
                  ></span>
                  <span
                    class="h-3 w-3 rounded-sm border border-border"
                    :style="calendarCellStyles[1]"
                  ></span>
                  <span
                    class="h-3 w-3 rounded-sm border border-border"
                    :style="calendarCellStyles[2]"
                  ></span>
                  <span
                    class="h-3 w-3 rounded-sm border border-border"
                    :style="calendarCellStyles[3]"
                  ></span>
                  <span
                    class="h-3 w-3 rounded-sm border border-border"
                    :style="calendarCellStyles[4]"
                  ></span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div
              data-testid="dashboard-calendar-scroll"
              class="-mx-1 overflow-x-auto px-1 pb-2 sm:mx-0 sm:px-0"
            >
              <div data-testid="dashboard-calendar-heatmap" class="calendar-heatmap">
                <div
                  data-testid="dashboard-calendar-months"
                  class="calendar-months-shell text-muted-foreground"
                >
                  <div aria-hidden="true"></div>
                  <div class="calendar-months text-[11px]" :style="calendarGridStyle">
                    <div
                      v-for="month in calendarMonthLabels"
                      :key="`${month.label}-${month.weekIndex}`"
                      class="calendar-month-label"
                      :style="{ gridColumn: `${month.weekIndex + 1} / span ${month.span}` }"
                    >
                      {{ month.label }}
                    </div>
                  </div>
                </div>
                <div class="calendar-body">
                  <div class="calendar-weekday-labels text-muted-foreground">
                    <span
                      v-for="label in weekdayLabels"
                      :key="label.key"
                      class="calendar-weekday-label"
                    >
                      {{ label.label }}
                    </span>
                  </div>
                  <div
                    data-testid="dashboard-calendar-weeks"
                    class="calendar-weeks"
                    :style="calendarGridStyle"
                  >
                    <div
                      v-for="(week, weekIndex) in calendarWeeks"
                      :key="`week-${weekIndex}`"
                      class="calendar-week"
                    >
                      <div
                        v-for="(day, dayIndex) in week"
                        :key="day ? day.date : `blank-${weekIndex}-${dayIndex}`"
                        data-testid="calendar-cell"
                        class="calendar-cell rounded-sm border border-border"
                        :class="day ? 'opacity-100' : 'opacity-0'"
                        :style="day ? day.cellStyle : undefined"
                        @mouseenter="day && showCalendarTooltip(day, $event)"
                        @mousemove="day && moveCalendarTooltip($event)"
                        @mouseleave="hideCalendarTooltip"
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <Teleport to="body">
              <div
                v-if="calendarTooltip"
                data-testid="calendar-tooltip"
                class="pointer-events-none fixed z-50"
                :style="calendarTooltipStyle"
              >
                <ChartTooltipContent
                  :config="tokenUsageChartConfig"
                  :x="calendarTooltip.date"
                  :label-formatter="tokenUsageTooltipDateLabel"
                  :payload="calendarTooltip.payload"
                />
              </div>
            </Teleport>
          </CardContent>
        </Card>

        <Card data-testid="rtk-card" class="overflow-hidden border-none bg-card shadow-none">
          <CardHeader class="pb-4">
            <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div class="space-y-1">
                <CardTitle>{{ t('settings.dashboard.rtk.title') }}</CardTitle>
                <CardDescription>
                  {{ t('settings.dashboard.rtk.description') }}
                </CardDescription>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <DcBadge
                  data-testid="rtk-status-badge"
                  variant="secondary"
                  :class="rtkStatusBadgeClass"
                >
                  {{ rtkStatusLabel }}
                </DcBadge>
                <DcButton
                  v-if="dashboard.rtk.health === 'unhealthy'"
                  data-testid="rtk-retry-button"
                  variant="outline"
                  size="sm"
                  :disabled="isRetryingRtk"
                  @click="void retryRtkHealthCheck()"
                >
                  {{ t('settings.dashboard.rtk.actions.retry') }}
                </DcButton>
              </div>
            </div>
          </CardHeader>
          <CardContent class="space-y-4">
            <div
              v-if="rtkStatusDescription"
              data-testid="rtk-status-copy"
              class="rounded-lg bg-card/60 px-4 py-3 text-sm text-muted-foreground"
            >
              <p>{{ rtkStatusDescription }}</p>
            </div>

            <div class="dashboard-rtk-summary-grid grid gap-3">
              <div data-testid="rtk-summary-saved" class="rounded-lg bg-card/60 px-4 py-3">
                <p class="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  {{ t('settings.dashboard.rtk.summary.savedTokens') }}
                </p>
                <p
                  class="mt-1 text-lg font-bold tracking-tight"
                  :title="formatFullTokens(dashboard.rtk.summary.totalSavedTokens)"
                >
                  {{ formatTokens(dashboard.rtk.summary.totalSavedTokens) }}
                </p>
              </div>

              <div data-testid="rtk-summary-commands" class="rounded-lg bg-card/60 px-4 py-3">
                <p class="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  {{ t('settings.dashboard.rtk.summary.commands') }}
                </p>
                <p class="mt-1 text-lg font-bold tracking-tight">
                  {{ formatCount(dashboard.rtk.summary.totalCommands) }}
                </p>
              </div>

              <div data-testid="rtk-summary-rate" class="rounded-lg bg-card/60 px-4 py-3">
                <p class="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  {{ t('settings.dashboard.rtk.summary.avgSavingsPct') }}
                </p>
                <p class="mt-1 text-lg font-bold tracking-tight">
                  {{ formatPercent(dashboard.rtk.summary.avgSavingsPct / 100) }}
                </p>
              </div>

              <div data-testid="rtk-summary-output" class="rounded-lg bg-card/60 px-4 py-3">
                <p class="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  {{ t('settings.dashboard.rtk.summary.outputTokens') }}
                </p>
                <p
                  class="mt-1 text-lg font-bold tracking-tight"
                  :title="formatFullTokens(dashboard.rtk.summary.totalOutputTokens)"
                >
                  {{ formatTokens(dashboard.rtk.summary.totalOutputTokens) }}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div class="grid gap-4 xl:grid-cols-2">
          <Card class="border-none bg-card shadow-none">
            <CardHeader class="pb-4">
              <CardTitle>{{ t('settings.dashboard.breakdown.providerTitle') }}</CardTitle>
              <CardDescription>
                {{ t('settings.dashboard.breakdown.providerDescription') }}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                v-if="dashboard.providerBreakdown.length === 0"
                class="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground"
              >
                {{ t('settings.dashboard.breakdown.empty') }}
              </div>
              <div
                v-else
                data-testid="provider-breakdown-scroll"
                class="max-h-105 overflow-y-auto pr-1"
              >
                <div data-testid="provider-breakdown-chart">
                  <div
                    v-for="item in providerBreakdownCard.rows"
                    :key="item.id"
                    class="border-b border-border py-3 last:border-b-0"
                  >
                    <div
                      class="space-y-2.5 lg:grid lg:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_minmax(4.75rem,auto)] lg:items-center lg:gap-3 lg:space-y-0 xl:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_88px]"
                    >
                      <div class="min-w-0">
                        <p class="truncate text-sm">{{ item.label }}</p>
                        <p class="text-xs text-muted-foreground">
                          {{
                            t('settings.dashboard.breakdown.messages', {
                              count: item.messageCount
                            })
                          }}
                        </p>
                      </div>
                      <div class="min-w-0 lg:px-1">
                        <div class="h-1.5 rounded-full bg-muted/35">
                          <div
                            class="h-full rounded-full bg-[hsl(var(--usage-low)/0.9)]"
                            :style="breakdownBarStyle(item.barRatio)"
                          ></div>
                        </div>
                      </div>
                      <div class="text-left text-xs text-muted-foreground lg:text-right">
                        <p :title="formatFullTokens(item.totalTokens)">
                          {{ formatTokens(item.totalTokens) }}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card class="border-none bg-card shadow-none">
            <CardHeader class="pb-4">
              <CardTitle>{{ t('settings.dashboard.breakdown.modelTitle') }}</CardTitle>
              <CardDescription>
                {{ t('settings.dashboard.breakdown.modelDescription') }}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                v-if="dashboard.modelBreakdown.length === 0"
                class="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground"
              >
                {{ t('settings.dashboard.breakdown.empty') }}
              </div>
              <div
                v-else
                data-testid="model-breakdown-scroll"
                class="max-h-105 overflow-y-auto pr-1"
              >
                <div data-testid="model-breakdown-chart">
                  <div
                    v-for="item in modelBreakdownCard.rows"
                    :key="item.id"
                    class="border-b border-border py-3 last:border-b-0"
                  >
                    <div
                      class="space-y-2.5 lg:grid lg:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_minmax(4.75rem,auto)] lg:items-center lg:gap-3 lg:space-y-0 xl:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_88px]"
                    >
                      <div class="min-w-0">
                        <p class="truncate text-sm">{{ item.label }}</p>
                        <p
                          v-if="item.secondaryLabel"
                          class="truncate text-xs text-muted-foreground"
                        >
                          {{ item.secondaryLabel }}
                        </p>
                      </div>
                      <div class="min-w-0 lg:px-1">
                        <div class="h-1.5 rounded-full bg-muted/35">
                          <div
                            class="h-full rounded-full bg-[hsl(var(--usage-low)/0.9)]"
                            :style="breakdownBarStyle(item.barRatio)"
                          ></div>
                        </div>
                      </div>
                      <div class="text-left text-xs text-muted-foreground lg:text-right">
                        <p :title="formatFullTokens(item.totalTokens)">
                          {{ formatTokens(item.totalTokens) }}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </template>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDocumentVisibility, useTimeoutFn, useWindowFocus } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { DcButton } from '@dc-ui/components/button'
import { DcBadge } from '@dc-ui/components/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@shadcn/components/ui/card'
import { ChartTooltipContent } from '@shadcn/components/ui/chart'
import type { ChartConfig } from '@shadcn/components/ui/chart'
import { Spinner } from '@shadcn/components/ui/spinner'
import type { UsageDashboardCalendarDay, UsageDashboardData } from '@shared/types/agent-interface'
import { createSessionClient } from '@api/SessionClient'
import UsageNostalgiaCard from './control-center/UsageNostalgiaCard.vue'

type CalendarDayView = UsageDashboardCalendarDay & {
  cellStyle: CSSProperties
}
type CalendarCell = CalendarDayView | null
type TokenUsageTrendKey = 'input' | 'output' | 'cached'
type CalendarTooltipState = {
  date: Date
  payload: Record<string, string>
}
type BreakdownChartRow = {
  id: string
  label: string
  secondaryLabel: string | null
  messageCount: number
  totalTokens: number
  barRatio: number
}
const { t, locale } = useI18n()
const sessionClient = createSessionClient()
const props = withDefaults(
  defineProps<{
    hideNostalgia?: boolean
  }>(),
  {
    hideNostalgia: false
  }
)
const emit = defineEmits<{
  (e: 'dashboard-loaded', dashboard: UsageDashboardData): void
}>()

const isLoading = shallowRef(true)
const isRetryingRtk = shallowRef(false)
const errorMessage = shallowRef('')
const dashboard = shallowRef<UsageDashboardData | null>(null)
const calendarTooltip = shallowRef<CalendarTooltipState | null>(null)
const calendarTooltipPosition = shallowRef({ x: 0, y: 0 })
const documentVisibility = useDocumentVisibility()
const isWindowFocused = useWindowFocus()
let isDashboardMounted = false
const refreshDelay = shallowRef(0)
const { start: startRefreshTimer, stop: stopRefreshTimer } = useTimeoutFn(
  () => {
    if (!isDashboardMounted) {
      return
    }
    void loadDashboard()
  },
  () => refreshDelay.value,
  { immediate: false }
)
let dashboardLoadPromise: Promise<void> | null = null
let lastDashboardLoadCompletedAt: number | null = null

const BACKFILL_REFRESH_INTERVAL_MS = 3_000
const STABLE_REFRESH_INTERVAL_MS = 60_000
const calendarCellStyles: Record<UsageDashboardCalendarDay['level'], CSSProperties> = {
  0: { backgroundColor: 'transparent' },
  1: { backgroundColor: 'hsl(var(--usage-low) / 0.35)' },
  2: { backgroundColor: 'hsl(var(--usage-low) / 0.75)' },
  3: { backgroundColor: 'hsl(var(--usage-mid))' },
  4: { backgroundColor: 'hsl(var(--usage-high))' }
}

const localeFormatters = computed(() => {
  const activeLocale = locale.value

  return {
    number: new Intl.NumberFormat(activeLocale),
    compactInteger: new Intl.NumberFormat(activeLocale, { maximumFractionDigits: 0 }),
    compactDecimal: new Intl.NumberFormat(activeLocale, { maximumFractionDigits: 1 }),
    percent: new Intl.NumberFormat(activeLocale, {
      style: 'percent',
      maximumFractionDigits: 1
    }),
    date: new Intl.DateTimeFormat(activeLocale, { dateStyle: 'medium' }),
    month: new Intl.DateTimeFormat(activeLocale, { month: 'short' }),
    weekday: new Intl.DateTimeFormat(activeLocale, { weekday: 'short' })
  }
})

const hasData = computed(() => (dashboard.value?.summary.messageCount ?? 0) > 0)

const rtkStatusLabel = computed(() => {
  if (!dashboard.value?.rtk.enabled) {
    return t('settings.dashboard.rtk.status.disabled')
  }

  if (dashboard.value.rtk.health === 'healthy') {
    return rtkSourceLabel.value
  }

  return t(`settings.dashboard.rtk.status.${dashboard.value.rtk.health}`)
})

const rtkSourceLabel = computed(() => {
  const source = dashboard.value?.rtk.source ?? 'none'
  return t(`settings.dashboard.rtk.source.${source}`)
})

const rtkStatusDescription = computed(() => {
  if (!dashboard.value) {
    return ''
  }

  if (!dashboard.value.rtk.enabled) {
    return t('settings.dashboard.rtk.descriptionDisabled')
  }

  if (dashboard.value.rtk.health === 'unhealthy') {
    return dashboard.value.rtk.failureMessage || t('settings.dashboard.rtk.descriptionUnhealthy')
  }

  if (dashboard.value.rtk.health === 'checking') {
    return t('settings.dashboard.rtk.descriptionChecking')
  }

  return ''
})

const rtkStatusBadgeClass = computed(() => {
  if (!dashboard.value?.rtk.enabled) {
    return 'border-border/60 text-muted-foreground'
  }

  if (dashboard.value.rtk.health === 'healthy') {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }

  if (dashboard.value.rtk.health === 'unhealthy') {
    return 'border-destructive/20 bg-destructive/10 text-destructive'
  }

  return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
})

const tokenUsageChartConfig = computed<ChartConfig>(() => ({
  input: {
    label: t('settings.dashboard.summary.inputTokensLabel'),
    color: 'var(--primary-600)'
  },
  output: {
    label: t('settings.dashboard.summary.outputTokensLabel'),
    color: 'hsl(278 72% 72%)'
  },
  cached: {
    label: t('settings.dashboard.summary.cachedTokensCachedLabel'),
    color: 'hsl(var(--usage-low) / 0.92)'
  }
}))

const tokenUsageCard = computed(() => {
  if (!dashboard.value) {
    return null
  }

  const summary = dashboard.value.summary
  const inputTokens = Math.max(summary.inputTokens, 0)
  const outputTokens = Math.max(summary.outputTokens, 0)
  const totalTokens = Math.max(summary.totalTokens, 0)
  const cachedTokens = Math.min(inputTokens, Math.max(summary.cachedInputTokens, 0))
  const totalDenominator = Math.max(totalTokens, 1)

  return {
    totalTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    inputRatio: inputTokens / totalDenominator,
    outputRatio: outputTokens / totalDenominator,
    cachedRatio: inputTokens > 0 ? cachedTokens / inputTokens : 0
  }
})

const calendarDays = computed<CalendarDayView[]>(() =>
  (dashboard.value?.calendar ?? []).map((day) => ({
    ...day,
    cellStyle: calendarCellStyles[day.level]
  }))
)

const calendarWeeks = computed<CalendarCell[][]>(() => {
  const days = calendarDays.value
  if (days.length === 0) {
    return []
  }

  const firstDate = new Date(`${days[0].date}T00:00:00`)
  const weeks: CalendarCell[][] = []
  let currentWeek: CalendarCell[] = Array.from({ length: firstDate.getDay() }, () => null)

  for (const day of days) {
    currentWeek.push(day)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }

  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null)
    }
    weeks.push(currentWeek)
  }

  return weeks
})

const calendarGridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${Math.max(calendarWeeks.value.length, 1)}, minmax(0, 1fr))`
}))

const calendarMonthLabels = computed(() => {
  const labels: Array<{ label: string; weekIndex: number; span: number }> = []
  let lastMonth = ''

  calendarWeeks.value.forEach((week, weekIndex) => {
    const firstDay = week.find(Boolean)
    if (!firstDay) {
      return
    }

    const label = localeFormatters.value.month.format(new Date(`${firstDay.date}T00:00:00`))
    if (label !== lastMonth) {
      labels.push({ label, weekIndex, span: 1 })
      lastMonth = label
      return
    }

    const lastLabel = labels[labels.length - 1]
    if (lastLabel) {
      lastLabel.span += 1
    }
  })

  return labels
})

const weekdayLabels = computed(() => {
  return Array.from({ length: 7 }, (_, dayIndex) => ({
    key: dayIndex,
    label:
      dayIndex === 1 || dayIndex === 3 || dayIndex === 5
        ? localeFormatters.value.weekday.format(new Date(2026, 0, dayIndex + 4))
        : ''
  }))
})

const providerBreakdownCard = computed(() =>
  buildBreakdownCard(dashboard.value?.providerBreakdown ?? [], (item) =>
    t('settings.dashboard.breakdown.messages', { count: item.messageCount })
  )
)

const modelBreakdownCard = computed(() =>
  buildBreakdownCard(dashboard.value?.modelBreakdown ?? [], (item) =>
    item.label !== item.id ? item.id : null
  )
)

async function loadDashboard(): Promise<void> {
  if (!isDashboardMounted) {
    return
  }

  if (dashboardLoadPromise) {
    await dashboardLoadPromise
    return
  }

  stopRefreshTimer()
  const request = runDashboardLoad()
  dashboardLoadPromise = request

  try {
    await request
  } finally {
    if (dashboardLoadPromise === request) {
      dashboardLoadPromise = null
      if (isDashboardMounted) {
        isLoading.value = false
        lastDashboardLoadCompletedAt = Date.now()
        scheduleRefresh()
      }
    }
  }
}

async function runDashboardLoad(): Promise<void> {
  try {
    isLoading.value = true
    errorMessage.value = ''
    const nextDashboard = await sessionClient.getUsageDashboard()
    if (!isDashboardMounted) {
      return
    }
    dashboard.value = nextDashboard
    emit('dashboard-loaded', nextDashboard)
  } catch (error) {
    if (!isDashboardMounted) {
      return
    }
    errorMessage.value =
      error instanceof Error ? error.message : t('settings.dashboard.error.description')
  }
}

async function retryRtkHealthCheck(): Promise<void> {
  if (isRetryingRtk.value) {
    return
  }

  try {
    isRetryingRtk.value = true
    await sessionClient.retryRtkHealthCheck()
    await loadDashboard()
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : t('settings.dashboard.error.description')
  } finally {
    isRetryingRtk.value = false
  }
}

function canScheduleRefresh(): boolean {
  return documentVisibility.value === 'visible' && isWindowFocused.value
}

function scheduleRefresh(): void {
  stopRefreshTimer()

  if (!isDashboardMounted || !dashboard.value || !canScheduleRefresh()) {
    return
  }

  const interval =
    dashboard.value.backfillStatus.status === 'running'
      ? BACKFILL_REFRESH_INTERVAL_MS
      : STABLE_REFRESH_INTERVAL_MS
  const elapsed =
    lastDashboardLoadCompletedAt === null
      ? interval
      : Math.max(Date.now() - lastDashboardLoadCompletedAt, 0)
  const delay = Math.max(interval - elapsed, 0)

  if (delay === 0) {
    void loadDashboard()
    return
  }

  refreshDelay.value = delay
  startRefreshTimer()
}

function buildBreakdownCard(
  items: UsageDashboardData['providerBreakdown'],
  secondaryLabel: (item: UsageDashboardData['providerBreakdown'][number]) => string | null
): {
  rows: BreakdownChartRow[]
} {
  const maxTokens = Math.max(1, ...items.map((item) => item.totalTokens))
  const rows = items.map((item) => ({
    id: item.id,
    label: item.label,
    secondaryLabel: secondaryLabel(item),
    messageCount: item.messageCount,
    totalTokens: item.totalTokens,
    barRatio: item.totalTokens > 0 ? item.totalTokens / maxTokens : 0
  }))

  return {
    rows
  }
}

function formatTokens(value: number): string {
  const absoluteValue = Math.abs(value)
  const compactUnits = [
    { threshold: 1_000_000_000_000, suffix: 't' },
    { threshold: 1_000_000_000, suffix: 'b' },
    { threshold: 1_000_000, suffix: 'm' },
    { threshold: 1_000, suffix: 'k' }
  ]

  for (const unit of compactUnits) {
    if (absoluteValue >= unit.threshold) {
      const compactValue = value / unit.threshold
      const formatter =
        Math.abs(compactValue) >= 100
          ? localeFormatters.value.compactInteger
          : localeFormatters.value.compactDecimal
      return `${formatter.format(compactValue)}${unit.suffix}`
    }
  }

  return formatFullTokens(value)
}

function formatFullTokens(value: number): string {
  return localeFormatters.value.number.format(value)
}

function formatCount(value: number): string {
  return localeFormatters.value.number.format(value)
}

function formatPercent(value: number): string {
  return localeFormatters.value.percent.format(value)
}

function tokenTrendLineColor(series: TokenUsageTrendKey): string {
  switch (series) {
    case 'input':
      return 'var(--primary-600)'
    case 'output':
      return 'hsl(278 72% 72%)'
    case 'cached':
      return 'hsl(var(--usage-low) / 0.92)'
  }
}

function tokenUsageMetricDotStyle(series: TokenUsageTrendKey): { backgroundColor: string } {
  return {
    backgroundColor: tokenTrendLineColor(series)
  }
}

function tokenUsageTooltipDateLabel(value: number | Date): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return localeFormatters.value.date.format(value)
  }

  return t('settings.dashboard.unavailable')
}

const CALENDAR_TOOLTIP_OFFSET = 12

const calendarTooltipStyle = computed<CSSProperties>(() => ({
  left: `${calendarTooltipPosition.value.x}px`,
  top: `${calendarTooltipPosition.value.y}px`
}))

function showCalendarTooltip(day: CalendarDayView, event: MouseEvent): void {
  calendarTooltip.value = {
    date: new Date(`${day.date}T00:00:00`),
    payload: {
      input: formatFullTokens(Math.max(day.inputTokens, 0)),
      output: formatFullTokens(Math.max(day.outputTokens, 0)),
      cached: formatFullTokens(Math.max(day.cachedInputTokens, 0))
    }
  }
  moveCalendarTooltip(event)
}

function moveCalendarTooltip(event: MouseEvent): void {
  const maxX = window.innerWidth - 200
  const maxY = window.innerHeight - 160
  calendarTooltipPosition.value = {
    x: Math.min(event.clientX + CALENDAR_TOOLTIP_OFFSET, Math.max(maxX, 0)),
    y: Math.min(event.clientY + CALENDAR_TOOLTIP_OFFSET, Math.max(maxY, 0))
  }
}

function hideCalendarTooltip(): void {
  calendarTooltip.value = null
}

function breakdownBarStyle(barRatio: number): { width: string } {
  if (barRatio <= 0) {
    return { width: '0%' }
  }

  return {
    width: `${Math.max(barRatio * 100, 1.25)}%`
  }
}

watch(
  [documentVisibility, isWindowFocused],
  ([visibility, focused]) => {
    if (!isDashboardMounted) {
      return
    }

    if (visibility !== 'visible' || !focused) {
      stopRefreshTimer()
      return
    }

    scheduleRefresh()
  },
  { flush: 'sync' }
)

onMounted(() => {
  isDashboardMounted = true
  void loadDashboard()
})

onBeforeUnmount(() => {
  isDashboardMounted = false
})
</script>

<style scoped>
.dashboard-rtk-summary-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
}

.calendar-heatmap {
  --calendar-column-gap: 1px;
  --calendar-row-gap: 1px;
  --calendar-section-gap: 0.375rem;
  --calendar-weekday-width: 1.5rem;
  --calendar-label-font-size: 9px;
  width: 100%;
}

.calendar-months-shell,
.calendar-body {
  display: grid;
  grid-template-columns: var(--calendar-weekday-width) minmax(0, 1fr);
  column-gap: var(--calendar-section-gap);
}

.calendar-months-shell {
  margin-bottom: 0.5rem;
  align-items: end;
}

.calendar-months {
  display: grid;
  min-width: 0;
  column-gap: var(--calendar-column-gap);
}

.calendar-weekday-labels {
  display: grid;
  grid-template-rows: repeat(7, 1fr);
  row-gap: var(--calendar-row-gap);
  min-width: 0;
}

.calendar-weekday-label {
  display: flex;
  align-items: center;
  min-width: 0;
  font-size: var(--calendar-label-font-size);
  line-height: 1;
}

.calendar-weeks {
  display: grid;
  min-width: 0;
  column-gap: var(--calendar-column-gap);
}

.calendar-week {
  display: grid;
  row-gap: var(--calendar-row-gap);
  min-width: 0;
}

.calendar-cell {
  width: 100%;
  aspect-ratio: 1;
  transition:
    transform 160ms ease,
    box-shadow 160ms ease;
}

.calendar-cell:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px hsl(var(--border));
}

.calendar-month-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (min-width: 640px) {
  .calendar-heatmap {
    --calendar-column-gap: 2px;
    --calendar-row-gap: 2px;
    --calendar-section-gap: 0.5rem;
    --calendar-weekday-width: 1.875rem;
    --calendar-label-font-size: 10px;
  }
}

@media (min-width: 1024px) {
  .calendar-heatmap {
    --calendar-column-gap: 3px;
    --calendar-row-gap: 3px;
    --calendar-weekday-width: 2.25rem;
    --calendar-label-font-size: 11px;
  }
}

@media (min-width: 1280px) {
  .calendar-heatmap {
    --calendar-column-gap: 4px;
    --calendar-row-gap: 4px;
    --calendar-weekday-width: 2.5rem;
  }
}
</style>
