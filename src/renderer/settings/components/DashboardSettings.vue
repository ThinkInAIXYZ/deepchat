<template>
  <ScrollArea class="h-full w-full">
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
          <span class="h-2 w-2 animate-pulse rounded-full bg-primary"></span>
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

      <section v-if="isLoading && !dashboard" class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div
          class="h-56 animate-pulse rounded-2xl border border-border bg-muted/40 md:col-span-2 xl:col-span-2"
        ></div>
        <div class="h-56 animate-pulse rounded-2xl border border-border bg-muted/40"></div>
        <div class="h-56 animate-pulse rounded-2xl border border-border bg-muted/40"></div>
      </section>

      <template v-else-if="dashboard">
        <section v-if="hasData" class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Card
            v-if="tokenUsageCard"
            data-testid="summary-card-tokenUsage"
            class="h-full overflow-hidden border-border/70 bg-card/90 backdrop-blur-sm md:col-span-2 xl:col-span-2"
          >
            <CardHeader class="space-y-1 pb-2">
              <CardDescription>{{ t('settings.dashboard.summary.tokenUsage') }}</CardDescription>
            </CardHeader>
            <CardContent
              class="grid gap-5 pt-0 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)] md:items-center"
            >
              <div class="flex justify-center md:justify-start">
                <div
                  data-testid="total-tokens-donut"
                  class="w-full max-w-[172px]"
                  :style="{
                    '--vis-donut-background-color': 'hsl(var(--muted))',
                    '--vis-dark-donut-background-color': 'hsl(var(--muted))'
                  }"
                >
                  <ChartContainer
                    :config="totalTokensChartConfig"
                    class="aspect-auto h-[152px] w-full"
                  >
                    <div class="relative h-full">
                      <VisSingleContainer
                        :data="tokenUsageCard.segments"
                        :height="TOTAL_TOKENS_DONUT_HEIGHT"
                        :margin="{ top: 10, bottom: 10, left: 10, right: 10 }"
                      >
                        <VisDonut
                          :value="totalTokenSegmentValue"
                          :color="totalTokenSegmentColor"
                          :radius="TOTAL_TOKENS_DONUT_RADIUS"
                          :arc-width="TOTAL_TOKENS_DONUT_ARC_WIDTH"
                          :pad-angle="0.03"
                          :corner-radius="12"
                          :show-background="true"
                        />
                      </VisSingleContainer>

                      <div
                        class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
                      >
                        <p
                          class="text-xl font-semibold tracking-tight"
                          :title="formatFullTokens(tokenUsageCard.totalTokens)"
                        >
                          {{ formatTokens(tokenUsageCard.totalTokens) }}
                        </p>
                        <p
                          class="mt-1 text-[8px] uppercase tracking-[0.12em] text-muted-foreground"
                        >
                          {{ t('settings.dashboard.summary.totalTokens') }}
                        </p>
                      </div>
                    </div>
                  </ChartContainer>
                </div>
              </div>

              <div
                data-testid="token-usage-list"
                class="rounded-xl border border-border/50 bg-muted/10 px-3"
              >
                <div class="flex items-center justify-between gap-3 py-2.5">
                  <span class="text-sm font-medium text-foreground">
                    {{ t('settings.dashboard.summary.totalTokens') }}
                  </span>
                  <span
                    class="shrink-0 text-sm font-semibold tracking-tight"
                    :title="formatFullTokens(tokenUsageCard.totalTokens)"
                  >
                    {{ formatTokens(tokenUsageCard.totalTokens) }}
                  </span>
                </div>

                <div
                  data-testid="total-tokens-input-row"
                  class="flex items-center justify-between gap-3 border-t border-border/40 py-2.5"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class="h-2.5 w-2.5 shrink-0 rounded-full bg-[hsl(var(--usage-low))]"
                    ></span>
                    <span class="whitespace-normal text-sm font-medium leading-4">
                      {{ t('settings.dashboard.summary.inputTokensLabel') }}
                    </span>
                  </div>
                  <div class="flex shrink-0 items-baseline gap-2">
                    <span
                      class="text-sm font-semibold tracking-tight"
                      :title="formatFullTokens(tokenUsageCard.inputTokens)"
                    >
                      {{ formatTokens(tokenUsageCard.inputTokens) }}
                    </span>
                    <span
                      data-testid="total-tokens-input-ratio"
                      class="text-xs font-medium text-muted-foreground"
                    >
                      {{ formatPercent(tokenUsageCard.inputRatio) }}
                    </span>
                  </div>
                </div>

                <div
                  data-testid="total-tokens-output-row"
                  class="flex items-center justify-between gap-3 border-t border-border/40 py-2.5"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class="h-2.5 w-2.5 shrink-0 rounded-full bg-[hsl(var(--usage-mid))]"
                    ></span>
                    <span class="whitespace-normal text-sm font-medium leading-4">
                      {{ t('settings.dashboard.summary.outputTokensLabel') }}
                    </span>
                  </div>
                  <div class="flex shrink-0 items-baseline gap-2">
                    <span
                      class="text-sm font-semibold tracking-tight"
                      :title="formatFullTokens(tokenUsageCard.outputTokens)"
                    >
                      {{ formatTokens(tokenUsageCard.outputTokens) }}
                    </span>
                    <span
                      data-testid="total-tokens-output-ratio"
                      class="text-xs font-medium text-muted-foreground"
                    >
                      {{ formatPercent(tokenUsageCard.outputRatio) }}
                    </span>
                  </div>
                </div>

                <div
                  data-testid="cached-tokens-cached-row"
                  class="flex items-center justify-between gap-3 border-t border-border/40 py-2.5"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class="h-2.5 w-2.5 shrink-0 rounded-full bg-[hsl(var(--usage-low) / 0.75)]"
                    ></span>
                    <span class="whitespace-normal text-sm font-medium leading-4">
                      {{ t('settings.dashboard.summary.cachedTokensCachedLabel') }}
                    </span>
                  </div>
                  <div class="flex shrink-0 items-baseline gap-2">
                    <span
                      class="text-sm font-semibold tracking-tight"
                      :title="formatFullTokens(tokenUsageCard.cachedTokens)"
                    >
                      {{ formatTokens(tokenUsageCard.cachedTokens) }}
                    </span>
                    <span
                      data-testid="cached-tokens-cached-ratio"
                      class="text-xs font-medium text-muted-foreground"
                    >
                      {{ formatPercent(tokenUsageCard.cachedRatio) }}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            v-if="estimatedCostCard"
            data-testid="summary-card-estimatedCost"
            class="flex h-full flex-col overflow-hidden border-border/70 bg-card/90 backdrop-blur-sm"
          >
            <CardHeader class="space-y-1 pb-1">
              <CardDescription>{{ t('settings.dashboard.summary.estimatedCost') }}</CardDescription>
              <CardTitle class="text-xl font-semibold tracking-tight">
                {{ formatCurrency(estimatedCostCard.totalCost) }}
              </CardTitle>
            </CardHeader>
            <CardContent class="flex flex-1 flex-col justify-between space-y-2 pt-0">
              <div
                data-testid="estimated-cost-area-chart"
                class="rounded-lg border border-border/50 bg-muted/10 px-2.5 py-2"
              >
                <ChartContainer :config="estimatedCostChartConfig" class="aspect-auto h-14 w-full">
                  <VisXYContainer
                    :data="estimatedCostCard.chartData"
                    :height="ESTIMATED_COST_CHART_HEIGHT"
                    :padding="{ top: 4, bottom: 2, left: 0, right: 0 }"
                    :margin="{ top: 0, bottom: 0, left: 0, right: 0 }"
                    :x-domain="[0, Math.max(estimatedCostCard.chartData.length - 1, 1)]"
                    :y-domain="estimatedCostCard.yDomain"
                  >
                    <ChartCrosshair :hide-when-far-from-pointer="true" />
                    <VisArea
                      :x="costTrendXAccessor"
                      :y="costTrendYAccessor"
                      :curve-type="CurveType.MonotoneX"
                      :color="estimatedCostAreaColor"
                      :opacity="0.24"
                      :line="true"
                      :line-color="estimatedCostLineColor"
                      :line-width="2.1"
                    />
                  </VisXYContainer>
                </ChartContainer>
              </div>

              <p
                v-if="estimatedCostCard.hasRecentCost"
                data-testid="estimated-cost-trend-label"
                class="text-[10px] text-muted-foreground"
              >
                {{ t('settings.dashboard.summary.estimatedCostTrendLabel') }}
              </p>
              <p
                v-else
                data-testid="estimated-cost-trend-empty"
                class="text-[10px] text-muted-foreground"
              >
                {{ t('settings.dashboard.summary.estimatedCostTrendEmpty') }}
              </p>
            </CardContent>
          </Card>

          <Card
            v-if="withDeepChatDaysCard"
            data-testid="summary-card-withDeepChatDays"
            class="flex h-full flex-col overflow-hidden border-border/70 bg-card/90 backdrop-blur-sm"
          >
            <CardHeader class="space-y-1 pb-1">
              <CardDescription>{{
                t('settings.dashboard.summary.withDeepChatDaysLabel')
              }}</CardDescription>
              <CardTitle
                data-testid="with-deepchat-days-value"
                class="break-words whitespace-normal text-xl font-semibold leading-tight tracking-tight sm:text-2xl"
              >
                {{ withDeepChatDaysCard.value }}
              </CardTitle>
            </CardHeader>
            <CardContent class="flex flex-1 flex-col justify-between space-y-2 pt-0">
              <p
                v-if="withDeepChatDaysCard.sentence"
                class="whitespace-normal text-sm font-medium leading-5"
              >
                {{ withDeepChatDaysCard.sentence }}
              </p>
              <p
                class="rounded-lg bg-muted/10 px-2.5 py-2 text-[10px] leading-[1.125rem] text-muted-foreground"
              >
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
                class="max-h-[420px] overflow-y-auto pr-2"
              >
                <div class="min-w-[540px]">
                  <div
                    class="relative"
                    :style="{ height: `${providerBreakdownCard.chartHeight}px` }"
                  >
                    <div
                      data-testid="provider-breakdown-chart"
                      class="absolute inset-y-0"
                      :style="breakdownChartRegionStyle"
                    >
                      <ChartContainer
                        :config="providerBreakdownChartConfig"
                        class="aspect-auto h-full w-full"
                      >
                        <VisXYContainer
                          :data="providerBreakdownCard.rows"
                          :height="providerBreakdownCard.chartHeight"
                          :padding="breakdownChartPadding"
                          :margin="{ top: 0, bottom: 0, left: 0, right: 0 }"
                          :x-domain="providerBreakdownCard.xDomain"
                          :y-domain="providerBreakdownCard.yDomain"
                          y-direction="south"
                        >
                          <VisStackedBar
                            :x="breakdownIndexAccessor"
                            :y="breakdownStackedAccessors"
                            :orientation="Orientation.Horizontal"
                            :bar-padding="0.72"
                            :bar-max-width="18"
                            :rounded-corners="999"
                            :color="providerBreakdownBarColor"
                          />
                        </VisXYContainer>
                      </ChartContainer>
                    </div>

                    <div class="pointer-events-none absolute inset-0">
                      <div
                        v-for="item in providerBreakdownCard.rows"
                        :key="item.id"
                        class="grid items-center gap-4 border-b border-border/40 last:border-b-0"
                        :style="breakdownRowGridStyle"
                      >
                        <div class="min-w-0">
                          <p class="truncate text-sm font-medium">{{ item.label }}</p>
                          <p class="text-xs text-muted-foreground">
                            {{
                              t('settings.dashboard.breakdown.messages', {
                                count: item.messageCount
                              })
                            }}
                          </p>
                        </div>
                        <div></div>
                        <div class="text-right text-xs text-muted-foreground">
                          <p :title="formatFullTokens(item.totalTokens)">
                            {{ formatTokens(item.totalTokens) }}
                          </p>
                          <p>{{ formatCurrency(item.estimatedCostUsd) }}</p>
                        </div>
                      </div>
                    </div>
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
                class="max-h-[420px] overflow-y-auto pr-2"
              >
                <div class="min-w-[540px]">
                  <div class="relative" :style="{ height: `${modelBreakdownCard.chartHeight}px` }">
                    <div
                      data-testid="model-breakdown-chart"
                      class="absolute inset-y-0"
                      :style="breakdownChartRegionStyle"
                    >
                      <ChartContainer
                        :config="modelBreakdownChartConfig"
                        class="aspect-auto h-full w-full"
                      >
                        <VisXYContainer
                          :data="modelBreakdownCard.rows"
                          :height="modelBreakdownCard.chartHeight"
                          :padding="breakdownChartPadding"
                          :margin="{ top: 0, bottom: 0, left: 0, right: 0 }"
                          :x-domain="modelBreakdownCard.xDomain"
                          :y-domain="modelBreakdownCard.yDomain"
                          y-direction="south"
                        >
                          <VisStackedBar
                            :x="breakdownIndexAccessor"
                            :y="breakdownStackedAccessors"
                            :orientation="Orientation.Horizontal"
                            :bar-padding="0.72"
                            :bar-max-width="18"
                            :rounded-corners="999"
                            :color="modelBreakdownBarColor"
                          />
                        </VisXYContainer>
                      </ChartContainer>
                    </div>

                    <div class="pointer-events-none absolute inset-0">
                      <div
                        v-for="item in modelBreakdownCard.rows"
                        :key="item.id"
                        class="grid items-center gap-4 border-b border-border/40 last:border-b-0"
                        :style="breakdownRowGridStyle"
                      >
                        <div class="min-w-0">
                          <p class="truncate text-sm font-medium">{{ item.label }}</p>
                          <p
                            v-if="item.secondaryLabel"
                            class="truncate text-xs text-muted-foreground"
                          >
                            {{ item.secondaryLabel }}
                          </p>
                        </div>
                        <div></div>
                        <div class="text-right text-xs text-muted-foreground">
                          <p :title="formatFullTokens(item.totalTokens)">
                            {{ formatTokens(item.totalTokens) }}
                          </p>
                          <p>{{ formatCurrency(item.estimatedCostUsd) }}</p>
                        </div>
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { CurveType, Orientation } from '@unovis/ts'
import { VisArea, VisDonut, VisSingleContainer, VisStackedBar, VisXYContainer } from '@unovis/vue'
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
import { ChartContainer, ChartCrosshair } from '@shadcn/components/ui/chart'
import type { ChartConfig } from '@shadcn/components/ui/chart'
import type { UsageDashboardCalendarDay, UsageDashboardData } from '@shared/types/agent-interface'
import { usePresenter } from '@/composables/usePresenter'

type CalendarCell = UsageDashboardCalendarDay | null
type TotalTokenSegmentKey = 'input' | 'output'
type TotalTokenSegment = {
  key: TotalTokenSegmentKey
  value: number
}
type CostTrendPoint = {
  index: number
  date: string
  cost: number
  displayCost: number
}
type BreakdownChartRow = {
  id: string
  label: string
  secondaryLabel: string | null
  messageCount: number
  totalTokens: number
  estimatedCostUsd: number | null
  index: number
}

const { t, locale } = useI18n()
const newAgentPresenter = usePresenter('newAgentPresenter')

const isLoading = ref(true)
const errorMessage = ref('')
const dashboard = ref<UsageDashboardData | null>(null)
let refreshTimer: number | null = null

const MS_PER_DAY = 24 * 60 * 60 * 1000
const COST_TREND_DAYS = 30
const TOTAL_TOKENS_DONUT_HEIGHT = 152
const TOTAL_TOKENS_DONUT_RADIUS = 48
const TOTAL_TOKENS_DONUT_ARC_WIDTH = 10
const ESTIMATED_COST_CHART_HEIGHT = 44
const BREAKDOWN_ROW_HEIGHT = 64
const BREAKDOWN_LABEL_WIDTH = 176
const BREAKDOWN_METRIC_WIDTH = 96
const BREAKDOWN_CHART_GAP = 16

const hasData = computed(() => (dashboard.value?.summary.messageCount ?? 0) > 0)

const totalTokensChartConfig = computed<ChartConfig>(() => ({
  input: {
    label: t('settings.dashboard.summary.inputTokensLabel'),
    color: 'hsl(var(--usage-low))'
  },
  output: {
    label: t('settings.dashboard.summary.outputTokensLabel'),
    color: 'hsl(var(--usage-mid))'
  }
}))

const estimatedCostChartConfig = computed<ChartConfig>(() => ({
  cost: {
    label: t('settings.dashboard.summary.estimatedCost'),
    color: 'hsl(var(--chart-3))'
  }
}))

const providerBreakdownChartConfig = computed<ChartConfig>(() => ({
  tokens: {
    label: t('settings.dashboard.summary.totalTokens'),
    color: 'hsl(var(--chart-1))'
  }
}))

const modelBreakdownChartConfig = computed<ChartConfig>(() => ({
  tokens: {
    label: t('settings.dashboard.summary.totalTokens'),
    color: 'hsl(var(--chart-3))'
  }
}))

const tokenUsageCard = computed(() => {
  if (!dashboard.value) {
    return null
  }

  const summary = dashboard.value.summary
  const inputTokens = Math.max(summary.inputTokens, 0)
  const outputTokens = Math.max(summary.outputTokens, 0)
  const cachedTokens = Math.min(inputTokens, Math.max(summary.cachedInputTokens, 0))
  const denominator = Math.max(summary.totalTokens, 1)

  return {
    totalTokens: summary.totalTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    inputRatio: inputTokens / denominator,
    outputRatio: outputTokens / denominator,
    cachedRatio: inputTokens > 0 ? cachedTokens / inputTokens : 0,
    segments: [
      { key: 'input', value: inputTokens },
      { key: 'output', value: outputTokens }
    ] as TotalTokenSegment[]
  }
})

const estimatedCostCard = computed(() => {
  if (!dashboard.value) {
    return null
  }

  const recentDays = dashboard.value.calendar.slice(-COST_TREND_DAYS)
  const normalizedDays =
    recentDays.length >= 2
      ? recentDays
      : recentDays.length === 1
        ? [recentDays[0], recentDays[0]]
        : [
            {
              date: '',
              estimatedCostUsd: null
            },
            {
              date: '',
              estimatedCostUsd: null
            }
          ]

  const points = normalizedDays.map((day, index) => ({
    index,
    date: day.date,
    cost: Math.max(day.estimatedCostUsd ?? 0, 0),
    displayCost: Math.max(day.estimatedCostUsd ?? 0, 0)
  }))
  const hasRecentCost = points.some((point) => point.cost > 0)
  const chartData = hasRecentCost
    ? points
    : points.map((point) => ({
        ...point,
        displayCost: 0.5
      }))
  const maxCost = hasRecentCost ? Math.max(...points.map((point) => point.cost), 0) : 1

  return {
    totalCost: dashboard.value.summary.estimatedCostUsd,
    hasRecentCost,
    chartData,
    yDomain: [0, hasRecentCost ? Math.max(maxCost * 1.12, 0.001) : 1] as [number, number]
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

const breakdownChartPadding = {
  top: 18,
  bottom: 18,
  left: 0,
  right: 0
}

const breakdownChartRegionStyle = {
  left: `${BREAKDOWN_LABEL_WIDTH + BREAKDOWN_CHART_GAP}px`,
  right: `${BREAKDOWN_METRIC_WIDTH + BREAKDOWN_CHART_GAP}px`
}

const breakdownRowGridStyle = {
  height: `${BREAKDOWN_ROW_HEIGHT}px`,
  gridTemplateColumns: `${BREAKDOWN_LABEL_WIDTH}px minmax(0, 1fr) ${BREAKDOWN_METRIC_WIDTH}px`
}

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

function buildBreakdownCard(
  items: UsageDashboardData['providerBreakdown'],
  secondaryLabel: (item: UsageDashboardData['providerBreakdown'][number]) => string | null
): {
  rows: BreakdownChartRow[]
  chartHeight: number
  xDomain: [number, number]
  yDomain: [number, number]
} {
  const rows = items.map((item, index) => ({
    id: item.id,
    label: item.label,
    secondaryLabel: secondaryLabel(item),
    messageCount: item.messageCount,
    totalTokens: item.totalTokens,
    estimatedCostUsd: item.estimatedCostUsd,
    index
  }))
  const maxTokens = Math.max(1, ...rows.map((item) => item.totalTokens))

  return {
    rows,
    chartHeight: Math.max(rows.length * BREAKDOWN_ROW_HEIGHT, BREAKDOWN_ROW_HEIGHT),
    xDomain: [0, maxTokens * 1.06] as [number, number],
    yDomain: [-0.5, Math.max(rows.length - 0.5, 0.5)] as [number, number]
  }
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

function totalTokenSegmentValue(segment: TotalTokenSegment): number {
  return segment.value
}

function totalTokenSegmentColor(segment: TotalTokenSegment): string {
  return `var(--color-${segment.key})`
}

const costTrendXAccessor = (point: CostTrendPoint): number => point.index
const costTrendYAccessor = (point: CostTrendPoint): number => point.displayCost

function estimatedCostAreaColor(): string {
  return 'var(--color-primary-400)'
}

function estimatedCostLineColor(): string {
  return 'var(--color-primary-500)'
}

const breakdownIndexAccessor = (item: BreakdownChartRow): number => item.index

const breakdownStackedAccessors = [(item: BreakdownChartRow) => item.totalTokens]

function providerBreakdownBarColor(): string {
  return 'var(--color-tokens)'
}

function modelBreakdownBarColor(): string {
  return 'var(--color-tokens)'
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

:deep([data-slot='chart']) .unovis-xy-container,
:deep([data-slot='chart']) .unovis-single-container {
  overflow: visible;
}
</style>
