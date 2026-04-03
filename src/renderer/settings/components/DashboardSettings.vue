<template>
  <ScrollArea class="h-full w-full">
    <div class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4">
      <div
        data-testid="dashboard-header"
        class="flex flex-col gap-3 px-2 py-2 sm:flex-row sm:items-start sm:justify-between"
      >
        <div class="min-w-0 flex-1">
          <h2 class="text-sm font-medium text-foreground">
            {{ t('settings.dashboard.title') }}
          </h2>
          <p class="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
            {{ t('settings.dashboard.description') }}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="w-full shrink-0 sm:w-auto"
          :disabled="isLoading"
          @click="void loadDashboard()"
        >
          <Icon
            icon="lucide:refresh-cw"
            class="mr-2 h-4 w-4"
            :class="isLoading ? 'animate-spin' : ''"
          />
          {{ t('settings.dashboard.actions.refresh') }}
        </Button>
      </div>

      <section
        v-if="dashboard?.backfillStatus.status === 'running'"
        data-testid="dashboard-backfill-banner"
        class="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-foreground"
      >
        <div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
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
          class="h-68 animate-pulse rounded-2xl border border-border bg-muted/40 md:col-span-2 xl:col-span-3"
        ></div>
        <div
          class="h-68 animate-pulse rounded-2xl border border-border bg-muted/40 md:col-span-2 xl:col-span-1"
        ></div>
      </section>

      <template v-else-if="dashboard">
        <section v-if="hasData" class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Card
            v-if="tokenUsageCard"
            data-testid="summary-card-tokenUsage"
            class="h-full overflow-hidden border-border/70 bg-card/90 backdrop-blur-sm md:col-span-2 xl:col-span-3"
          >
            <CardHeader class="space-y-1 pb-1">
              <CardDescription>{{ t('settings.dashboard.summary.tokenUsage') }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-4 pt-0">
              <div
                data-testid="token-usage-trend-chart"
                class="token-usage-trend-grid rounded-xl border border-border/40 bg-muted/10 px-2 py-2.5 sm:px-3 sm:py-3"
              >
                <ChartContainer :config="tokenUsageChartConfig" class="aspect-auto h-46 w-full">
                  <VisXYContainer
                    :data="tokenUsageCard.chartData"
                    :height="TOKEN_USAGE_CHART_HEIGHT"
                    :padding="{ top: 12, bottom: 14, left: 0, right: 0 }"
                    :margin="{ top: 0, bottom: 0, left: 0, right: 0 }"
                    :x-domain="[0, Math.max(tokenUsageCard.chartData.length - 1, 1)]"
                    :y-domain="tokenUsageCard.yDomain"
                  >
                    <ChartCrosshair
                      :data="tokenUsageCard.chartData"
                      :hide-when-far-from-pointer="true"
                      :tooltip="tokenUsageTooltip?.component"
                      :template="tokenUsageTooltipTemplate"
                      :x="tokenTrendXAccessor"
                      :y="tokenTrendYAccessors"
                    />
                    <ChartTooltip
                      ref="tokenUsageTooltip"
                      :attributes="{ 'data-testid': 'token-usage-tooltip' }"
                    />
                    <VisArea
                      :x="tokenTrendXAccessor"
                      :y="tokenTrendInputAccessor"
                      :curve-type="CurveType.MonotoneX"
                      :color="tokenTrendAreaColor('input')"
                      :opacity="0.08"
                      :line="true"
                      :line-color="tokenTrendLineColor('input')"
                      :line-width="2.2"
                    />
                    <VisArea
                      :x="tokenTrendXAccessor"
                      :y="tokenTrendOutputAccessor"
                      :curve-type="CurveType.MonotoneX"
                      :color="tokenTrendAreaColor('output')"
                      :opacity="0.04"
                      :line="true"
                      :line-color="tokenTrendLineColor('output')"
                      :line-width="1.9"
                    />
                    <VisArea
                      :x="tokenTrendXAccessor"
                      :y="tokenTrendCachedAccessor"
                      :curve-type="CurveType.MonotoneX"
                      :color="tokenTrendAreaColor('cached')"
                      :opacity="0.05"
                      :line="true"
                      :line-color="tokenTrendLineColor('cached')"
                      :line-width="1.9"
                    />
                    <VisArea
                      :x="tokenTrendXAccessor"
                      :y="tokenTrendCostAccessor"
                      :curve-type="CurveType.MonotoneX"
                      :color="tokenTrendAreaColor('cost')"
                      :opacity="0.04"
                      :line="true"
                      :line-color="tokenTrendLineColor('cost')"
                      :line-width="1.9"
                    />
                  </VisXYContainer>
                </ChartContainer>
              </div>

              <div data-testid="token-usage-list" class="dashboard-token-usage-list grid gap-2">
                <div
                  data-testid="token-usage-total-row"
                  class="rounded-lg border border-border/30 bg-muted/5 px-3 py-2.5"
                >
                  <p
                    class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                  >
                    {{ t('settings.dashboard.summary.totalTokens') }}
                  </p>
                  <p
                    class="mt-1 text-sm font-semibold tracking-tight"
                    :title="formatFullTokens(tokenUsageCard.totalTokens)"
                  >
                    {{ formatTokens(tokenUsageCard.totalTokens) }}
                  </p>
                </div>

                <div
                  data-testid="total-tokens-input-row"
                  class="rounded-lg border border-border/30 bg-muted/5 px-3 py-2.5"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      data-testid="token-usage-input-dot"
                      class="h-2.5 w-2.5 shrink-0 rounded-full border border-card shadow-[0_0_0_1px_hsl(var(--border)/0.18)]"
                      :style="tokenUsageMetricDotStyle('input')"
                    ></span>
                    <span
                      class="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                    >
                      {{ t('settings.dashboard.summary.inputTokensLabel') }}
                    </span>
                  </div>
                  <p
                    class="mt-1 text-sm font-semibold tracking-tight"
                    :title="formatFullTokens(tokenUsageCard.inputTokens)"
                  >
                    {{ formatTokens(tokenUsageCard.inputTokens) }}
                  </p>
                  <p
                    data-testid="total-tokens-input-ratio"
                    class="text-[11px] font-medium text-muted-foreground"
                  >
                    {{ formatPercent(tokenUsageCard.inputRatio) }}
                  </p>
                </div>

                <div
                  data-testid="total-tokens-output-row"
                  class="rounded-lg border border-border/30 bg-muted/5 px-3 py-2.5"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      data-testid="token-usage-output-dot"
                      class="h-2.5 w-2.5 shrink-0 rounded-full border border-card shadow-[0_0_0_1px_hsl(var(--border)/0.18)]"
                      :style="tokenUsageMetricDotStyle('output')"
                    ></span>
                    <span
                      class="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                    >
                      {{ t('settings.dashboard.summary.outputTokensLabel') }}
                    </span>
                  </div>
                  <p
                    class="mt-1 text-sm font-semibold tracking-tight"
                    :title="formatFullTokens(tokenUsageCard.outputTokens)"
                  >
                    {{ formatTokens(tokenUsageCard.outputTokens) }}
                  </p>
                  <p
                    data-testid="total-tokens-output-ratio"
                    class="text-[11px] font-medium text-muted-foreground"
                  >
                    {{ formatPercent(tokenUsageCard.outputRatio) }}
                  </p>
                </div>

                <div
                  data-testid="cached-tokens-cached-row"
                  class="rounded-lg border border-border/30 bg-muted/5 px-3 py-2.5"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      data-testid="token-usage-cached-dot"
                      class="h-2.5 w-2.5 shrink-0 rounded-full border border-card shadow-[0_0_0_1px_hsl(var(--border)/0.18)]"
                      :style="tokenUsageMetricDotStyle('cached')"
                    ></span>
                    <span
                      class="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                    >
                      {{ t('settings.dashboard.summary.cachedTokensCachedLabel') }}
                    </span>
                  </div>
                  <p
                    class="mt-1 text-sm font-semibold tracking-tight"
                    :title="formatFullTokens(tokenUsageCard.cachedTokens)"
                  >
                    {{ formatTokens(tokenUsageCard.cachedTokens) }}
                  </p>
                  <p
                    data-testid="cached-tokens-cached-ratio"
                    class="text-[11px] font-medium text-muted-foreground"
                  >
                    {{ formatPercent(tokenUsageCard.cachedRatio) }}
                  </p>
                </div>

                <div
                  data-testid="token-usage-cost-row"
                  class="rounded-lg border border-border/30 bg-muted/5 px-3 py-2.5"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      data-testid="token-usage-cost-dot"
                      class="h-2.5 w-2.5 shrink-0 rounded-full border border-card shadow-[0_0_0_1px_hsl(var(--border)/0.18)]"
                      :style="tokenUsageMetricDotStyle('cost')"
                    ></span>
                    <span
                      class="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                    >
                      {{ t('settings.dashboard.summary.estimatedCost') }}
                    </span>
                  </div>
                  <p class="mt-1 text-sm font-semibold tracking-tight">
                    {{ formatCurrency(tokenUsageCard.totalCost) }}
                  </p>
                  <p class="text-[11px] font-medium text-muted-foreground">
                    {{ t('settings.dashboard.summary.estimatedCostTrendLabel') }}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            v-if="nostalgiaCard"
            data-testid="summary-card-nostalgia"
            class="flex h-full flex-col overflow-hidden border-border/70 bg-card/90 backdrop-blur-sm md:col-span-2 xl:col-span-1"
          >
            <CardHeader class="space-y-1 pb-1">
              <CardTitle class="wrap-break-word whitespace-normal text-base leading-tight">
                {{ t('settings.dashboard.summary.nostalgiaLabel') }}
              </CardTitle>
            </CardHeader>
            <CardContent
              class="flex flex-1 flex-col gap-3 pt-0 lg:grid lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:items-start lg:gap-4 xl:flex xl:flex-col"
            >
              <div class="flex min-h-18 items-start sm:min-h-20">
                <Transition name="nostalgia-fade" mode="out-in">
                  <CardTitle
                    :key="activeNostalgiaStat?.id ?? 'unavailable'"
                    data-testid="nostalgia-rotating-value"
                    class="wrap-break-word whitespace-normal text-2xl font-semibold leading-tight tracking-tight sm:text-3xl"
                  >
                    {{ activeNostalgiaStat?.value ?? t('settings.dashboard.unavailable') }}
                  </CardTitle>
                </Transition>
              </div>

              <div data-testid="nostalgia-details" class="space-y-2 lg:pt-0.5">
                <div
                  v-for="item in nostalgiaCard.details"
                  :key="item.id"
                  :data-testid="`nostalgia-detail-${item.id}`"
                  class="rounded-lg border border-border/30 bg-muted/5 px-3 py-2.5"
                >
                  <p class="wrap-break-word whitespace-normal text-sm leading-6">
                    {{ item.content }}
                  </p>
                </div>
              </div>
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
              <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
                        class="calendar-cell rounded-sm border border-border/70"
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

        <Card
          data-testid="rtk-card"
          class="overflow-hidden border-border/70 bg-card/90 backdrop-blur-sm"
        >
          <CardHeader class="pb-4">
            <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div class="space-y-1">
                <CardTitle>{{ t('settings.dashboard.rtk.title') }}</CardTitle>
                <CardDescription>
                  {{ t('settings.dashboard.rtk.description') }}
                </CardDescription>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <Badge
                  data-testid="rtk-status-badge"
                  variant="secondary"
                  :class="rtkStatusBadgeClass"
                >
                  {{ rtkStatusLabel }}
                </Badge>
                <Button
                  v-if="dashboard.rtk.health === 'unhealthy'"
                  data-testid="rtk-retry-button"
                  variant="outline"
                  size="sm"
                  :disabled="isRetryingRtk"
                  @click="void retryRtkHealthCheck()"
                >
                  {{ t('settings.dashboard.rtk.actions.retry') }}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent class="space-y-4">
            <div
              v-if="rtkStatusDescription"
              data-testid="rtk-status-copy"
              class="rounded-2xl border border-border/40 bg-muted/10 px-4 py-3 text-sm text-muted-foreground"
            >
              <p>{{ rtkStatusDescription }}</p>
            </div>

            <div class="dashboard-rtk-summary-grid grid gap-3">
              <div
                data-testid="rtk-summary-saved"
                class="rounded-xl border border-border/40 bg-muted/5 px-4 py-3"
              >
                <p
                  class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                >
                  {{ t('settings.dashboard.rtk.summary.savedTokens') }}
                </p>
                <p
                  class="mt-1 text-lg font-semibold tracking-tight"
                  :title="formatFullTokens(dashboard.rtk.summary.totalSavedTokens)"
                >
                  {{ formatTokens(dashboard.rtk.summary.totalSavedTokens) }}
                </p>
              </div>

              <div
                data-testid="rtk-summary-commands"
                class="rounded-xl border border-border/40 bg-muted/5 px-4 py-3"
              >
                <p
                  class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                >
                  {{ t('settings.dashboard.rtk.summary.commands') }}
                </p>
                <p class="mt-1 text-lg font-semibold tracking-tight">
                  {{ formatCount(dashboard.rtk.summary.totalCommands) }}
                </p>
              </div>

              <div
                data-testid="rtk-summary-rate"
                class="rounded-xl border border-border/40 bg-muted/5 px-4 py-3"
              >
                <p
                  class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                >
                  {{ t('settings.dashboard.rtk.summary.avgSavingsPct') }}
                </p>
                <p class="mt-1 text-lg font-semibold tracking-tight">
                  {{ formatPercent(dashboard.rtk.summary.avgSavingsPct / 100) }}
                </p>
              </div>

              <div
                data-testid="rtk-summary-output"
                class="rounded-xl border border-border/40 bg-muted/5 px-4 py-3"
              >
                <p
                  class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                >
                  {{ t('settings.dashboard.rtk.summary.outputTokens') }}
                </p>
                <p
                  class="mt-1 text-lg font-semibold tracking-tight"
                  :title="formatFullTokens(dashboard.rtk.summary.totalOutputTokens)"
                >
                  {{ formatTokens(dashboard.rtk.summary.totalOutputTokens) }}
                </p>
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
                class="max-h-105 overflow-y-auto pr-1"
              >
                <div data-testid="provider-breakdown-chart">
                  <div
                    v-for="item in providerBreakdownCard.rows"
                    :key="item.id"
                    class="border-b border-border/40 py-3 last:border-b-0"
                  >
                    <div
                      class="space-y-2.5 lg:grid lg:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_minmax(4.75rem,auto)] lg:items-center lg:gap-3 lg:space-y-0 xl:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_88px]"
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
                        <p>{{ formatCurrency(item.estimatedCostUsd) }}</p>
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
                class="max-h-105 overflow-y-auto pr-1"
              >
                <div data-testid="model-breakdown-chart">
                  <div
                    v-for="item in modelBreakdownCard.rows"
                    :key="item.id"
                    class="border-b border-border/40 py-3 last:border-b-0"
                  >
                    <div
                      class="space-y-2.5 lg:grid lg:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_minmax(4.75rem,auto)] lg:items-center lg:gap-3 lg:space-y-0 xl:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_88px]"
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
                        <p>{{ formatCurrency(item.estimatedCostUsd) }}</p>
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
import { computed, h, onBeforeUnmount, onMounted, ref, render } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { CurveType } from '@unovis/ts'
import type { Tooltip as UnovisTooltip } from '@unovis/ts'
import { VisArea, VisXYContainer } from '@unovis/vue'
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
import {
  ChartContainer,
  ChartCrosshair,
  ChartTooltip,
  ChartTooltipContent
} from '@shadcn/components/ui/chart'
import type { ChartConfig } from '@shadcn/components/ui/chart'
import type { UsageDashboardCalendarDay, UsageDashboardData } from '@shared/types/agent-interface'
import { usePresenter } from '@/composables/usePresenter'

type CalendarCell = UsageDashboardCalendarDay | null
type TokenUsageTrendKey = 'input' | 'output' | 'cached' | 'cost'
type TokenUsageTrendPoint = {
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
}
type BreakdownChartRow = {
  id: string
  label: string
  secondaryLabel: string | null
  messageCount: number
  totalTokens: number
  estimatedCostUsd: number | null
  barRatio: number
}
type NostalgiaRotatingStat = {
  id: 'days' | 'sessions' | 'messages'
  value: string
}
type NostalgiaDetailItem = {
  id: 'days' | 'sessions' | 'messages' | 'most-active-day'
  content: string
}

const { t, locale } = useI18n()
const agentSessionPresenter = usePresenter('agentSessionPresenter')

const isLoading = ref(true)
const isRetryingRtk = ref(false)
const errorMessage = ref('')
const dashboard = ref<UsageDashboardData | null>(null)
const nostalgiaStatIndex = ref(0)
const tokenUsageTooltip = ref<{ component?: UnovisTooltip } | null>(null)
let isDashboardMounted = false
let refreshTimer: number | null = null
let nostalgiaRotationTimer: number | null = null

const MS_PER_DAY = 24 * 60 * 60 * 1000
const COST_TREND_DAYS = 30
const TOKEN_USAGE_CHART_HEIGHT = 184
const NOSTALGIA_ROTATION_INTERVAL = 4000

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
  },
  cost: {
    label: t('settings.dashboard.summary.estimatedCost'),
    color: 'hsl(162 72% 48%)'
  }
}))

const tokenUsageCard = computed(() => {
  if (!dashboard.value) {
    return null
  }

  const summary = dashboard.value.summary
  const recentDays = dashboard.value.calendar.slice(-COST_TREND_DAYS)
  const normalizedDays =
    recentDays.length >= 2
      ? recentDays
      : recentDays.length === 1
        ? [recentDays[0], recentDays[0]]
        : [
            {
              date: '',
              inputTokens: 0,
              outputTokens: 0,
              cachedInputTokens: 0,
              estimatedCostUsd: null
            },
            {
              date: '',
              inputTokens: 0,
              outputTokens: 0,
              cachedInputTokens: 0,
              estimatedCostUsd: null
            }
          ]
  const inputTokens = Math.max(summary.inputTokens, 0)
  const outputTokens = Math.max(summary.outputTokens, 0)
  const totalTokens = Math.max(summary.totalTokens, 0)
  const cachedTokens = Math.min(inputTokens, Math.max(summary.cachedInputTokens, 0))
  const totalDenominator = Math.max(totalTokens, 1)
  const rawPoints = normalizedDays.map((day, index) => ({
    index,
    date: day.date,
    inputTokens: Math.max(day.inputTokens ?? 0, 0),
    outputTokens: Math.max(day.outputTokens ?? 0, 0),
    cachedTokens: Math.max(day.cachedInputTokens ?? 0, 0),
    cost: Math.max(day.estimatedCostUsd ?? 0, 0)
  }))
  const maxInput = Math.max(...rawPoints.map((point) => point.inputTokens), 0)
  const maxOutput = Math.max(...rawPoints.map((point) => point.outputTokens), 0)
  const maxCached = Math.max(...rawPoints.map((point) => point.cachedTokens), 0)
  const maxCost = Math.max(...rawPoints.map((point) => point.cost), 0)
  const chartData = rawPoints.map((point) => ({
    ...point,
    inputValue: maxInput > 0 ? (point.inputTokens / maxInput) * 100 : 0,
    outputValue: maxOutput > 0 ? (point.outputTokens / maxOutput) * 100 : 0,
    cachedValue: maxCached > 0 ? (point.cachedTokens / maxCached) * 100 : 0,
    costValue: maxCost > 0 ? (point.cost / maxCost) * 100 : 0
  }))

  return {
    totalTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    totalCost: summary.estimatedCostUsd,
    inputRatio: inputTokens / totalDenominator,
    outputRatio: outputTokens / totalDenominator,
    cachedRatio: inputTokens > 0 ? cachedTokens / inputTokens : 0,
    chartData,
    yDomain: [0, 108] as [number, number]
  }
})

const nostalgiaCard = computed(() => {
  if (!dashboard.value) {
    return null
  }

  const days = getDaysWithDeepChat(dashboard.value.recordingStartedAt)
  const summary = dashboard.value.summary
  const formattedDays = days === null ? t('settings.dashboard.unavailable') : formatCount(days)
  const formattedSessions = formatCount(summary.sessionCount)
  const formattedMessages = formatCount(summary.messageCount)
  const mostActiveDayText = summary.mostActiveDay.date
    ? t('settings.dashboard.summary.nostalgiaMostActiveDayDetail', {
        date: formatDateKey(summary.mostActiveDay.date),
        count: formatCount(summary.mostActiveDay.messageCount)
      })
    : t('settings.dashboard.unavailable')
  const rotatingStats = [
    days === null
      ? null
      : ({
          id: 'days',
          value: t('settings.dashboard.summary.nostalgiaDaysValue', {
            days: formattedDays
          })
        } satisfies NostalgiaRotatingStat),
    {
      id: 'sessions',
      value: t('settings.dashboard.summary.nostalgiaSessionsValue', {
        count: formattedSessions
      })
    } satisfies NostalgiaRotatingStat,
    {
      id: 'messages',
      value: t('settings.dashboard.summary.nostalgiaMessagesValue', {
        count: formattedMessages
      })
    } satisfies NostalgiaRotatingStat
  ].filter((item): item is NostalgiaRotatingStat => item !== null)

  return {
    rotatingStats,
    details: [
      {
        id: 'days',
        content:
          days === null
            ? t('settings.dashboard.unavailable')
            : t('settings.dashboard.summary.nostalgiaDaysDetail', {
                days: formattedDays
              })
      },
      {
        id: 'sessions',
        content: t('settings.dashboard.summary.nostalgiaSessionsDetail', {
          count: formattedSessions
        })
      },
      {
        id: 'messages',
        content: t('settings.dashboard.summary.nostalgiaMessagesDetail', {
          count: formattedMessages
        })
      },
      {
        id: 'most-active-day',
        content: mostActiveDayText
      }
    ] satisfies NostalgiaDetailItem[]
  }
})

const activeNostalgiaStat = computed<NostalgiaRotatingStat | null>(() => {
  const stats = nostalgiaCard.value?.rotatingStats ?? []
  if (stats.length === 0) {
    return null
  }

  return stats[nostalgiaStatIndex.value % stats.length]
})

const calendarGridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${Math.max(calendarWeeks.value.length, 1)}, minmax(0, 1fr))`
}))

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

async function loadDashboard(): Promise<void> {
  if (!isDashboardMounted) {
    return
  }

  let shouldFinalizeLoad = false

  try {
    isLoading.value = true
    errorMessage.value = ''
    const nextDashboard = await agentSessionPresenter.getUsageDashboard()
    if (!isDashboardMounted) {
      return
    }
    dashboard.value = nextDashboard
    shouldFinalizeLoad = true
  } catch (error) {
    if (!isDashboardMounted) {
      return
    }
    errorMessage.value =
      error instanceof Error ? error.message : t('settings.dashboard.error.description')
    shouldFinalizeLoad = true
  } finally {
    if (shouldFinalizeLoad && isDashboardMounted) {
      isLoading.value = false
      syncNostalgiaRotation()
      scheduleRefresh()
    }
  }
}

async function retryRtkHealthCheck(): Promise<void> {
  if (isRetryingRtk.value) {
    return
  }

  try {
    isRetryingRtk.value = true
    await agentSessionPresenter.retryRtkHealthCheck()
    await loadDashboard()
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : t('settings.dashboard.error.description')
  } finally {
    isRetryingRtk.value = false
  }
}

function scheduleRefresh(): void {
  if (refreshTimer) {
    window.clearTimeout(refreshTimer)
    refreshTimer = null
  }

  if (!isDashboardMounted || !dashboard.value) {
    return
  }

  const delay = dashboard.value.backfillStatus.status === 'running' ? 3000 : 15000
  refreshTimer = window.setTimeout(() => {
    if (!isDashboardMounted) {
      return
    }
    void loadDashboard()
  }, delay)
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
    estimatedCostUsd: item.estimatedCostUsd,
    barRatio: item.totalTokens > 0 ? item.totalTokens / maxTokens : 0
  }))

  return {
    rows
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

function formatCount(value: number): string {
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

const tokenTrendXAccessor = (point: TokenUsageTrendPoint): number => point.index
const tokenTrendInputAccessor = (point: TokenUsageTrendPoint): number => point.inputValue
const tokenTrendOutputAccessor = (point: TokenUsageTrendPoint): number => point.outputValue
const tokenTrendCachedAccessor = (point: TokenUsageTrendPoint): number => point.cachedValue
const tokenTrendCostAccessor = (point: TokenUsageTrendPoint): number => point.costValue
const tokenTrendYAccessors = [
  tokenTrendInputAccessor,
  tokenTrendOutputAccessor,
  tokenTrendCachedAccessor,
  tokenTrendCostAccessor
]

function tokenTrendAreaColor(series: TokenUsageTrendKey): string {
  switch (series) {
    case 'input':
      return 'var(--primary-600)'
    case 'output':
      return 'hsl(278 72% 72%)'
    case 'cached':
      return 'hsl(var(--usage-low) / 0.92)'
    case 'cost':
      return 'hsl(162 72% 48%)'
  }
}

function tokenTrendLineColor(series: TokenUsageTrendKey): string {
  switch (series) {
    case 'input':
      return 'var(--primary-600)'
    case 'output':
      return 'hsl(278 72% 72%)'
    case 'cached':
      return 'hsl(var(--usage-low) / 0.92)'
    case 'cost':
      return 'hsl(162 72% 48%)'
  }
}

function tokenUsageMetricDotStyle(series: TokenUsageTrendKey): { backgroundColor: string } {
  return {
    backgroundColor: tokenTrendLineColor(series)
  }
}

function tokenUsageTooltipDateLabel(value: number | Date): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(value)
  }

  return t('settings.dashboard.unavailable')
}

function renderTokenUsageTooltipContent(point: TokenUsageTrendPoint): HTMLElement {
  const container = document.createElement('div')

  render(
    h(ChartTooltipContent, {
      config: tokenUsageChartConfig.value,
      x: point.date ? new Date(`${point.date}T00:00:00`) : new Date('invalid'),
      labelFormatter: tokenUsageTooltipDateLabel,
      payload: {
        input: point.inputTokens,
        output: point.outputTokens,
        cached: point.cachedTokens,
        cost: formatCurrency(point.cost)
      }
    }),
    container
  )

  return (container.firstElementChild as HTMLElement | null) ?? container
}

function tokenUsageTooltipTemplate(
  datum: TokenUsageTrendPoint | undefined,
  _x: number | Date,
  data: TokenUsageTrendPoint[],
  leftNearestDatumIndex?: number
): HTMLElement | undefined {
  const point =
    datum ??
    (typeof leftNearestDatumIndex === 'number' && leftNearestDatumIndex >= 0
      ? data[leftNearestDatumIndex]
      : undefined)

  if (!point) {
    return undefined
  }

  return renderTokenUsageTooltipContent(point)
}

function breakdownBarStyle(barRatio: number): { width: string } {
  if (barRatio <= 0) {
    return { width: '0%' }
  }

  return {
    width: `${Math.max(barRatio * 100, 1.25)}%`
  }
}

function syncNostalgiaRotation(): void {
  if (!isDashboardMounted) {
    if (nostalgiaRotationTimer !== null) {
      window.clearInterval(nostalgiaRotationTimer)
      nostalgiaRotationTimer = null
    }
    return
  }

  const statCount = nostalgiaCard.value?.rotatingStats.length ?? 0

  if (statCount > 1) {
    nostalgiaStatIndex.value %= statCount

    if (nostalgiaRotationTimer === null) {
      nostalgiaRotationTimer = window.setInterval(() => {
        if (!isDashboardMounted) {
          return
        }
        const currentCount = nostalgiaCard.value?.rotatingStats.length ?? 0
        if (currentCount > 1) {
          nostalgiaStatIndex.value = (nostalgiaStatIndex.value + 1) % currentCount
        }
      }, NOSTALGIA_ROTATION_INTERVAL)
    }

    return
  }

  if (nostalgiaRotationTimer !== null) {
    window.clearInterval(nostalgiaRotationTimer)
    nostalgiaRotationTimer = null
  }

  nostalgiaStatIndex.value = 0
}

onMounted(() => {
  isDashboardMounted = true
  void loadDashboard()
})

onBeforeUnmount(() => {
  isDashboardMounted = false

  if (refreshTimer) {
    window.clearTimeout(refreshTimer)
    refreshTimer = null
  }

  if (nostalgiaRotationTimer) {
    window.clearInterval(nostalgiaRotationTimer)
    nostalgiaRotationTimer = null
  }
})
</script>

<style scoped>
.dashboard-token-usage-list {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10.5rem), 1fr));
}

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

.nostalgia-fade-enter-active,
.nostalgia-fade-leave-active {
  transition: opacity 220ms ease;
}

.nostalgia-fade-enter-from,
.nostalgia-fade-leave-to {
  opacity: 0;
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

.token-usage-trend-grid {
  background-image:
    linear-gradient(to right, hsl(var(--border) / 0.2) 1px, transparent 1px),
    linear-gradient(to bottom, hsl(var(--border) / 0.2) 1px, transparent 1px);
  background-size:
    48px 100%,
    100% 34px;
  background-position:
    0 0,
    0 100%;
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

  .token-usage-trend-grid {
    background-size:
      64px 100%,
      100% 38px;
  }
}

:deep([data-slot='chart']) .unovis-xy-container,
:deep([data-slot='chart']) .unovis-single-container {
  overflow: visible;
}
</style>
