<template>
  <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">
    {{ t('common.loading') }}
  </div>
  <div v-else-if="error" class="py-10 text-center text-sm text-destructive">
    {{ error }}
  </div>
  <div v-else-if="!health" class="py-10 text-center text-sm text-muted-foreground">
    {{ t('settings.deepchatAgents.memoryManager.emptyHealth') }}
  </div>
  <div v-else class="space-y-3">
    <div
      v-if="health.totalRows === 0"
      class="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"
    >
      {{ t('settings.deepchatAgents.memoryManager.emptyHealth') }}
    </div>

    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="metric in headlineMetrics" :key="metric.key" class="rounded-lg border px-3 py-2">
        <div class="text-[10px] uppercase text-muted-foreground">{{ metric.label }}</div>
        <div class="mt-1 text-lg font-semibold tabular-nums">{{ metric.value }}</div>
      </div>
    </div>

    <section class="rounded-lg border px-3 py-2">
      <div class="mb-2 flex items-center justify-between gap-2">
        <div>
          <div class="text-xs font-medium">
            {{ t('settings.deepchatAgents.memoryManager.health.archivePrediction.title') }}
          </div>
          <div class="mt-0.5 text-[10px] text-muted-foreground">
            {{ t('settings.deepchatAgents.memoryManager.health.archivePrediction.description') }}
          </div>
        </div>
        <Badge variant="secondary" class="text-[10px]">
          {{ formatCount(archiveCandidateLifecycles.length) }}
        </Badge>
        <Badge v-if="archiveCandidatePreviewLimitMessage" variant="outline" class="text-[10px]">
          {{ archiveCandidatePreviewLimitMessage }}
        </Badge>
      </div>
      <div
        v-if="archiveCandidateLifecyclePreviewLoading"
        class="py-4 text-center text-xs text-muted-foreground"
      >
        {{ t('common.loading') }}
      </div>
      <div
        v-else-if="archiveCandidateLifecyclePreviewError"
        class="py-4 text-center text-xs text-destructive"
      >
        {{ archiveCandidateLifecyclePreviewError }}
      </div>
      <div
        v-else-if="archiveCandidateLifecycles.length === 0"
        class="py-4 text-center text-xs text-muted-foreground"
      >
        {{ t('settings.deepchatAgents.memoryManager.health.archivePrediction.empty') }}
      </div>
      <ol v-else class="grid gap-2 sm:grid-cols-2">
        <li
          v-for="candidate in archiveCandidateLifecycles"
          :key="candidate.memoryId"
          class="rounded-md bg-muted/50 px-2 py-1.5"
        >
          <div class="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" class="text-[10px]">{{ kindLabel(candidate.kind) }}</Badge>
            <Badge variant="secondary" class="text-[10px]">
              {{ decayTierLabel(candidate.decayTier) }}
            </Badge>
            <span class="break-all font-mono text-[10px] text-muted-foreground">
              {{ candidate.memoryId }}
            </span>
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <MetricCell
              :label="
                t('settings.deepchatAgents.memoryManager.health.archivePrediction.decayScore')
              "
              :value="formatDecimal(candidate.forget.decayScore)"
            />
            <MetricCell
              :label="t('settings.deepchatAgents.memoryManager.health.archivePrediction.ageDays')"
              :value="formatDecimal(candidate.forget.ageDays)"
            />
          </div>
        </li>
      </ol>
    </section>

    <div class="grid gap-3 lg:grid-cols-3">
      <section class="rounded-lg border px-3 py-2">
        <div class="mb-2 text-xs font-medium">
          {{ t('settings.deepchatAgents.memoryManager.health.byKind') }}
        </div>
        <div class="space-y-2">
          <DistributionRow
            v-for="row in kindRows"
            :key="row.key"
            :label="row.label"
            :count="row.count"
            :total="health.totalRows"
          />
        </div>
      </section>

      <section class="rounded-lg border px-3 py-2">
        <div class="mb-2 text-xs font-medium">
          {{ t('settings.deepchatAgents.memoryManager.health.byCategory') }}
        </div>
        <div class="space-y-2">
          <DistributionRow
            v-for="row in categoryRows"
            :key="row.key"
            :label="row.label"
            :count="row.count"
            :total="health.totalRows"
          />
        </div>
      </section>

      <section class="rounded-lg border px-3 py-2">
        <div class="mb-2 text-xs font-medium">
          {{ t('settings.deepchatAgents.memoryManager.health.byStatus') }}
        </div>
        <div class="space-y-2">
          <DistributionRow
            v-for="row in statusRows"
            :key="row.key"
            :label="row.label"
            :count="row.count"
            :total="health.totalRows"
          />
        </div>
      </section>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <section class="rounded-lg border px-3 py-2">
        <div class="mb-2 text-xs font-medium">
          {{ t('settings.deepchatAgents.memoryManager.health.pipeline') }}
        </div>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <MetricCell
            v-for="metric in pipelineMetrics"
            :key="metric.key"
            :label="metric.label"
            :value="metric.value"
          />
        </div>
      </section>

      <section class="rounded-lg border px-3 py-2">
        <div class="mb-2 text-xs font-medium">
          {{ t('settings.deepchatAgents.memoryManager.health.quality') }}
        </div>
        <div class="grid grid-cols-3 gap-2 text-xs">
          <MetricCell
            v-for="metric in qualityMetrics"
            :key="metric.key"
            :label="metric.label"
            :value="metric.value"
          />
        </div>
      </section>
    </div>

    <div class="grid gap-3 lg:grid-cols-2">
      <section class="rounded-lg border px-3 py-2">
        <div class="mb-2 flex items-center justify-between gap-2">
          <div class="text-xs font-medium">
            {{ t('settings.deepchatAgents.memoryManager.health.topAccessed') }}
          </div>
          <Badge variant="secondary" class="text-[10px]">
            {{ health.access.topAccessed.length }}
          </Badge>
        </div>
        <div
          v-if="health.access.topAccessed.length === 0"
          class="py-4 text-center text-xs text-muted-foreground"
        >
          {{ t('settings.deepchatAgents.memoryManager.health.noTopAccessed') }}
        </div>
        <ol v-else class="space-y-2">
          <li
            v-for="item in health.access.topAccessed"
            :key="item.id"
            class="rounded-md bg-muted/50 px-2 py-1.5"
          >
            <div class="mb-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" class="text-[10px]">{{ kindLabel(item.kind) }}</Badge>
              <Badge variant="secondary" class="text-[10px]">
                {{ categoryLabel(item.category) }}
              </Badge>
              <span class="text-[10px] text-muted-foreground">
                {{ formatCount(item.accessCount) }}
              </span>
              <span v-if="item.lastAccessed !== null" class="text-[10px] text-muted-foreground">
                {{ formatTime(item.lastAccessed) }}
              </span>
            </div>
            <p class="wrap-break-word text-xs">{{ item.content }}</p>
          </li>
        </ol>
      </section>

      <section class="rounded-lg border px-3 py-2">
        <div class="mb-2 flex items-center justify-between gap-2">
          <div class="text-xs font-medium">
            {{ t('settings.deepchatAgents.memoryManager.health.maintenance') }}
          </div>
          <Badge variant="outline" class="text-[10px]">
            {{
              t('settings.deepchatAgents.memoryManager.health.scanWindow', {
                count: health.maintenance.scanLimit
              })
            }}
          </Badge>
        </div>
        <div class="mb-3 grid grid-cols-3 gap-2 text-xs">
          <MetricCell
            v-for="metric in maintenanceMetrics"
            :key="metric.key"
            :label="metric.label"
            :value="metric.value"
          />
        </div>
        <div
          v-if="health.maintenance.recentFailures.length === 0"
          class="py-4 text-center text-xs text-muted-foreground"
        >
          {{ t('settings.deepchatAgents.memoryManager.health.noRecentFailures') }}
        </div>
        <ol v-else class="space-y-2">
          <li
            v-for="(failure, index) in health.maintenance.recentFailures"
            :key="`${failure.eventType}:${failure.createdAt}:${index}`"
            class="rounded-md bg-muted/50 px-2 py-1.5"
          >
            <div class="mb-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" class="text-[10px]">{{ failure.eventType }}</Badge>
              <Badge
                :variant="failure.status === 'failed' ? 'destructive' : 'secondary'"
                class="text-[10px]"
              >
                {{ failure.status }}
              </Badge>
              <span class="text-[10px] text-muted-foreground">
                {{ formatTime(failure.createdAt) }}
              </span>
            </div>
            <p class="wrap-break-word text-xs text-muted-foreground">
              {{ failure.reason || dash }}
            </p>
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@shadcn/components/ui/badge'
import type {
  MemoryArchiveCandidateLifecyclePreview,
  MemoryHealthDto,
  MemoryLifecycle
} from '@shared/contracts/routes'
import {
  AGENT_MEMORY_CATEGORIES,
  AGENT_MEMORY_HEALTH_KIND_KEYS,
  AGENT_MEMORY_HEALTH_STATUS_KEYS,
  type AgentMemoryCategory
} from '@shared/types/agent-memory'

const props = withDefaults(
  defineProps<{
    health: MemoryHealthDto | null
    loading: boolean
    error: string | null
    archiveCandidateLifecyclePreview?: MemoryArchiveCandidateLifecyclePreview | null
    archiveCandidateLifecyclePreviewLoading?: boolean
    archiveCandidateLifecyclePreviewError?: string | null
  }>(),
  {
    archiveCandidateLifecyclePreview: null,
    archiveCandidateLifecyclePreviewLoading: false,
    archiveCandidateLifecyclePreviewError: null
  }
)

const { t, locale } = useI18n()
const dash = '—'

const countFormatter = computed(
  () => new Intl.NumberFormat(locale.value || undefined, { maximumFractionDigits: 0 })
)
const decimalFormatter = computed(
  () =>
    new Intl.NumberFormat(locale.value || undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
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
const archiveCandidateLifecyclePreview = computed(() => props.archiveCandidateLifecyclePreview)
const archiveCandidateLifecycles = computed(
  () => archiveCandidateLifecyclePreview.value?.lifecycles ?? []
)
const archiveCandidatePreviewLimitMessage = computed(() => {
  const preview = archiveCandidateLifecyclePreview.value
  if (!preview) return null
  if (preview.scanTruncated) {
    return t('settings.deepchatAgents.memoryManager.health.archivePrediction.scanLimited', {
      count: preview.scanLimit
    })
  }
  if (preview.previewTruncated) {
    return t('settings.deepchatAgents.memoryManager.health.archivePrediction.previewLimited', {
      count: preview.previewLimit
    })
  }
  return null
})

const DistributionRow = defineComponent({
  name: 'DistributionRow',
  props: {
    label: { type: String, required: true },
    count: { type: Number, required: true },
    total: { type: Number, required: true }
  },
  setup(rowProps) {
    return () => {
      const width =
        rowProps.total > 0
          ? `${Math.min(100, Math.max(0, (rowProps.count / rowProps.total) * 100))}%`
          : '0%'
      return h('div', { class: 'space-y-1' }, [
        h('div', { class: 'flex items-center justify-between gap-2 text-xs' }, [
          h('span', { class: 'truncate text-muted-foreground' }, rowProps.label),
          h('span', { class: 'shrink-0 tabular-nums' }, countFormatter.value.format(rowProps.count))
        ]),
        h('div', { class: 'h-1.5 overflow-hidden rounded-full bg-muted' }, [
          h('div', { class: 'h-full rounded-full bg-primary', style: { width } })
        ])
      ])
    }
  }
})

const MetricCell = defineComponent({
  name: 'MetricCell',
  props: {
    label: { type: String, required: true },
    value: { type: String, required: true }
  },
  setup(cellProps) {
    return () =>
      h('div', { class: 'rounded-md bg-muted/50 px-2 py-1.5' }, [
        h('div', { class: 'text-[10px] uppercase text-muted-foreground' }, cellProps.label),
        h('div', { class: 'mt-0.5 font-medium tabular-nums' }, cellProps.value)
      ])
  }
})

const headlineMetrics = computed(() => {
  const health = props.health
  if (!health) return []
  return [
    {
      key: 'totalRows',
      label: t('settings.deepchatAgents.memoryManager.health.totalRows'),
      value: formatCount(health.totalRows)
    },
    {
      key: 'neverAccessed',
      label: t('settings.deepchatAgents.memoryManager.health.neverAccessed'),
      value: formatCount(health.access.neverAccessed)
    },
    {
      key: 'archiveCandidates',
      label: t('settings.deepchatAgents.memoryManager.health.archiveCandidates'),
      value: formatCount(health.lifecycle.archiveCandidates)
    },
    {
      key: 'staleEmbeddings',
      label: t('settings.deepchatAgents.memoryManager.health.staleEmbeddings'),
      value: formatCount(health.embeddings.stale)
    }
  ]
})

const kindRows = computed(() => {
  const health = props.health
  if (!health) return []
  return AGENT_MEMORY_HEALTH_KIND_KEYS.map((kind) => ({
    key: kind,
    label: kindLabel(kind),
    count: health.byKind[kind]
  }))
})

const categoryRows = computed(() => {
  const health = props.health
  if (!health) return []
  return [
    ...AGENT_MEMORY_CATEGORIES.map((category) => ({
      key: category,
      label: categoryLabel(category),
      count: health.byCategory[category]
    })),
    { key: 'uncategorized', label: categoryLabel(null), count: health.byCategory.uncategorized }
  ]
})

const statusRows = computed(() => {
  const health = props.health
  if (!health) return []
  return AGENT_MEMORY_HEALTH_STATUS_KEYS.map((status) => ({
    key: status,
    label: t(`settings.deepchatAgents.memoryManager.status.${status}`),
    count: health.byStatus[status]
  }))
})

const pipelineMetrics = computed(() => {
  const health = props.health
  if (!health) return []
  return [
    {
      key: 'pending',
      label: t('settings.deepchatAgents.memoryManager.health.pending'),
      value: formatCount(health.embeddings.pending)
    },
    {
      key: 'error',
      label: t('settings.deepchatAgents.memoryManager.health.error'),
      value: formatCount(health.embeddings.error)
    },
    {
      key: 'ftsOnly',
      label: t('settings.deepchatAgents.memoryManager.health.ftsOnly'),
      value: formatCount(health.embeddings.ftsOnly)
    },
    {
      key: 'archived',
      label: t('settings.deepchatAgents.memoryManager.health.archived'),
      value: formatCount(health.lifecycle.archived)
    },
    {
      key: 'conflicted',
      label: t('settings.deepchatAgents.memoryManager.health.conflicted'),
      value: formatCount(health.conflicts.conflicted)
    },
    {
      key: 'challenged',
      label: t('settings.deepchatAgents.memoryManager.health.challenged'),
      value: formatCount(health.conflicts.challenged)
    }
  ]
})

const qualityMetrics = computed(() => {
  const health = props.health
  if (!health) return []
  return [
    {
      key: 'importanceAvg',
      label: t('settings.deepchatAgents.memoryManager.health.importanceAvg'),
      value: formatDecimal(health.quality.importanceAvg)
    },
    {
      key: 'importanceMedian',
      label: t('settings.deepchatAgents.memoryManager.health.importanceMedian'),
      value: formatDecimal(health.quality.importanceMedian)
    },
    {
      key: 'confidenceAvg',
      label: t('settings.deepchatAgents.memoryManager.health.confidenceAvg'),
      value: formatDecimal(health.quality.confidenceAvg)
    }
  ]
})

const maintenanceMetrics = computed(() => {
  const health = props.health
  if (!health) return []
  return [
    {
      key: 'completed',
      label: t('settings.deepchatAgents.memoryManager.health.completed'),
      value: formatCount(health.maintenance.completed)
    },
    {
      key: 'skipped',
      label: t('settings.deepchatAgents.memoryManager.health.skipped'),
      value: formatCount(health.maintenance.skipped)
    },
    {
      key: 'failed',
      label: t('settings.deepchatAgents.memoryManager.health.failed'),
      value: formatCount(health.maintenance.failed)
    }
  ]
})

function formatCount(value: number): string {
  return countFormatter.value.format(value)
}

function formatDecimal(value: number | null): string {
  return value === null ? dash : decimalFormatter.value.format(value)
}

function formatTime(value: number): string {
  return dateFormatter.value.format(new Date(value))
}

function categoryLabel(category: AgentMemoryCategory | null): string {
  if (category == null) return t('settings.deepchatAgents.memoryManager.categoryUncategorized')
  return t(`settings.deepchatAgents.memoryManager.category.${category}`)
}

function kindLabel(kind: keyof MemoryHealthDto['byKind']): string {
  if (kind === 'semantic') return t('settings.deepchatAgents.memoryManager.kindSemantic')
  if (kind === 'episodic') return t('settings.deepchatAgents.memoryManager.kindEpisodic')
  return t(`settings.deepchatAgents.memoryManager.health.kind.${kind}`)
}

function decayTierLabel(tier: MemoryLifecycle['decayTier']): string {
  return t(`settings.deepchatAgents.memoryManager.lifecycle.tier.${tier}`)
}
</script>
