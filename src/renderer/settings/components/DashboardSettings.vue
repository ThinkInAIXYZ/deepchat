<template>
  <ScrollArea class="w-full h-full">
    <div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4">
      <section class="dashboard-hero rounded-3xl border border-border/70 p-5 shadow-sm">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="space-y-2">
            <Badge variant="secondary" class="w-fit">
              {{ t('settings.dashboard.badge') }}
            </Badge>
            <div class="space-y-1">
              <h2 class="text-2xl font-semibold tracking-tight">
                {{ t('settings.dashboard.title') }}
              </h2>
              <p class="max-w-3xl text-sm text-muted-foreground">
                {{ t('settings.dashboard.description') }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span class="rounded-full bg-background/70 px-3 py-1 backdrop-blur-sm">
                {{ t('settings.dashboard.notes.backfill') }}
              </span>
              <span class="rounded-full bg-background/70 px-3 py-1 backdrop-blur-sm">
                {{ t('settings.dashboard.notes.cache') }}
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            class="w-fit"
            :disabled="isLoading"
            @click="void loadDashboard()"
          >
            <Icon
              icon="lucide:refresh-cw"
              class="h-4 w-4"
              :class="isLoading ? 'animate-spin' : ''"
            />
            {{ t('settings.dashboard.actions.refresh') }}
          </Button>
        </div>
      </section>

      <section
        v-if="dashboard?.backfillStatus.status === 'running'"
        data-testid="dashboard-backfill-banner"
        class="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-foreground"
      >
        <div class="flex items-center gap-3">
          <span class="h-2 w-2 rounded-full bg-primary animate-pulse"></span>
          <div class="flex-1">
            <p class="font-medium">{{ t('settings.dashboard.backfill.runningTitle') }}</p>
            <p class="text-muted-foreground">
              {{ t('settings.dashboard.backfill.runningDescription') }}
            </p>
          </div>
        </div>
      </section>

      <section
        v-else-if="dashboard?.backfillStatus.status === 'failed'"
        class="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm"
      >
        <p class="font-medium text-destructive">
          {{ t('settings.dashboard.backfill.failedTitle') }}
        </p>
        <p class="text-muted-foreground">
          {{ dashboard.backfillStatus.error || t('settings.dashboard.backfill.failedDescription') }}
        </p>
      </section>

      <section
        v-if="errorMessage"
        class="rounded-2xl border border-destructive/30 bg-destructive/10 p-4"
      >
        <p class="font-medium text-destructive">{{ t('settings.dashboard.error.title') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ errorMessage }}</p>
      </section>

      <section v-if="isLoading && !dashboard" class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div
          v-for="index in 4"
          :key="index"
          class="h-32 animate-pulse rounded-2xl border border-border bg-muted/40"
        ></div>
      </section>

      <template v-else-if="dashboard">
        <section v-if="hasData" class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card
            v-for="card in summaryCards"
            :key="card.key"
            :data-testid="`summary-card-${card.key}`"
            class="overflow-hidden border-border/70 bg-card/90 backdrop-blur-sm"
          >
            <CardHeader class="space-y-2 pb-3">
              <CardDescription>{{ card.label }}</CardDescription>
              <CardTitle :class="card.valueClass ?? 'text-2xl'" :title="card.tooltip">
                {{ card.value }}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p class="text-xs text-muted-foreground">{{ card.description }}</p>
            </CardContent>
          </Card>
        </section>

        <section
          v-else
          data-testid="dashboard-empty"
          class="rounded-3xl border border-dashed border-border/80 bg-card/80 p-8 text-center"
        >
          <div class="mx-auto max-w-xl space-y-3">
            <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <Icon icon="lucide:layout-dashboard" class="h-7 w-7 text-muted-foreground" />
            </div>
            <h3 class="text-lg font-semibold">{{ t('settings.dashboard.empty.title') }}</h3>
            <p class="text-sm text-muted-foreground">
              {{ t('settings.dashboard.empty.description') }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.dashboard.empty.historyNote') }}
            </p>
          </div>
        </section>

        <Card class="overflow-hidden border-border/70 bg-card/90 backdrop-blur-sm">
          <CardHeader class="pb-4">
            <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div class="space-y-1">
                <CardTitle>{{ t('settings.dashboard.calendar.title') }}</CardTitle>
                <CardDescription>
                  {{ t('settings.dashboard.calendar.description') }}
                </CardDescription>
              </div>
              <div class="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{{ t('settings.dashboard.calendar.legend') }}</span>
                <div class="flex items-center gap-1">
                  <span
                    class="h-3 w-3 rounded-sm border border-border/70"
                    :style="calendarCellStyle(0)"
                  ></span>
                  <span
                    class="h-3 w-3 rounded-sm border border-border/70"
                    :style="calendarCellStyle(1)"
                  ></span>
                  <span
                    class="h-3 w-3 rounded-sm border border-border/70"
                    :style="calendarCellStyle(2)"
                  ></span>
                  <span
                    class="h-3 w-3 rounded-sm border border-border/70"
                    :style="calendarCellStyle(3)"
                  ></span>
                  <span
                    class="h-3 w-3 rounded-sm border border-border/70"
                    :style="calendarCellStyle(4)"
                  ></span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div class="overflow-x-auto pb-2">
              <div class="min-w-[760px]">
                <div class="mb-2 flex pl-12 text-[11px] text-muted-foreground">
                  <div
                    v-for="month in calendarMonthLabels"
                    :key="`${month.label}-${month.weekIndex}`"
                    class="calendar-month-label"
                    :style="{ width: `${month.span * 14}px` }"
                  >
                    {{ month.label }}
                  </div>
                </div>
                <div class="flex gap-2">
                  <div class="mt-1 flex w-10 flex-col gap-1 text-[11px] text-muted-foreground">
                    <span v-for="label in weekdayLabels" :key="label.key" class="h-3 leading-3">
                      {{ label.label }}
                    </span>
                  </div>
                  <div class="flex gap-1">
                    <div
                      v-for="(week, weekIndex) in calendarWeeks"
                      :key="`week-${weekIndex}`"
                      class="flex flex-col gap-1"
                    >
                      <div
                        v-for="(day, dayIndex) in week"
                        :key="day ? day.date : `blank-${weekIndex}-${dayIndex}`"
                        data-testid="calendar-cell"
                        class="calendar-cell rounded-[4px] border border-border/70"
                        :class="day ? 'opacity-100' : 'opacity-0'"
                        :style="day ? calendarCellStyle(day.level) : undefined"
                        :title="day ? calendarCellTitle(day) : ''"
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div class="grid gap-4 xl:grid-cols-2">
          <Card class="border-border/70 bg-card/90 backdrop-blur-sm">
            <CardHeader class="pb-4">
              <CardTitle>{{ t('settings.dashboard.breakdown.providerTitle') }}</CardTitle>
              <CardDescription>
                {{ t('settings.dashboard.breakdown.providerDescription') }}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                v-if="dashboard.providerBreakdown.length === 0"
                class="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground"
              >
                {{ t('settings.dashboard.breakdown.empty') }}
              </div>
              <div
                v-else
                data-testid="provider-breakdown-scroll"
                class="max-h-[420px] space-y-3 overflow-y-auto pr-2"
              >
                <div
                  v-for="item in dashboard.providerBreakdown"
                  :key="item.id"
                  class="rounded-2xl border border-border/70 p-3"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium">{{ item.label }}</p>
                      <p class="text-xs text-muted-foreground">
                        {{
                          t('settings.dashboard.breakdown.messages', { count: item.messageCount })
                        }}
                      </p>
                    </div>
                    <div class="text-right text-xs text-muted-foreground">
                      <p :title="formatFullTokens(item.totalTokens)">
                        {{ formatTokens(item.totalTokens) }}
                      </p>
                      <p>{{ formatCurrency(item.estimatedCostUsd) }}</p>
                    </div>
                  </div>
                  <div class="mt-3 h-2 rounded-full bg-muted">
                    <div
                      class="h-full rounded-full bg-[hsl(var(--usage-low))]"
                      :style="{
                        width: `${getBreakdownWidth(item.totalTokens, providerMaxTokens)}%`
                      }"
                    ></div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card class="border-border/70 bg-card/90 backdrop-blur-sm">
            <CardHeader class="pb-4">
              <CardTitle>{{ t('settings.dashboard.breakdown.modelTitle') }}</CardTitle>
              <CardDescription>
                {{ t('settings.dashboard.breakdown.modelDescription') }}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                v-if="dashboard.modelBreakdown.length === 0"
                class="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground"
              >
                {{ t('settings.dashboard.breakdown.empty') }}
              </div>
              <div
                v-else
                data-testid="model-breakdown-scroll"
                class="max-h-[420px] space-y-3 overflow-y-auto pr-2"
              >
                <div
                  v-for="item in dashboard.modelBreakdown"
                  :key="item.id"
                  class="rounded-2xl border border-border/70 p-3"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium">{{ item.label }}</p>
                      <p
                        v-if="item.label !== item.id"
                        class="truncate text-xs text-muted-foreground"
                      >
                        {{ item.id }}
                      </p>
                    </div>
                    <div class="text-right text-xs text-muted-foreground">
                      <p :title="formatFullTokens(item.totalTokens)">
                        {{ formatTokens(item.totalTokens) }}
                      </p>
                      <p>{{ formatCurrency(item.estimatedCostUsd) }}</p>
                    </div>
                  </div>
                  <div class="mt-3 h-2 rounded-full bg-muted">
                    <div
                      class="h-full rounded-full bg-[hsl(var(--usage-mid))]"
                      :style="{ width: `${getBreakdownWidth(item.totalTokens, modelMaxTokens)}%` }"
                    ></div>
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@shadcn/components/ui/card'
import type { UsageDashboardCalendarDay, UsageDashboardData } from '@shared/types/agent-interface'
import { usePresenter } from '@/composables/usePresenter'

type CalendarCell = UsageDashboardCalendarDay | null

const { t, locale } = useI18n()
const newAgentPresenter = usePresenter('newAgentPresenter')

const isLoading = ref(true)
const errorMessage = ref('')
const dashboard = ref<UsageDashboardData | null>(null)
let refreshTimer: number | null = null
const MS_PER_DAY = 24 * 60 * 60 * 1000

const hasData = computed(() => (dashboard.value?.summary.messageCount ?? 0) > 0)

const summaryCards = computed(() => {
  if (!dashboard.value) {
    return []
  }

  const summary = dashboard.value.summary
  return [
    {
      key: 'totalTokens',
      label: t('settings.dashboard.summary.totalTokens'),
      value: formatTokens(summary.totalTokens),
      tooltip: formatFullTokens(summary.totalTokens),
      description: t('settings.dashboard.summary.totalTokensDescription')
    },
    {
      key: 'cachedTokens',
      label: t('settings.dashboard.summary.cachedTokens'),
      value: formatTokens(summary.cachedInputTokens),
      tooltip: formatFullTokens(summary.cachedInputTokens),
      description: t('settings.dashboard.summary.cachedTokensDescription')
    },
    {
      key: 'estimatedCost',
      label: t('settings.dashboard.summary.estimatedCost'),
      value: formatCurrency(summary.estimatedCostUsd),
      tooltip: undefined,
      description: t('settings.dashboard.summary.estimatedCostDescription')
    },
    {
      key: 'withDeepChatDays',
      label: t('settings.dashboard.summary.withDeepChatDaysLabel'),
      value: formatWithDeepChatDays(dashboard.value.recordingStartedAt),
      tooltip: undefined,
      description: formatWithDeepChatDaysDescription(dashboard.value.recordingStartedAt),
      valueClass: 'break-words whitespace-normal text-base leading-6 md:text-lg'
    }
  ]
})

const calendarWeeks = computed<CalendarCell[][]>(() => {
  const days = dashboard.value?.calendar ?? []
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

const calendarMonthLabels = computed(() => {
  const formatter = new Intl.DateTimeFormat(locale.value, { month: 'short' })
  const labels: Array<{ label: string; weekIndex: number; span: number }> = []
  let lastMonth = ''

  calendarWeeks.value.forEach((week, weekIndex) => {
    const firstDay = week.find(Boolean)
    if (!firstDay) {
      return
    }

    const label = formatter.format(new Date(`${firstDay.date}T00:00:00`))
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
  const formatter = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
  return Array.from({ length: 7 }, (_, dayIndex) => ({
    key: dayIndex,
    label:
      dayIndex === 1 || dayIndex === 3 || dayIndex === 5
        ? formatter.format(new Date(2026, 0, dayIndex + 4))
        : ''
  }))
})

const providerMaxTokens = computed(() =>
  Math.max(1, ...(dashboard.value?.providerBreakdown.map((item) => item.totalTokens) ?? [1]))
)

const modelMaxTokens = computed(() =>
  Math.max(1, ...(dashboard.value?.modelBreakdown.map((item) => item.totalTokens) ?? [1]))
)

async function loadDashboard(): Promise<void> {
  try {
    isLoading.value = true
    errorMessage.value = ''
    dashboard.value = await newAgentPresenter.getUsageDashboard()
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : t('settings.dashboard.error.description')
  } finally {
    isLoading.value = false
    scheduleRefresh()
  }
}

function scheduleRefresh(): void {
  if (refreshTimer) {
    window.clearTimeout(refreshTimer)
    refreshTimer = null
  }

  if (!dashboard.value) {
    return
  }

  const delay = dashboard.value.backfillStatus.status === 'running' ? 3000 : 15000
  refreshTimer = window.setTimeout(() => {
    void loadDashboard()
  }, delay)
}

function calendarCellStyle(level: number): { backgroundColor: string } {
  switch (level) {
    case 4:
      return { backgroundColor: 'hsl(var(--usage-high))' }
    case 3:
      return { backgroundColor: 'hsl(var(--usage-mid))' }
    case 2:
      return { backgroundColor: 'hsl(var(--usage-low) / 0.75)' }
    case 1:
      return { backgroundColor: 'hsl(var(--usage-low) / 0.35)' }
    default:
      return { backgroundColor: 'var(--muted)' }
  }
}

function calendarCellTitle(day: UsageDashboardCalendarDay): string {
  return t('settings.dashboard.calendar.tooltip', {
    date: formatDateKey(day.date),
    tokens: formatFullTokens(day.totalTokens)
  })
}

function getBreakdownWidth(value: number, maxValue: number): number {
  return Math.max(8, Math.round((value / Math.max(1, maxValue)) * 100))
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
      return `${new Intl.NumberFormat(locale.value, {
        maximumFractionDigits: Math.abs(compactValue) >= 100 ? 0 : 1
      }).format(compactValue)}${unit.suffix}`
    }
  }

  return formatFullTokens(value)
}

function formatFullTokens(value: number): string {
  return new Intl.NumberFormat(locale.value).format(value)
}

function formatCurrency(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return t('settings.dashboard.unavailable')
  }

  return new Intl.NumberFormat(locale.value, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1 ? 2 : 4
  }).format(value)
}

function formatDate(value: number | null): string {
  if (!value) {
    return t('settings.dashboard.unavailable')
  }
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(value))
}

function formatDateKey(dateKey: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(
    new Date(`${dateKey}T00:00:00`)
  )
}

function getDaysWithDeepChat(value: number | null): number | null {
  if (!value) {
    return null
  }

  const startedAt = new Date(value)
  const today = new Date()
  const startedAtDay = new Date(startedAt.getFullYear(), startedAt.getMonth(), startedAt.getDate())
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diffDays = Math.floor((todayDay.getTime() - startedAtDay.getTime()) / MS_PER_DAY) + 1

  return Math.max(1, diffDays)
}

function formatWithDeepChatDays(value: number | null): string {
  const days = getDaysWithDeepChat(value)
  if (days === null) {
    return t('settings.dashboard.unavailable')
  }

  return t('settings.dashboard.summary.withDeepChatDaysSentence', {
    days: new Intl.NumberFormat(locale.value).format(days)
  })
}

function formatWithDeepChatDaysDescription(value: number | null): string {
  if (!value) {
    return t('settings.dashboard.summary.withDeepChatDaysDescriptionUnavailable')
  }

  return t('settings.dashboard.summary.withDeepChatDaysDescription', {
    date: formatDate(value)
  })
}

onMounted(() => {
  void loadDashboard()
})

onBeforeUnmount(() => {
  if (refreshTimer) {
    window.clearTimeout(refreshTimer)
    refreshTimer = null
  }
})
</script>

<style scoped>
.dashboard-hero {
  background:
    radial-gradient(circle at top right, hsl(var(--usage-low) / 0.18), transparent 32%),
    linear-gradient(135deg, var(--muted), transparent 55%), var(--card);
}

.calendar-cell {
  width: 12px;
  height: 12px;
  transition:
    transform 160ms ease,
    box-shadow 160ms ease;
}

.calendar-cell:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px hsl(var(--border));
}

.calendar-month-label {
  min-width: 14px;
}
</style>
