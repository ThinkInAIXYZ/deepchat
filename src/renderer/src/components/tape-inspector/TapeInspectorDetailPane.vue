<template>
  <FocusScope
    as-child
    :loop="placement === 'overlay'"
    :present="placement === 'overlay'"
    :trapped="placement === 'overlay'"
    @mount-auto-focus="handleMountAutoFocus"
    @unmount-auto-focus="handleUnmountAutoFocus"
  >
    <aside
      data-testid="tape-inspector-detail-pane"
      class="flex min-h-0 flex-col bg-background outline-none"
      :class="
        placement === 'side'
          ? 'h-full w-[clamp(320px,38%,480px)] shrink-0 border-l'
          : 'absolute inset-0 z-20 h-full w-full'
      "
      :role="placement === 'overlay' ? 'dialog' : 'complementary'"
      :aria-modal="placement === 'overlay' ? 'true' : undefined"
      :aria-label="t('tapeInspector.detail.title')"
      tabindex="-1"
      @keydown.esc.stop="emit('close')"
    >
      <div class="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span class="text-xs font-medium">{{ t('tapeInspector.detail.title') }}</span>
        <div class="flex items-center gap-2">
          <span v-if="capabilities" class="text-[10px] uppercase text-muted-foreground">
            {{ t(`tapeInspector.detail.sources.${capabilities.source}`) }}
          </span>
          <DcButton
            v-if="messageDiagnosticsTarget && capabilities?.messageDiagnostics"
            data-testid="tape-inspector-open-message-diagnostics"
            size="icon-sm"
            variant="ghost"
            icon="lucide:external-link"
            :label="t('traceDialog.title')"
            :tooltip="t('traceDialog.title')"
            @click="emit('openMessageDiagnostics', messageDiagnosticsTarget)"
          />
          <DcButton
            v-if="detail"
            data-testid="tape-inspector-copy-selected"
            size="icon-sm"
            variant="ghost"
            :icon="copied ? 'lucide:check' : 'lucide:copy'"
            :label="copied ? t('common.copied') : t('common.copy')"
            :tooltip="copied ? t('common.copied') : t('common.copy')"
            @click="copySelected"
          />
          <DcButton
            data-testid="tape-inspector-close-detail"
            size="icon-sm"
            variant="ghost"
            icon="lucide:x"
            :label="t('common.close')"
            :tooltip="t('common.close')"
            @click="emit('close')"
          />
        </div>
      </div>

      <div v-if="!row" class="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
        <div class="text-xs text-muted-foreground">
          {{ t('tapeInspector.detail.selectPrompt') }}
        </div>
      </div>
      <div v-else-if="loading" class="flex min-h-0 flex-1 items-center justify-center">
        <Icon icon="lucide:loader-circle" class="size-4 animate-spin text-muted-foreground" />
      </div>
      <div
        v-else-if="errorCode"
        class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6"
      >
        <div class="text-xs text-destructive">{{ t(`tapeInspector.errors.${errorCode}`) }}</div>
        <DcButton size="sm" variant="outline" class="h-7 text-xs" @click="emit('retry')">
          {{ t('common.retry') }}
        </DcButton>
      </div>
      <div v-else-if="detail" class="min-h-0 flex-1 overflow-auto p-3">
        <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
          <template v-for="field in summaryFields" :key="field.label">
            <dt class="text-muted-foreground">{{ field.label }}</dt>
            <dd class="min-w-0 break-all font-mono text-[11px]">{{ field.value }}</dd>
          </template>
        </dl>

        <p
          v-if="detail.source === 'evidence_lane' && detail.laneKind !== 'diagnostic'"
          data-testid="tape-inspector-standalone-request-hint"
          class="mt-4 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground"
        >
          {{
            t(
              detail.laneKind === 'earlier'
                ? 'tapeInspector.evidence.earlierHint'
                : 'tapeInspector.evidence.standaloneHint'
            )
          }}
        </p>

        <p
          v-if="isMemoryManifestDetail"
          data-testid="tape-inspector-memory-manifest-hint"
          class="mt-4 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground"
        >
          {{ t('tapeInspector.detail.memoryManifestHint') }}
        </p>

        <section
          v-if="detail.source === 'request' && observedActivities.length > 0"
          data-testid="tape-inspector-request-result"
          class="mt-4 border-t pt-3"
        >
          <h3 class="text-xs font-medium">{{ observedActivityHeading }}</h3>
          <p class="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            {{ observedActivityDescription }}
          </p>
          <p
            v-if="requestObservation?.afterTruncated"
            class="mt-1 text-[10px] leading-relaxed text-muted-foreground"
          >
            {{ t('tapeInspector.detail.resultBlocksTruncated') }}
          </p>
          <ol class="mt-2 divide-y border-y text-xs">
            <li v-for="activity in observedActivities" :key="activity.key" class="py-2">
              <div class="flex min-w-0 items-center gap-2">
                <span class="font-medium">{{ activityLabel(activity.kind) }}</span>
                <time class="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                  {{ formatActivityTime(activity.timestamp) }}
                </time>
              </div>
              <p
                v-if="activity.text"
                class="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed"
              >
                {{ activity.text }}
              </p>
              <span v-if="activity.truncated" class="mt-1 block text-[10px] text-muted-foreground">
                {{ t('tapeInspector.detail.truncated') }}
              </span>
            </li>
          </ol>
        </section>

        <section
          v-if="detail.source === 'request' && requestContextActivities.length > 0"
          data-testid="tape-inspector-request-context"
          class="mt-4 border-t pt-3"
        >
          <h3 class="mb-2 text-xs font-medium">{{ t('tapeInspector.detail.contextTail') }}</h3>
          <ol class="divide-y border-y text-xs">
            <li v-for="activity in requestContextActivities" :key="activity.key" class="py-2">
              <div class="flex min-w-0 items-center gap-2">
                <span class="font-medium">{{ activityLabel(activity.kind) }}</span>
                <time class="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                  {{ formatActivityTime(activity.timestamp) }}
                </time>
              </div>
              <p
                v-if="activity.text"
                class="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground"
              >
                {{ activity.text }}
              </p>
              <span v-if="activity.truncated" class="mt-1 block text-[10px] text-muted-foreground">
                {{ t('tapeInspector.detail.truncated') }}
              </span>
            </li>
          </ol>
        </section>

        <section v-if="capabilities?.integrity && integrityLabel" class="mt-4 border-t pt-3">
          <h3 class="mb-2 text-xs font-medium">{{ t('tapeInspector.detail.integrity') }}</h3>
          <span class="rounded bg-muted px-1.5 py-0.5 text-[10px]">{{ integrityLabel }}</span>
        </section>

        <section v-if="capabilities?.provenance && provenanceText" class="mt-4 border-t pt-3">
          <h3 class="mb-2 text-xs font-medium">{{ t('tapeInspector.detail.provenance') }}</h3>
          <pre
            class="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 font-mono text-[10px]"
            >{{ provenanceText }}</pre
          >
        </section>

        <section v-if="capabilities?.timing && timingText" class="mt-4 border-t pt-3">
          <h3 class="mb-2 text-xs font-medium">{{ t('tapeInspector.detail.timing') }}</h3>
          <pre
            class="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 font-mono text-[10px]"
            >{{ timingText }}</pre
          >
        </section>

        <section v-if="capabilities?.payload && payloadText" class="mt-4 border-t pt-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <h3 class="text-xs font-medium">{{ t('tapeInspector.detail.payload') }}</h3>
            <span v-if="isTruncated" class="text-[10px] text-muted-foreground">
              {{ t('tapeInspector.detail.truncated') }}
            </span>
          </div>
          <pre
            class="max-h-[360px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 font-mono text-[10px]"
            >{{ payloadText }}</pre
          >
        </section>

        <section v-if="hashesText" class="mt-4 border-t pt-3">
          <h3 class="mb-2 text-xs font-medium">{{ t('tapeInspector.detail.hashes') }}</h3>
          <pre
            class="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 font-mono text-[10px]"
            >{{ hashesText }}</pre
          >
        </section>

        <section v-if="capabilities?.raw && rawText" class="mt-4 border-t pt-3">
          <h3 class="mb-2 text-xs font-medium">{{ t('tapeInspector.detail.raw') }}</h3>
          <pre
            class="max-h-[360px] overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 font-mono text-[10px]"
            >{{ rawText }}</pre
          >
        </section>
      </div>
    </aside>
  </FocusScope>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { FocusScope } from 'reka-ui'
import type {
  TapeInspectorDetailCapabilities,
  TapeInspectorDetailState,
  TapeInspectorDisplayRow,
  TapeInspectorMessageDiagnosticsTarget
} from './model'
import type {
  TapeInspectorRequestActivity,
  TapeInspectorRequestActivityKind,
  TapeInspectorRequestObservation
} from './messagePreview'
import type { TapeInspectorErrorCode } from './store'

const props = withDefaults(
  defineProps<{
    row: TapeInspectorDisplayRow | null
    detail: TapeInspectorDetailState | null
    capabilities: TapeInspectorDetailCapabilities | null
    loading: boolean
    errorCode: TapeInspectorErrorCode
    placement?: 'side' | 'overlay'
    requestObservation?: TapeInspectorRequestObservation | null
  }>(),
  { placement: 'side', requestObservation: null }
)

const emit = defineEmits<{
  close: []
  retry: []
  openMessageDiagnostics: [target: TapeInspectorMessageDiagnosticsTarget]
}>()

const { t, d } = useI18n()
const copied = ref(false)
let copiedTimer: number | null = null
let copyGeneration = 0

function handleMountAutoFocus(event: Event): void {
  if (props.placement === 'side') event.preventDefault()
}

function handleUnmountAutoFocus(event: Event): void {
  if (props.placement === 'side') event.preventDefault()
}

const messageDiagnosticsTarget = computed<TapeInspectorMessageDiagnosticsTarget | null>(() => {
  const row = props.row
  if (!row) return null
  if (row.recordType === 'fact' || row.recordType === 'evidence') {
    if (!row.record.messageId) return null
    return { messageId: row.record.messageId, requestSeq: row.record.requestSeq }
  }
  if (row.recordType === 'group') {
    if (!row.group.messageId) return null
    return { messageId: row.group.messageId, requestSeq: row.group.requestSeq }
  }
  return null
})

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
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

function formatActivityTime(timestamp: number): string {
  return d(new Date(timestamp), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

const observedActivities = computed<readonly TapeInspectorRequestActivity[]>(
  () => props.requestObservation?.after ?? []
)
const requestContextActivities = computed<readonly TapeInspectorRequestActivity[]>(
  () => props.requestObservation?.before ?? []
)
const isMemoryManifestDetail = computed(
  () =>
    props.detail?.source === 'tape' &&
    (props.detail.detail.record.name === 'memory/view_assembled' ||
      props.detail.detail.record.name === 'memory/directive_view_assembled')
)
const observedActivityHeading = computed(() =>
  props.requestObservation?.afterBasis === 'identity'
    ? t('tapeInspector.detail.observedResult')
    : t('tapeInspector.detail.subsequentActivity')
)
const observedActivityDescription = computed(() =>
  props.requestObservation?.afterBasis === 'identity'
    ? t('tapeInspector.detail.finalSnapshot')
    : t('tapeInspector.detail.subsequentActivityHint')
)

const summaryFields = computed(() => {
  const detail = props.detail
  if (!detail) return []
  if (detail.source === 'tape') {
    const record = detail.detail.record
    return [
      { label: t('tapeInspector.fields.entryId'), value: String(record.entryId) },
      {
        label: t('tapeInspector.fields.family'),
        value: t(`tapeInspector.families.${record.family}`)
      },
      { label: t('tapeInspector.fields.name'), value: record.name ?? '—' },
      { label: t('tapeInspector.fields.kind'), value: record.kind },
      { label: t('tapeInspector.fields.disclosure'), value: detail.detail.disclosure }
    ]
  }
  if (detail.source === 'request') {
    return [
      { label: t('tapeInspector.fields.traceId'), value: detail.trace.id },
      { label: t('tapeInspector.fields.messageId'), value: detail.trace.messageId },
      { label: t('tapeInspector.fields.requestSeq'), value: String(detail.trace.requestSeq) },
      {
        label: t('tapeInspector.fields.attempt'),
        value: detail.trace.physicalAttempt === null ? '—' : String(detail.trace.physicalAttempt)
      },
      { label: t('tapeInspector.fields.provider'), value: detail.trace.providerId },
      { label: t('tapeInspector.fields.model'), value: detail.trace.modelId },
      { label: t('tapeInspector.fields.endpoint'), value: detail.trace.endpoint }
    ]
  }
  if (detail.source === 'derived') {
    return [
      {
        label: t('tapeInspector.fields.group'),
        value: t(`tapeInspector.groups.${detail.group.kind}`)
      },
      { label: t('tapeInspector.fields.identity'), value: json(detail.group) }
    ]
  }
  return [
    {
      label: t('tapeInspector.fields.kind'),
      value: t(`tapeInspector.evidence.lanes.${detail.laneKind}`, { count: detail.count })
    },
    { label: t('tapeInspector.fields.records'), value: String(detail.count) }
  ]
})

const payloadText = computed(() => {
  const detail = props.detail
  if (!detail) return null
  if (detail.source === 'tape') {
    return detail.detail.data === undefined ? null : json(detail.detail.data)
  }
  if (detail.source === 'request') {
    return json({
      body: parseJson(detail.trace.bodyJson),
      headers: parseJson(detail.trace.headersJson)
    })
  }
  return null
})
const isTruncated = computed(
  () => props.detail?.source === 'request' && props.detail.trace.truncated
)
const correlationValue = computed(() => {
  const row = props.row
  if (!row) return null
  if (row.recordType === 'fact') {
    const { entryId, runId, messageId, requestSeq, logicalRound, physicalAttempt } = row.record
    return { entryId, runId, messageId, requestSeq, logicalRound, physicalAttempt }
  }
  if (row.recordType === 'evidence') {
    const { traceId, messageId, requestSeq, physicalAttempt } = row.record
    return { traceId, messageId, requestSeq, physicalAttempt }
  }
  if (row.recordType === 'group') {
    const { runId, messageId, requestSeq, physicalAttempt, providerToolCallId, childOrdinal } =
      row.group
    return {
      runId,
      messageId,
      requestSeq,
      physicalAttempt,
      providerToolCallId,
      childOrdinal
    }
  }
  return null
})
const provenanceText = computed(() => {
  if (props.detail?.source !== 'tape') return null
  return json({ ...props.detail.detail.provenance, correlation: correlationValue.value })
})
const timingText = computed(() => {
  const row = props.row
  if (!row || row.recordType === 'evidence_lane') return null
  const { sequenceEntryId, actualStartAt, actualEndAt, durationMs, timingState } = row
  return json({ timingState, sequenceEntryId, actualStartAt, actualEndAt, durationMs })
})
const hashesText = computed(() => {
  if (props.detail?.source !== 'tape') return null
  return json({ ...props.detail.detail.hashes, ...props.detail.detail.sizes })
})
const integrityLabel = computed(() => {
  const integrity =
    props.detail?.source === 'tape' ? props.detail.detail.record.integrity : undefined
  return integrity ? t(`tapeInspector.integrity.${integrity}`) : null
})

function copyValue(): unknown {
  const detail = props.detail
  if (!detail) return null
  if (detail.source === 'tape') return detail.detail
  if (detail.source === 'request') {
    return {
      id: detail.trace.id,
      messageId: detail.trace.messageId,
      sessionId: detail.trace.sessionId,
      providerId: detail.trace.providerId,
      modelId: detail.trace.modelId,
      requestSeq: detail.trace.requestSeq,
      logicalRound: detail.trace.logicalRound,
      physicalAttempt: detail.trace.physicalAttempt,
      endpoint: detail.trace.endpoint,
      headers: parseJson(detail.trace.headersJson),
      body: parseJson(detail.trace.bodyJson),
      truncated: detail.trace.truncated,
      createdAt: detail.trace.createdAt
    }
  }
  if (detail.source === 'derived') return detail.group
  return { kind: `${detail.laneKind}_evidence`, count: detail.count }
}

const rawText = computed(() => (props.detail ? json(copyValue()) : null))

async function copySelected(): Promise<void> {
  const generation = copyGeneration
  const value = copyValue()
  try {
    await navigator.clipboard.writeText(json(value))
    if (generation !== copyGeneration) return
    copied.value = true
    if (copiedTimer !== null) window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => {
      copied.value = false
      copiedTimer = null
    }, 1_500)
  } catch (error) {
    if (generation === copyGeneration) {
      console.error('[TapeInspector] Failed to copy selected record', error)
    }
  }
}

watch(
  () => props.detail,
  () => {
    copyGeneration += 1
    copied.value = false
    if (copiedTimer !== null) {
      window.clearTimeout(copiedTimer)
      copiedTimer = null
    }
  }
)

onBeforeUnmount(() => {
  copyGeneration += 1
  if (copiedTimer !== null) window.clearTimeout(copiedTimer)
})
</script>
