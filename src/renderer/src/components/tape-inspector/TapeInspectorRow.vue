<template>
  <div
    class="tape-inspector-row relative grid h-12 cursor-default items-center border-b border-border/50 text-xs outline-none"
    :class="[
      selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/40',
      row.recordType === 'group' || row.recordType === 'evidence_lane'
        ? 'font-medium'
        : 'font-normal'
    ]"
    :data-testid="`tape-inspector-row-${row.key}`"
    :data-row-key="row.key"
    :data-row-type="row.recordType"
    :data-layout="layout"
    role="row"
    :id="rowDomId"
    :aria-rowindex="ariaRowIndex"
    :aria-selected="selected"
    :style="rowGridStyle"
    @click="emit('select', row.key)"
    @dblclick="toggleIfCollapsible"
  >
    <span
      aria-hidden="true"
      class="absolute inset-y-2 left-0 w-0.5 rounded-r"
      :class="accentClass"
    />
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
        <Icon :icon="rowIcon" class="inline size-3.5" :class="iconClass" />
      </span>
      <div class="min-w-0 flex-1 py-1">
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="truncate" :title="nameLabel">{{ nameLabel }}</span>
          <span
            v-if="evidenceAssociationLabel"
            class="shrink-0 rounded border border-border px-1 text-[10px] font-normal text-muted-foreground"
          >
            {{ evidenceAssociationLabel }}
          </span>
          <button
            v-if="row.recordType === 'evidence_lane' && row.laneKind === 'earlier'"
            type="button"
            class="ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded border border-border px-1.5 text-[10px] font-normal text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!canLoadEvidenceParents"
            :aria-label="t('tapeInspector.actions.loadMatchingEntries')"
            :title="
              canLoadEvidenceParents
                ? t('tapeInspector.actions.loadMatchingEntries')
                : t('tapeInspector.states.matchingEntriesUnavailable')
            "
            @click.stop="emit('loadEvidenceParents')"
          >
            <Icon
              :icon="loadingEvidenceParents ? 'lucide:loader-circle' : 'lucide:history'"
              class="size-3"
              :class="{ 'animate-spin': loadingEvidenceParents }"
            />
            <span v-if="layout !== 'compact'">
              {{ t('tapeInspector.actions.loadMatchingEntries') }}
            </span>
          </button>
          <span
            v-if="layout === 'compact' && showStatus"
            class="ml-auto inline-flex shrink-0 truncate rounded px-1.5 py-0.5 text-[10px]"
            :class="statusClass"
            :title="statusTitle"
          >
            {{ statusLabel }}
          </span>
        </div>
        <div
          v-if="displaySummaryLabel"
          class="mt-0.5 truncate text-[10px] font-normal text-muted-foreground"
          :title="displaySummaryLabel"
        >
          {{ displaySummaryLabel }}
        </div>
      </div>
    </div>
    <div
      v-if="layout === 'wide'"
      class="truncate px-2 text-muted-foreground"
      role="gridcell"
      :title="kindLabel"
    >
      {{ kindLabel }}
    </div>
    <div
      v-if="layout !== 'compact'"
      class="px-2"
      role="gridcell"
      :data-status-state="row.statusState"
      :title="statusTitle"
    >
      <span
        v-if="showStatus"
        class="inline-flex max-w-full truncate rounded px-1.5 py-0.5 text-[10px]"
        :class="statusClass"
      >
        {{ statusLabel }}
      </span>
      <span v-else class="text-muted-foreground/60">—</span>
    </div>
    <div
      v-if="layout === 'wide'"
      class="truncate px-2 text-right font-mono text-[11px] tabular-nums text-muted-foreground"
      role="gridcell"
    >
      {{ startLabel }}
    </div>
    <div
      v-if="layout !== 'compact'"
      class="truncate px-2 text-right font-mono text-[11px] tabular-nums text-muted-foreground"
      role="gridcell"
      :data-timing-state="row.timingState"
      :title="durationTitle"
    >
      {{ durationLabel }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import {
  getTapeInspectorRowDomId,
  type TapeInspectorDisplayRow,
  type TapeInspectorFactRow
} from './model'
import type {
  TapeInspectorMessagePreview,
  TapeInspectorRequestActivityKind,
  TapeInspectorRequestRowActivity
} from './messagePreview'

const props = withDefaults(
  defineProps<{
    row: TapeInspectorDisplayRow
    selected: boolean
    layout?: 'wide' | 'medium' | 'compact'
    gridTemplateColumns?: string
    tableMinWidth?: number
    ariaRowIndex?: number
    messagePreview?: TapeInspectorMessagePreview | null
    requestActivity?: TapeInspectorRequestRowActivity | null
    canLoadEvidenceParents?: boolean
    loadingEvidenceParents?: boolean
  }>(),
  {
    layout: 'wide',
    gridTemplateColumns: 'minmax(220px, 2fr) 100px 100px 110px 100px',
    tableMinWidth: 630,
    canLoadEvidenceParents: false,
    loadingEvidenceParents: false
  }
)

const emit = defineEmits<{
  select: [key: string]
  toggle: [key: string]
  loadEvidenceParents: []
}>()

const { t, d } = useI18n()

const INCOMPLETE_STATE_KEYS = {
  earlier_history: 'tapeInspector.states.timingEarlierHistory',
  filtered: 'tapeInspector.states.timingFiltered',
  awaiting_live: 'tapeInspector.states.timingAwaitingLive',
  not_recorded: 'tapeInspector.states.timingNotRecorded',
  inconsistent: 'tapeInspector.states.timingInconsistent'
} as const

function incompleteStateLabel(reason: keyof typeof INCOMPLETE_STATE_KEYS): string {
  return t(INCOMPLETE_STATE_KEYS[reason])
}

const rowDomId = computed(() => getTapeInspectorRowDomId(props.row.key))
const rowGridStyle = computed<CSSProperties>(() => ({
  gridTemplateColumns: props.gridTemplateColumns,
  minWidth: `${props.tableMinWidth}px`
}))

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
  if (row.recordType === 'fact') {
    if (row.record.name === 'message/user') return t('tapeInspector.activity.userMessage')
    if (row.record.name === 'message/assistant') return t('tapeInspector.activity.assistantMessage')
    if (row.record.name === 'memory/view_assembled') {
      return t('tapeInspector.activity.memoryView')
    }
    if (row.record.name === 'memory/directive_view_assembled') {
      return t('tapeInspector.activity.directiveView')
    }
    if (row.record.kind === 'tool_call') {
      return `${t('tapeInspector.activity.toolCall')} · ${row.record.name ?? row.record.kind}`
    }
    if (row.record.kind === 'tool_result') {
      return `${t('tapeInspector.activity.toolResult')} · ${row.record.name ?? row.record.kind}`
    }
    return row.record.name ?? row.record.kind
  }
  if (row.recordType === 'evidence') {
    return `${t('tapeInspector.evidence.request')} · ${row.record.providerId}/${row.record.modelId}`
  }
  if (row.recordType === 'evidence_lane') {
    return t(`tapeInspector.evidence.lanes.${row.laneKind}`, { count: row.count })
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
  return row.summary.toolName ?? t('tapeInspector.groups.tool')
})

const evidenceAssociationLabel = computed(() => {
  if (
    props.row.recordType !== 'evidence' ||
    props.row.association === 'attempt' ||
    props.row.association === 'unresolved'
  ) {
    return null
  }
  return t(`tapeInspector.evidence.scope.${props.row.association}`)
})

function appendFactSummary(parts: string[], facts: TapeInspectorFactRow['record']['facts']): void {
  if (!facts) return
  if (facts.toolName) parts.push(facts.toolName)
  if (facts.targetServer) parts.push(facts.targetServer)
  if (facts.providerId || facts.modelId) {
    parts.push([facts.providerId, facts.modelId].filter(Boolean).join(' / '))
  }
  if (facts.outcome) parts.push(facts.outcome)
  if (facts.stopReason && facts.stopReason !== facts.outcome) parts.push(facts.stopReason)
  if (facts.retryDecision) parts.push(facts.retryDecision)
  if (facts.errorCode) parts.push(facts.errorCode)
  if (facts.contentPreview) parts.push(facts.contentPreview)
  if (facts.selectedCount !== undefined || facts.droppedCount !== undefined) {
    parts.push(
      t('tapeInspector.activity.memorySelection', {
        selected: facts.selectedCount ?? 0,
        dropped: facts.droppedCount ?? 0
      })
    )
  }
  if (facts.estimatedTokens !== undefined || facts.tokenBudget !== undefined) {
    parts.push(
      t('tapeInspector.activity.tokenUse', {
        used: facts.estimatedTokens ?? 0,
        budget: facts.tokenBudget ?? 0
      })
    )
  }
}

function activityLabel(kind: TapeInspectorRequestActivityKind): string {
  if (kind === 'user') return t('tapeInspector.activity.user')
  if (kind === 'assistant') return t('tapeInspector.activity.assistant')
  if (kind === 'reasoning') return t('tapeInspector.activity.reasoning')
  if (kind === 'tool') return t('tapeInspector.groups.tool')
  if (kind === 'media') return t('tapeInspector.activity.media')
  return t('tapeInspector.timeline.error')
}

function requestRelationLabel(relation: TapeInspectorRequestRowActivity['relation']): string {
  return t(`tapeInspector.activity.relations.${relation}`)
}

const semanticSummaryLabel = computed(() => {
  const row = props.row
  const parts: string[] = []
  if (row.recordType === 'fact') {
    appendFactSummary(parts, row.record.facts)
    if (props.messagePreview) {
      parts.push(
        `${t(`tapeInspector.activity.${props.messagePreview.role}`)}: ${props.messagePreview.text}`
      )
    } else if (parts.length === 0) {
      parts.push(t(`tapeInspector.families.${row.record.family}`))
    }
  } else if (row.recordType === 'evidence') {
    parts.push(`#${row.record.requestSeq}`)
    if (props.requestActivity) {
      const activity = props.requestActivity.activity
      const label = activityLabel(activity.kind)
      const relation = requestRelationLabel(props.requestActivity.relation)
      parts.push(
        activity.preview ? `${relation} · ${label}: ${activity.preview}` : `${relation} · ${label}`
      )
    }
  } else if (row.recordType === 'evidence_lane') {
    if (row.laneKind === 'diagnostic') return t('tapeInspector.evidence.scope.diagnostic')
    return t(
      row.laneKind === 'earlier'
        ? 'tapeInspector.evidence.earlierSummary'
        : 'tapeInspector.evidence.standaloneSummary'
    )
  } else {
    appendFactSummary(parts, row.summary)
    parts.push(`${t('tapeInspector.fields.records')}: ${row.summary.factCount}`)
    if (row.group.kind === 'run' && row.group.runId) parts.push(shortIdentity(row.group.runId))
    if (row.group.kind === 'tool' && row.group.providerToolCallId) {
      parts.push(shortIdentity(row.group.providerToolCallId))
    }
  }
  return [...new Set(parts.filter(Boolean))].join(' · ')
})

const kindLabel = computed(() => {
  if (props.row.recordType === 'fact') return props.row.record.kind
  if (props.row.recordType === 'evidence') return t('tapeInspector.kinds.evidence')
  if (props.row.recordType === 'evidence_lane') {
    return props.row.laneKind === 'diagnostic'
      ? t('tapeInspector.evidence.scope.diagnostic')
      : t('tapeInspector.kinds.lane')
  }
  return t('tapeInspector.kinds.group')
})

const showStatus = computed(() => props.row.statusState !== 'not_applicable')
const statusLabel = computed(() => {
  if (props.row.statusState === 'unresolved') {
    return props.row.incompleteReason
      ? incompleteStateLabel(props.row.incompleteReason)
      : t('tapeInspector.states.statusPending')
  }
  return props.row.status ?? '—'
})
const statusTitle = computed(() =>
  props.row.statusState === 'not_applicable'
    ? t('tapeInspector.states.notApplicable')
    : statusLabel.value
)
const statusClass = computed(() => {
  if (props.row.statusState === 'unresolved') {
    return 'border border-border/70 text-muted-foreground'
  }
  if (props.row.status === 'error') return 'bg-destructive/10 text-destructive'
  if (props.row.status === 'success' || props.row.status === 'completed') {
    return 'bg-foreground/10 text-foreground'
  }
  return 'text-muted-foreground'
})

const startLabel = computed(() => {
  if (props.row.actualStartAt === null) return '—'
  return d(new Date(props.row.actualStartAt), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
})
const durationLabel = computed(() => {
  if (props.row.timingState === 'unresolved') {
    return props.row.incompleteReason ? '—' : t('tapeInspector.states.timingPending')
  }
  const duration = props.row.durationMs
  if (duration === null) return '—'
  if (duration < 1_000) return `${duration} ms`
  return `${(duration / 1_000).toFixed(2)} s`
})
const durationTitle = computed(() => {
  if (props.row.timingState === 'point') return t('tapeInspector.waterfall.point')
  if (props.row.timingState === 'not_applicable') return t('tapeInspector.states.notApplicable')
  if (props.row.timingState === 'unresolved' && props.row.incompleteReason) {
    return incompleteStateLabel(props.row.incompleteReason)
  }
  if (props.row.timingState === 'unresolved') return t('tapeInspector.states.timingPending')
  return durationLabel.value
})
const displaySummaryLabel = computed(() => {
  const parts = semanticSummaryLabel.value ? [semanticSummaryLabel.value] : []
  if (props.layout === 'medium') parts.push(kindLabel.value, startLabel.value)
  if (props.layout === 'compact') {
    parts.push(kindLabel.value, startLabel.value, durationLabel.value)
  }
  return [...new Set(parts.filter(Boolean))].join(' · ')
})
const rowIcon = computed(() => {
  if (props.row.recordType === 'evidence') return 'lucide:radio'
  if (props.row.recordType === 'evidence_lane') return 'lucide:radio-tower'
  if (props.row.recordType === 'group') {
    if (props.row.group.kind === 'run') return 'lucide:activity'
    if (props.row.group.kind === 'request') return 'lucide:bot'
    if (props.row.group.kind === 'attempt') return 'lucide:rotate-cw'
    return 'lucide:wrench'
  }
  const familyIcons: Record<TapeInspectorFactRow['record']['family'], string> = {
    context: 'lucide:layers',
    journal: 'lucide:route',
    contract: 'lucide:shield-check',
    view: 'lucide:panel-top',
    attempt: 'lucide:bot',
    anchor: 'lucide:anchor',
    message: 'lucide:message-square',
    lineage: 'lucide:git-fork',
    tool: 'lucide:wrench',
    other: 'lucide:diamond'
  }
  return familyIcons[props.row.record.family]
})

const semanticTone = computed<'error' | 'input' | 'session' | 'model' | 'tool' | 'neutral'>(() => {
  const row = props.row
  const explicitStatus = row.status?.toLocaleLowerCase()
  if (
    explicitStatus === 'error' ||
    explicitStatus === 'failed' ||
    explicitStatus === 'failure' ||
    (row.recordType === 'fact' &&
      (row.record.facts?.isError === true || Boolean(row.record.facts?.errorCode))) ||
    (row.recordType === 'group' && Boolean(row.summary.errorCode))
  ) {
    return 'error'
  }
  if (row.recordType === 'evidence') {
    return row.association === 'diagnostic' ? 'neutral' : 'model'
  }
  if (row.recordType === 'evidence_lane') {
    return row.laneKind === 'diagnostic' ? 'neutral' : 'model'
  }
  if (row.recordType === 'group') {
    if (row.group.kind === 'request' || row.group.kind === 'attempt') return 'model'
    if (row.group.kind === 'tool') return 'tool'
    return 'session'
  }
  if (row.record.name === 'message/user') return 'input'
  if (row.record.name === 'message/assistant') return 'model'
  if (row.record.family === 'attempt') return 'model'
  if (row.record.family === 'tool') return 'tool'
  if (
    row.record.family === 'context' ||
    row.record.family === 'view' ||
    row.record.family === 'anchor' ||
    row.record.family === 'lineage'
  ) {
    return 'session'
  }
  return 'neutral'
})

const accentClass = computed(
  () =>
    ({
      error: 'bg-destructive',
      input: 'bg-emerald-500',
      session: 'bg-emerald-500',
      model: 'bg-violet-500',
      tool: 'bg-amber-500',
      neutral: 'bg-muted-foreground/40'
    })[semanticTone.value]
)

const iconClass = computed(
  () =>
    ({
      error: 'text-destructive',
      input: 'text-emerald-600 dark:text-emerald-400',
      session: 'text-emerald-600 dark:text-emerald-400',
      model: 'text-violet-600 dark:text-violet-400',
      tool: 'text-amber-600 dark:text-amber-400',
      neutral: 'text-muted-foreground'
    })[semanticTone.value]
)

function toggleIfCollapsible(): void {
  if (isCollapsible.value) emit('toggle', props.row.key)
}
</script>
