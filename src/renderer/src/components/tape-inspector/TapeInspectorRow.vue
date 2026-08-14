<template>
  <div
    class="tape-inspector-row grid h-9 min-w-[860px] cursor-default grid-cols-[minmax(220px,2fr)_100px_100px_110px_100px_minmax(180px,1fr)] items-center border-b border-border/50 text-xs outline-none"
    :class="[
      selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/40',
      row.recordType === 'group' || row.recordType === 'evidence_lane'
        ? 'font-medium'
        : 'font-normal'
    ]"
    :data-testid="`tape-inspector-row-${row.key}`"
    :data-row-key="row.key"
    :data-row-type="row.recordType"
    role="row"
    :aria-selected="selected"
    tabindex="-1"
    @click="emit('select', row.key)"
    @dblclick="toggleIfCollapsible"
  >
    <div class="flex min-w-0 items-center gap-1.5 px-2" :style="indentStyle" role="gridcell">
      <button
        v-if="isCollapsible"
        type="button"
        class="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        :aria-label="
          isCollapsed ? t('tapeInspector.actions.expand') : t('tapeInspector.actions.collapse')
        "
        @click.stop="emit('toggle', row.key)"
      >
        <Icon :icon="isCollapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'" class="size-3" />
      </button>
      <span v-else class="w-5 shrink-0 text-center text-muted-foreground" aria-hidden="true">
        <Icon :icon="rowIcon" class="inline size-3" />
      </span>
      <span class="truncate" :title="nameLabel">{{ nameLabel }}</span>
      <span
        v-if="row.recordType === 'evidence' && row.legacyUnattributed"
        class="shrink-0 rounded border border-border px-1 text-[10px] font-normal text-muted-foreground"
      >
        {{ t('tapeInspector.evidence.legacy') }}
      </span>
    </div>
    <div class="truncate px-2 text-muted-foreground" role="gridcell" :title="kindLabel">
      {{ kindLabel }}
    </div>
    <div class="px-2" role="gridcell">
      <span
        class="inline-flex max-w-full truncate rounded px-1.5 py-0.5 text-[10px]"
        :class="statusClass"
      >
        {{ statusLabel }}
      </span>
    </div>
    <div class="truncate px-2 font-mono text-[11px] text-muted-foreground" role="gridcell">
      {{ startLabel }}
    </div>
    <div class="truncate px-2 font-mono text-[11px] text-muted-foreground" role="gridcell">
      {{ durationLabel }}
    </div>
    <div class="px-3" role="gridcell">
      <div class="relative h-4 overflow-hidden rounded-sm bg-muted/50">
        <span
          class="absolute inset-y-0 w-px bg-muted-foreground/45"
          :style="{ left: `${row.sequenceStart * 100}%` }"
          :title="t('tapeInspector.waterfall.sequence')"
        />
        <span
          v-if="row.durationMs !== null"
          class="absolute inset-y-1 rounded-sm bg-foreground/55"
          :style="{
            left: `${row.actualStart * 100}%`,
            width: `${Math.max(row.actualWidth * 100, 0.75)}%`
          }"
          :title="durationLabel"
        />
        <span
          v-else
          class="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-foreground/60"
          :style="{ left: `${row.actualStart * 100}%` }"
          :title="t('tapeInspector.waterfall.point')"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import type { TapeInspectorDisplayRow } from './model'

const props = defineProps<{
  row: TapeInspectorDisplayRow
  selected: boolean
}>()

const emit = defineEmits<{
  select: [key: string]
  toggle: [key: string]
}>()

const { t, d } = useI18n()

const isCollapsible = computed(
  () => props.row.recordType === 'group' || props.row.recordType === 'evidence_lane'
)
const isCollapsed = computed(() => {
  if (props.row.recordType === 'group' || props.row.recordType === 'evidence_lane') {
    return props.row.collapsed
  }
  return false
})
const indentStyle = computed(() => ({ paddingLeft: `${8 + props.row.depth * 14}px` }))

const shortIdentity = (value: string | undefined): string => {
  if (!value) return t('tapeInspector.states.unknown')
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

const nameLabel = computed(() => {
  const row = props.row
  if (row.recordType === 'fact') return row.record.name ?? row.record.kind
  if (row.recordType === 'evidence') {
    return `${t('tapeInspector.evidence.request')} · ${row.record.providerId}/${row.record.modelId}`
  }
  if (row.recordType === 'evidence_lane') {
    return t('tapeInspector.evidence.unbound', { count: row.count })
  }
  if (row.group.kind === 'run') {
    return `${t('tapeInspector.groups.run')} · ${shortIdentity(row.group.runId)}`
  }
  if (row.group.kind === 'request') {
    return `${t('tapeInspector.groups.request')} · #${row.group.requestSeq ?? '?'}`
  }
  if (row.group.kind === 'attempt') {
    return `${t('tapeInspector.groups.attempt')} · #${row.group.physicalAttempt ?? '?'}`
  }
  return `${t('tapeInspector.groups.tool')} · ${shortIdentity(row.group.providerToolCallId)}`
})

const kindLabel = computed(() => {
  if (props.row.recordType === 'fact') return props.row.record.kind
  if (props.row.recordType === 'evidence') return t('tapeInspector.kinds.evidence')
  if (props.row.recordType === 'evidence_lane') return t('tapeInspector.kinds.lane')
  return t('tapeInspector.kinds.group')
})

const statusLabel = computed(() => props.row.status ?? t('tapeInspector.states.unknown'))
const statusClass = computed(() => {
  if (props.row.status === 'error') return 'bg-destructive/10 text-destructive'
  if (props.row.status === 'success' || props.row.status === 'completed') {
    return 'bg-foreground/10 text-foreground'
  }
  return 'bg-muted text-muted-foreground'
})

const rowCreatedAt = computed(() => {
  if (props.row.recordType === 'fact' || props.row.recordType === 'evidence') {
    return props.row.record.createdAt
  }
  return null
})
const startLabel = computed(() => {
  if (rowCreatedAt.value === null) return '—'
  return d(new Date(rowCreatedAt.value), { hour: '2-digit', minute: '2-digit', second: '2-digit' })
})
const durationLabel = computed(() => {
  const duration = props.row.durationMs
  if (duration === null) return t('tapeInspector.states.unknown')
  if (duration < 1_000) return `${duration} ms`
  return `${(duration / 1_000).toFixed(2)} s`
})
const rowIcon = computed(() => {
  if (props.row.recordType === 'evidence') return 'lucide:radio'
  if (props.row.recordType === 'fact' && props.row.record.family === 'context') {
    return 'lucide:shield'
  }
  return 'lucide:diamond'
})

function toggleIfCollapsible(): void {
  if (isCollapsible.value) emit('toggle', props.row.key)
}
</script>
