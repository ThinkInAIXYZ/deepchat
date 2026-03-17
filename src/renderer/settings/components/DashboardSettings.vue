<template>
  <ScrollArea class="w-full h-full">
    <div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4">
      <section
        class="rounded-3xl border border-border/70 bg-card/90 p-5 shadow-sm backdrop-blur-sm"
      >
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
            v-if="totalTokensCard"
            data-testid="summary-card-totalTokens"
            class="overflow-hidden border-border/70 bg-card/90 backdrop-blur-sm"
          >
            <CardHeader class="space-y-2 pb-3">
              <CardDescription>{{ t('settings.dashboard.summary.totalTokens') }}</CardDescription>
            </CardHeader>
            <CardContent class="pt-0">
              <div class="flex flex-col items-center gap-5">
                <div class="relative flex h-32 w-32 shrink-0 items-center justify-center">
                  <svg
                    viewBox="0 0 120 120"
                    class="h-full w-full -rotate-90"
                    data-testid="total-tokens-donut"
                  >
                    <circle
                      cx="60"
                      cy="60"
                      :r="TOKEN_DONUT_RADIUS"
                      fill="none"
                      stroke="hsl(var(--muted))"
                      stroke-linecap="round"
                      :stroke-width="TOKEN_DONUT_STROKE"
                    />
                    <circle
                      cx="60"
                      cy="60"
                      :r="TOKEN_DONUT_RADIUS"
                      fill="none"
                      stroke="hsl(var(--usage-low))"
                      stroke-linecap="round"
                      :stroke-width="TOKEN_DONUT_STROKE"
                      :stroke-dasharray="`${totalTokensCard.inputLength} ${TOKEN_DONUT_CIRCUMFERENCE}`"
                      stroke-dashoffset="0"
                    />
                    <circle
                      cx="60"
                      cy="60"
                      :r="TOKEN_DONUT_RADIUS"
                      fill="none"
                      stroke="hsl(var(--usage-mid))"
                      stroke-linecap="round"
                      :stroke-width="TOKEN_DONUT_STROKE"
                      :stroke-dasharray="`${totalTokensCard.outputLength} ${TOKEN_DONUT_CIRCUMFERENCE}`"
                      :stroke-dashoffset="`${-totalTokensCard.inputLength}`"
                    />
                  </svg>
                  <div
                    class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
                  >
                    <p
                      class="text-2xl font-semibold tracking-tight"
                      :title="formatFullTokens(totalTokensCard.totalTokens)"
                    >
                      {{ formatTokens(totalTokensCard.totalTokens) }}
                    </p>
                  </div>
                </div>

                <div class="w-full space-y-3">
                  <div
                    data-testid="total-tokens-input-row"
                    class="flex items-start justify-between gap-4 rounded-lg px-1 py-1"
                  >
                    <div class="flex min-w-0 items-center gap-2">
                      <span
                        class="h-2.5 w-2.5 shrink-0 rounded-full bg-[hsl(var(--usage-low))]"
                      ></span>
                      <span class="whitespace-normal text-sm font-medium leading-5">
                        {{ t('settings.dashboard.summary.inputTokensLabel') }}
                      </span>
                    </div>
                    <div class="shrink-0 text-right">
                      <p
                        class="text-base font-semibold leading-none"
                        :title="formatFullTokens(totalTokensCard.inputTokens)"
                      >
                        {{ formatTokens(totalTokensCard.inputTokens) }}
                      </p>
                      <p
                        data-testid="total-tokens-input-ratio"
                        class="mt-1 text-xs text-muted-foreground"
                      >
                        {{ formatPercent(totalTokensCard.inputRatio) }}
                      </p>
                    </div>
                  </div>

                  <div
                    data-testid="total-tokens-output-row"
                    class="flex items-start justify-between gap-4 rounded-lg border-t border-border/50 px-1 pt-3"
                  >
                    <div class="flex min-w-0 items-center gap-2">
                      <span
                        class="h-2.5 w-2.5 shrink-0 rounded-full bg-[hsl(var(--usage-mid))]"
                      ></span>
                      <span class="whitespace-normal text-sm font-medium leading-5">
                        {{ t('settings.dashboard.summary.outputTokensLabel') }}
                      </span>
                    </div>
                    <div class="shrink-0 text-right">
                      <p
                        class="text-base font-semibold leading-none"
                        :title="formatFullTokens(totalTokensCard.outputTokens)"
                      >
                        {{ formatTokens(totalTokensCard.outputTokens) }}
                      </p>
                      <p
                        data-testid="total-tokens-output-ratio"
                        class="mt-1 text-xs text-muted-foreground"
                      >
                        {{ formatPercent(totalTokensCard.outputRatio) }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            v-if="cachedTokensCard"
            data-testid="summary-card-cachedTokens"
            class="overflow-hidden border-border/70 bg-card/90 backdrop-blur-sm"
          >
            <CardHeader class="space-y-2 pb-3">
              <CardDescription>{{ t('settings.dashboard.summary.cachedTokens') }}</CardDescription>
              <CardTitle class="text-3xl" :title="formatFullTokens(cachedTokensCard.cachedTokens)">
                {{ formatTokens(cachedTokensCard.cachedTokens) }}
              </CardTitle>
            </CardHeader>
            <CardContent class="space-y-4">
              <div
                data-testid="cached-tokens-bar"
                class="overflow-hidden rounded-full bg-muted"
                style="height: 10px"
              >
                <div class="flex h-full w-full">
                  <div
                    data-testid="cached-tokens-bar-cached"
                    class="h-full bg-[hsl(var(--usage-low))]"
                    :style="{ width: `${cachedTokensCard.cachedRatio * 100}%` }"
                  ></div>
                  <div
                    data-testid="cached-tokens-bar-uncached"
                    class="h-full bg-muted-foreground/20"
                    :style="{ width: `${cachedTokensCard.uncachedRatio * 100}%` }"
                  ></div>
                </div>
              </div>

              <div class="space-y-3">
                <div
                  data-testid="cached-tokens-cached-row"
                  class="flex items-start justify-between gap-4 rounded-lg px-1 py-1"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class="h-2.5 w-2.5 shrink-0 rounded-full bg-[hsl(var(--usage-low))]"
                    ></span>
                    <span class="whitespace-normal text-sm font-medium leading-5">
                      {{ t('settings.dashboard.summary.cachedTokensCachedLabel') }}
                    </span>
                  </div>
                  <div class="shrink-0 text-right">
                    <p
                      class="text-base font-semibold leading-none"
                      :title="formatFullTokens(cachedTokensCard.cachedTokens)"
                    >
                      {{ formatTokens(cachedTokensCard.cachedTokens) }}
                    </p>
                    <p
                      data-testid="cached-tokens-cached-ratio"
                      class="mt-1 text-xs text-muted-foreground"
                    >
                      {{ formatPercent(cachedTokensCard.cachedRatio) }}
                    </p>
                  </div>
                </div>

                <div
                  data-testid="cached-tokens-uncached-row"
                  class="flex items-start justify-between gap-4 rounded-lg border-t border-border/50 px-1 pt-3"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/50"></span>
                    <span class="whitespace-normal text-sm font-medium leading-5">
                      {{ t('settings.dashboard.summary.cachedTokensUncachedLabel') }}
                    </span>
                  </div>
                  <div class="shrink-0 text-right">
                    <p
                      class="text-base font-semibold leading-none"
                      :title="formatFullTokens(cachedTokensCard.uncachedTokens)"
                    >
                      {{ formatTokens(cachedTokensCard.uncachedTokens) }}
                    </p>
                    <p
                      data-testid="cached-tokens-uncached-ratio"
                      class="mt-1 text-xs text-muted-foreground"
                    >
                      {{ formatPercent(cachedTokensCard.uncachedRatio) }}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            v-if="estimatedCostCard"
            data-testid="summary-card-estimatedCost"
            class="overflow-hidden border-border/70 bg-card/90 backdrop-blur-sm"
          >
            <CardHeader class="space-y-2 pb-3">
              <CardDescription>{{ t('settings.dashboard.summary.estimatedCost') }}</CardDescription>
              <CardTitle class="text-3xl">
                {{ formatCurrency(estimatedCostCard.totalCost) }}
              </CardTitle>
            </CardHeader>
            <CardContent class="space-y-4">
              <div class="overflow-hidden rounded-xl bg-muted/20 px-2 py-3">
                <svg
                  viewBox="0 0 240 64"
                  class="h-16 w-full"
                  data-testid="estimated-cost-sparkline"
                  preserveAspectRatio="none"
                >
                  <line
                    x1="6"
                    :y1="COST_SPARKLINE_HEIGHT - COST_SPARKLINE_PADDING"
                    :x2="COST_SPARKLINE_WIDTH - COST_SPARKLINE_PADDING"
                    :y2="COST_SPARKLINE_HEIGHT - COST_SPARKLINE_PADDING"
                    stroke="hsl(var(--border) / 0.9)"
                    stroke-dasharray="3 4"
                    stroke-linecap="round"
                  />
                  <path
                    :d="estimatedCostCard.linePath"
                    fill="none"
                    stroke="hsl(var(--foreground) / 0.7)"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2.25"
                  />
                  <circle
                    v-for="(point, index) in estimatedCostCard.points"
                    :key="`estimated-cost-point-${index}`"
                    :cx="point.x"
                    :cy="point.y"
                    r="1.8"
                    fill="hsl(var(--background))"
                    stroke="hsl(var(--foreground) / 0.62)"
                    stroke-width="1.35"
                  />
                  <circle
                    v-if="estimatedCostCard.hasRecentCost && estimatedCostCard.lastPoint"
                    :cx="estimatedCostCard.lastPoint.x"
                    :cy="estimatedCostCard.lastPoint.y"
                    r="3.2"
                    fill="hsl(var(--foreground))"
                    stroke="hsl(var(--background))"
                    stroke-width="2"
                  />
                </svg>
              </div>

              <p
                v-if="estimatedCostCard.hasRecentCost"
                data-testid="estimated-cost-trend-label"
                class="text-xs text-muted-foreground"
              >
                {{ t('settings.dashboard.summary.estimatedCostTrendLabel') }}
              </p>
              <p
                v-else
                data-testid="estimated-cost-trend-empty"
                class="text-xs text-muted-foreground"
              >
                {{ t('settings.dashboard.summary.estimatedCostTrendEmpty') }}
              </p>
            </CardContent>
          </Card>

          <Card
            v-if="withDeepChatDaysCard"
            data-testid="summary-card-withDeepChatDays"
            class="overflow-hidden border-border/70 bg-card/90 backdrop-blur-sm"
          >
            <CardHeader class="space-y-2 pb-3">
              <CardDescription>{{
                t('settings.dashboard.summary.withDeepChatDaysLabel')
              }}</CardDescription>
              <CardTitle
                data-testid="with-deepchat-days-value"
                class="break-words whitespace-normal text-3xl leading-tight md:text-4xl"
              >
                {{ withDeepChatDaysCard.value }}
              </CardTitle>
            </CardHeader>
            <CardContent class="space-y-2">
              <p
                v-if="withDeepChatDaysCard.sentence"
                class="whitespace-normal text-sm font-medium leading-6"
              >
                {{ withDeepChatDaysCard.sentence }}
              </p>
              <p class="whitespace-normal text-xs leading-5 text-muted-foreground">
                {{ withDeepChatDaysCard.description }}
              </p>
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
type SparklinePoint = { x: number; y: number }

const { t, locale } = useI18n()
const newAgentPresenter = usePresenter('newAgentPresenter')

const isLoading = ref(true)
const errorMessage = ref('')
const dashboard = ref<UsageDashboardData | null>(null)
let refreshTimer: number | null = null
const MS_PER_DAY = 24 * 60 * 60 * 1000
const TOKEN_DONUT_RADIUS = 38
const TOKEN_DONUT_STROKE = 10
const TOKEN_DONUT_CIRCUMFERENCE = 2 * Math.PI * TOKEN_DONUT_RADIUS
const COST_TREND_DAYS = 30
const COST_SPARKLINE_WIDTH = 240
const COST_SPARKLINE_HEIGHT = 64
const COST_SPARKLINE_PADDING = 6

const hasData = computed(() => (dashboard.value?.summary.messageCount ?? 0) > 0)
const totalTokensCard = computed(() => {
  if (!dashboard.value) {
    return null
  }

  const summary = dashboard.value.summary
  const denominator = Math.max(summary.totalTokens, 1)
  const inputRatio = Math.max(summary.inputTokens, 0) / denominator
  const outputRatio = Math.max(summary.outputTokens, 0) / denominator
  const inputLength = Math.min(TOKEN_DONUT_CIRCUMFERENCE, inputRatio * TOKEN_DONUT_CIRCUMFERENCE)
  const outputLength = Math.min(
    Math.max(0, TOKEN_DONUT_CIRCUMFERENCE - inputLength),
    outputRatio * TOKEN_DONUT_CIRCUMFERENCE
  )

  return {
    totalTokens: summary.totalTokens,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    inputRatio,
    outputRatio,
    inputLength,
    outputLength
  }
})

const cachedTokensCard = computed(() => {
  if (!dashboard.value) {
    return null
  }

  const summary = dashboard.value.summary
  const inputTokens = Math.max(summary.inputTokens, 0)
  const cachedTokens = Math.min(inputTokens, Math.max(summary.cachedInputTokens, 0))
  const uncachedTokens = Math.max(0, inputTokens - cachedTokens)

  return {
    cachedTokens,
    uncachedTokens,
    cachedRatio: inputTokens > 0 ? cachedTokens / inputTokens : 0,
    uncachedRatio: inputTokens > 0 ? uncachedTokens / inputTokens : 0
  }
})

const estimatedCostCard = computed(() => {
  if (!dashboard.value) {
    return null
  }

  const recentCosts = dashboard.value.calendar
    .slice(-COST_TREND_DAYS)
    .map((day) => Math.max(day.estimatedCostUsd ?? 0, 0))
  const hasRecentCost = recentCosts.some((value) => value > 0)
  const points = buildSparklinePoints(recentCosts, hasRecentCost)

  return {
    totalCost: dashboard.value.summary.estimatedCostUsd,
    hasRecentCost,
    linePath: buildSparklineLinePath(points),
    points,
    lastPoint: points[points.length - 1] ?? null
  }
})

const withDeepChatDaysCard = computed(() => {
  if (!dashboard.value) {
    return null
  }

  const days = getDaysWithDeepChat(dashboard.value.recordingStartedAt)

  if (days === null) {
    return {
      value: t('settings.dashboard.unavailable'),
      sentence: null,
      description: t('settings.dashboard.summary.withDeepChatDaysDescriptionUnavailable')
    }
  }

  const formattedDays = new Intl.NumberFormat(locale.value).format(days)

  return {
    value: t('settings.dashboard.summary.withDeepChatDaysValue', {
      days: formattedDays
    }),
    sentence: t('settings.dashboard.summary.withDeepChatDaysSentence', {
      days: formattedDays
    }),
    description: formatWithDeepChatDaysDescription(dashboard.value.recordingStartedAt)
  }
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

function formatPercent(value: number): string {
  return new Intl.NumberFormat(locale.value, {
    style: 'percent',
    maximumFractionDigits: 1
  }).format(value)
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

function formatWithDeepChatDaysDescription(value: number | null): string {
  if (!value) {
    return t('settings.dashboard.summary.withDeepChatDaysDescriptionUnavailable')
  }

  return t('settings.dashboard.summary.withDeepChatDaysDescription', {
    date: formatDate(value)
  })
}

function buildSparklinePoints(values: number[], hasRecentCost: boolean): SparklinePoint[] {
  const normalizedValues =
    values.length >= 2 ? values : values.length === 1 ? [values[0], values[0]] : [0, 0]
  const chartWidth = COST_SPARKLINE_WIDTH - COST_SPARKLINE_PADDING * 2
  const chartHeight = COST_SPARKLINE_HEIGHT - COST_SPARKLINE_PADDING * 2

  if (!hasRecentCost) {
    return normalizedValues.map((_, index) => ({
      x: COST_SPARKLINE_PADDING + (index / Math.max(1, normalizedValues.length - 1)) * chartWidth,
      y: COST_SPARKLINE_HEIGHT - COST_SPARKLINE_PADDING
    }))
  }

  const minValue = Math.min(...normalizedValues)
  const maxValue = Math.max(...normalizedValues)

  return normalizedValues.map((value, index) => {
    const x =
      COST_SPARKLINE_PADDING + (index / Math.max(1, normalizedValues.length - 1)) * chartWidth
    const y =
      maxValue === minValue
        ? COST_SPARKLINE_PADDING + chartHeight / 2
        : COST_SPARKLINE_PADDING +
          chartHeight -
          ((value - minValue) / Math.max(1e-9, maxValue - minValue)) * chartHeight

    return { x, y }
  })
}

function buildSparklineLinePath(points: SparklinePoint[]): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${formatSvgNumber(point.x)} ${formatSvgNumber(point.y)}`
    )
    .join(' ')
}

function formatSvgNumber(value: number): string {
  return value.toFixed(2)
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
