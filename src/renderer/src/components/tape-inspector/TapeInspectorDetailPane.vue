<template>
  <aside class="flex h-[38%] min-h-[220px] w-full shrink-0 flex-col border-t bg-background">
    <div class="flex h-9 shrink-0 items-center justify-between border-b px-3">
      <span class="text-xs font-medium">{{ t('tapeInspector.detail.title') }}</span>
      <div class="flex items-center gap-2">
        <span v-if="capabilities" class="text-[10px] uppercase text-muted-foreground">
          {{ t(`tapeInspector.detail.sources.${capabilities.source}`) }}
        </span>
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
      </div>
    </div>

    <div v-if="!row" class="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
      <div class="text-xs text-muted-foreground">{{ t('tapeInspector.detail.selectPrompt') }}</div>
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
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import type {
  TapeInspectorDetailCapabilities,
  TapeInspectorDetailState,
  TapeInspectorDisplayRow
} from './model'
import type { TapeInspectorErrorCode } from './store'

const props = defineProps<{
  row: TapeInspectorDisplayRow | null
  detail: TapeInspectorDetailState | null
  capabilities: TapeInspectorDetailCapabilities | null
  loading: boolean
  errorCode: TapeInspectorErrorCode
}>()

const emit = defineEmits<{
  retry: []
}>()

const { t } = useI18n()
const copied = ref(false)
let copiedTimer: number | null = null
let copyGeneration = 0

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

const summaryFields = computed(() => {
  const detail = props.detail
  if (!detail) return []
  if (detail.source === 'tape') {
    const record = detail.detail.record
    return [
      { label: t('tapeInspector.fields.entryId'), value: String(record.entryId) },
      { label: t('tapeInspector.fields.family'), value: record.family },
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
      { label: t('tapeInspector.fields.group'), value: detail.group.kind },
      { label: t('tapeInspector.fields.identity'), value: json(detail.group) }
    ]
  }
  return [
    { label: t('tapeInspector.fields.kind'), value: t('tapeInspector.kinds.lane') },
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
      headers: parseJson(detail.trace.headersJson),
      body: parseJson(detail.trace.bodyJson)
    })
  }
  return null
})
const isTruncated = computed(
  () => props.detail?.source === 'request' && props.detail.trace.truncated
)
const provenanceText = computed(() => {
  if (props.detail?.source !== 'tape') return null
  const provenance = props.detail.detail.provenance
  return Object.keys(provenance).length === 0 ? null : json(provenance)
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
  return { kind: 'unbound_evidence', count: detail.count }
}

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
