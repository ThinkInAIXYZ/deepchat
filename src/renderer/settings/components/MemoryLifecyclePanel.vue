<template>
  <div class="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2">
    <div v-if="loading" class="py-3 text-xs text-muted-foreground">
      {{ t('common.loading') }}
    </div>
    <div v-else-if="error" class="py-3 text-xs text-destructive">
      {{ error }}
    </div>
    <div v-else-if="!lifecycle" class="py-3 text-xs text-muted-foreground">
      {{ t('settings.deepchatAgents.memoryManager.lifecycle.empty') }}
    </div>
    <div v-else class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <Badge :variant="tierVariant" class="text-[10px]">
          {{ tierLabel }}
        </Badge>
        <span class="text-[11px] text-muted-foreground">
          {{ t('settings.deepchatAgents.memoryManager.lifecycle.modelNote') }}
        </span>
      </div>

      <div class="grid gap-2 md:grid-cols-3">
        <section class="rounded-md border bg-background/70 px-2.5 py-2">
          <div class="mb-1 text-[11px] font-medium">
            {{ t('settings.deepchatAgents.memoryManager.lifecycle.recall.title') }}
          </div>
          <div
            v-if="!lifecycle.recallable && lifecycle.recall"
            class="mb-1 text-[10px] text-muted-foreground"
          >
            {{ t('settings.deepchatAgents.memoryManager.lifecycle.recall.inactive') }}
          </div>
          <div v-if="lifecycle.recall" class="space-y-1 text-[11px]">
            <MetricRow
              :label="
                t(
                  lifecycle.recallable
                    ? 'settings.deepchatAgents.memoryManager.lifecycle.recall.final'
                    : 'settings.deepchatAgents.memoryManager.lifecycle.recall.diagnosticFinal'
                )
              "
              :value="formatScore(lifecycle.recall.final)"
            />
            <MetricRow
              :label="t('settings.deepchatAgents.memoryManager.lifecycle.recall.similarity')"
              :value="formatScore(lifecycle.recall.similarity)"
            />
            <MetricRow
              :label="t('settings.deepchatAgents.memoryManager.lifecycle.recall.recency')"
              :value="formatScore(lifecycle.recall.recency)"
            />
            <MetricRow
              :label="t('settings.deepchatAgents.memoryManager.lifecycle.recall.importance')"
              :value="formatScore(lifecycle.recall.importance)"
            />
            <MetricRow
              :label="t('settings.deepchatAgents.memoryManager.lifecycle.recall.confidence')"
              :value="formatScore(lifecycle.recall.confidenceFactor)"
            />
            <MetricRow
              :label="t('settings.deepchatAgents.memoryManager.lifecycle.recall.floor')"
              :value="formatScore(lifecycle.recall.importanceFloor)"
            />
            <div v-if="lifecycle.recall.flooredByImportance" class="text-[10px] text-amber-600">
              {{ t('settings.deepchatAgents.memoryManager.lifecycle.recall.floored') }}
            </div>
            <div class="text-[10px] text-muted-foreground">
              {{ t('settings.deepchatAgents.memoryManager.lifecycle.recall.baseline') }}
            </div>
          </div>
          <div v-else class="text-[11px] text-muted-foreground">
            {{ t('settings.deepchatAgents.memoryManager.lifecycle.recall.notRecallable') }}
          </div>
        </section>

        <section class="rounded-md border bg-background/70 px-2.5 py-2">
          <div class="mb-1 text-[11px] font-medium">
            {{ t('settings.deepchatAgents.memoryManager.lifecycle.forget.title') }}
          </div>
          <div class="space-y-1 text-[11px]">
            <MetricRow
              :label="t('settings.deepchatAgents.memoryManager.lifecycle.forget.score')"
              :value="formatScore(lifecycle.forget.decayScore)"
            />
            <MetricRow
              :label="t('settings.deepchatAgents.memoryManager.lifecycle.forget.materialized')"
              :value="formatOptionalScore(lifecycle.forget.materializedDecay)"
            />
            <MetricRow
              :label="t('settings.deepchatAgents.memoryManager.lifecycle.forget.halfLife')"
              :value="formatDays(lifecycle.forget.halfLifeDays)"
            />
            <MetricRow
              :label="t('settings.deepchatAgents.memoryManager.lifecycle.forget.age')"
              :value="formatDays(lifecycle.forget.ageDays)"
            />
            <MetricRow
              :label="t('settings.deepchatAgents.memoryManager.lifecycle.forget.anchor')"
              :value="formatTime(lifecycle.forget.anchorAt)"
            />
            <div
              v-if="lifecycle.forget.materializedStale"
              class="text-[10px] text-muted-foreground"
            >
              {{ t('settings.deepchatAgents.memoryManager.lifecycle.forget.stale') }}
            </div>
          </div>
        </section>

        <section class="rounded-md border bg-background/70 px-2.5 py-2">
          <div class="mb-1 text-[11px] font-medium">
            {{ t('settings.deepchatAgents.memoryManager.lifecycle.archive.title') }}
          </div>
          <div class="space-y-1.5 text-[11px]">
            <div
              v-for="condition in archiveConditions"
              :key="condition.key"
              class="flex items-start gap-1.5"
            >
              <Icon
                :icon="condition.ok ? 'lucide:check' : 'lucide:x'"
                class="mt-0.5 h-3 w-3 shrink-0"
                :class="condition.ok ? 'text-emerald-600' : 'text-muted-foreground'"
              />
              <div class="min-w-0">
                <div>{{ condition.label }}</div>
                <div v-if="condition.detail" class="text-[10px] text-muted-foreground">
                  {{ condition.detail }}
                </div>
              </div>
            </div>
            <div
              v-if="lifecycle.archiveEligibility.eligible"
              class="pt-1 text-[10px] text-amber-600"
            >
              {{ t('settings.deepchatAgents.memoryManager.lifecycle.archive.eligible') }}
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import type { MemoryLifecycle } from '@shared/contracts/routes'

const props = defineProps<{
  lifecycle: MemoryLifecycle | null
  loading: boolean
  error: string | null
}>()

const { t, locale } = useI18n()

const decimalFormatter = computed(
  () =>
    new Intl.NumberFormat(locale.value || undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3
    })
)
const dayFormatter = computed(
  () =>
    new Intl.NumberFormat(locale.value || undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    })
)
const dateFormatter = computed(
  () =>
    new Intl.DateTimeFormat(locale.value || undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
)

const MetricRow = defineComponent({
  name: 'MetricRow',
  props: {
    label: { type: String, required: true },
    value: { type: String, required: true }
  },
  setup(rowProps) {
    return () =>
      h('div', { class: 'flex items-center justify-between gap-2' }, [
        h('span', { class: 'truncate text-muted-foreground' }, rowProps.label),
        h('span', { class: 'shrink-0 tabular-nums' }, rowProps.value)
      ])
  }
})

const tierLabel = computed(() => {
  const tier = props.lifecycle?.decayTier ?? 'fresh'
  return t(`settings.deepchatAgents.memoryManager.lifecycle.tier.${tier}`)
})

const tierVariant = computed<'default' | 'secondary' | 'destructive' | 'outline'>(() => {
  const tier = props.lifecycle?.decayTier
  if (tier === 'archive_candidate') return 'destructive'
  if (tier === 'stale') return 'outline'
  if (tier === 'aging') return 'secondary'
  return 'default'
})

const archiveConditions = computed(() => {
  const lifecycle = props.lifecycle
  if (!lifecycle) return []
  const gaps = lifecycle.archiveEligibility.gaps
  return [
    {
      key: 'oldEnough',
      ok: lifecycle.archiveEligibility.oldEnough,
      label: t('settings.deepchatAgents.memoryManager.lifecycle.archive.oldEnough'),
      detail:
        gaps.daysUntilOldEnough !== undefined
          ? t('settings.deepchatAgents.memoryManager.lifecycle.archive.daysUntilOldEnough', {
              days: formatDays(gaps.daysUntilOldEnough)
            })
          : null
    },
    {
      key: 'decayedEnough',
      ok: lifecycle.archiveEligibility.decayedEnough,
      label: t('settings.deepchatAgents.memoryManager.lifecycle.archive.decayedEnough'),
      detail:
        gaps.decayAboveThresholdBy !== undefined
          ? t('settings.deepchatAgents.memoryManager.lifecycle.archive.decayAboveThresholdBy', {
              score: formatScore(gaps.decayAboveThresholdBy)
            })
          : null
    },
    {
      key: 'neverAccessed',
      ok: lifecycle.archiveEligibility.neverAccessed,
      label: t('settings.deepchatAgents.memoryManager.lifecycle.archive.neverAccessed'),
      detail:
        gaps.accessCount !== undefined
          ? t('settings.deepchatAgents.memoryManager.lifecycle.archive.accessCount', {
              count: gaps.accessCount
            })
          : null
    },
    {
      key: 'active',
      ok: lifecycle.archiveEligibility.active,
      label: t('settings.deepchatAgents.memoryManager.lifecycle.archive.active'),
      detail: null
    },
    {
      key: 'notExempt',
      ok: !lifecycle.archiveEligibility.exempt,
      label: t('settings.deepchatAgents.memoryManager.lifecycle.archive.notExempt'),
      detail: exemptionDetail(lifecycle.archiveEligibility.exemptReasons)
    }
  ]
})

function formatScore(value: number): string {
  return decimalFormatter.value.format(value)
}

function formatOptionalScore(value: number | null): string {
  return value === null
    ? t('settings.deepchatAgents.memoryManager.lifecycle.forget.notRefreshed')
    : formatScore(value)
}

function formatDays(value: number): string {
  return dayFormatter.value.format(value)
}

function formatTime(value: number): string {
  return dateFormatter.value.format(new Date(value))
}

function exemptionDetail(
  reasons: MemoryLifecycle['archiveEligibility']['exemptReasons']
): string | null {
  if (!reasons.length) return null
  return reasons
    .map((reason) => t(`settings.deepchatAgents.memoryManager.lifecycle.exempt.${reason}`))
    .join(', ')
}
</script>
