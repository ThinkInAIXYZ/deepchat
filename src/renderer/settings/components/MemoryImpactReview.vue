<template>
  <Collapsible v-model:open="open" class="rounded-lg border" data-testid="memory-impact-review">
    <CollapsibleTrigger
      class="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
      data-testid="memory-impact-trigger"
      :disabled="archiving || disabled"
    >
      {{ t('settings.memory.redesign.impactTitle') }}
      <Icon :icon="open ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="h-4 w-4" />
    </CollapsibleTrigger>
    <CollapsibleContent class="border-t">
      <div class="space-y-3 p-3">
        <p class="text-[11px] text-muted-foreground">
          {{ t('settings.memory.redesign.impactDescription') }}
        </p>
        <div
          v-if="loading && items.length === 0"
          class="py-3 text-center text-xs text-muted-foreground"
        >
          {{ t('common.loading') }}
        </div>
        <div v-else-if="error && items.length === 0" role="alert" class="space-y-2 text-xs">
          <p class="text-destructive">{{ t('settings.memory.redesign.impactLoadFailed') }}</p>
          <DcButton variant="outline" size="sm" class="h-7 text-xs" @click="retry">
            {{ t('settings.memory.redesign.retry') }}
          </DcButton>
        </div>
        <p v-else-if="unavailable" class="py-3 text-center text-xs text-muted-foreground">
          {{ t('settings.memory.redesign.impactUnavailable') }}
        </p>
        <p
          v-else-if="items.length === 0 && !nextCursor"
          class="py-3 text-center text-xs text-muted-foreground"
        >
          {{ t('settings.memory.redesign.impactEmpty') }}
        </p>
        <ul v-else class="max-h-64 space-y-2 overflow-y-auto">
          <li
            v-for="item in items.filter((row) => !statuses.has(row.memory.id))"
            :key="item.memory.id"
            class="flex items-start gap-2 rounded-md border bg-background px-2.5 py-2"
          >
            <Checkbox
              :checked="selected.has(item.memory.id)"
              :disabled="archiving || loading || disabled || statuses.has(item.memory.id)"
              :aria-label="t('settings.memory.redesign.impactSelectItem')"
              @update:checked="setSelected(item.memory.id, $event)"
            />
            <div class="min-w-0 flex-1">
              <p class="whitespace-pre-wrap wrap-break-word text-xs">{{ item.memory.content }}</p>
            </div>
          </li>
        </ul>
        <ul v-if="statuses.size" class="max-h-64 space-y-2 overflow-y-auto" aria-live="polite">
          <li v-for="[id, outcome] in statuses" :key="id" class="rounded-md border px-2.5 py-2">
            <p class="whitespace-pre-wrap wrap-break-word text-xs">{{ outcome.content }}</p>
            <p
              class="mt-1 text-[11px]"
              :class="outcome.status === 'applied' ? 'text-muted-foreground' : 'text-destructive'"
              :data-testid="`memory-impact-status-${id}`"
            >
              {{ statusLabel(outcome.status) }}
            </p>
          </li>
        </ul>
        <div v-if="nextCursor || (error && items.length > 0)" class="flex justify-center">
          <DcButton
            variant="outline"
            size="sm"
            class="h-7 text-xs"
            :disabled="loading || archiving"
            data-testid="memory-impact-load-more"
            @click="loadMore"
          >
            {{
              loading
                ? t('common.loading')
                : error
                  ? t('settings.memory.redesign.retry')
                  : t('settings.memory.redesign.loadMore')
            }}
          </DcButton>
        </div>
        <div v-if="items.length > 0 || statuses.size > 0" class="flex flex-wrap justify-end gap-2">
          <DcButton
            variant="outline"
            size="sm"
            :disabled="archiving || loading || disabled"
            data-testid="memory-impact-refresh"
            @click="refresh"
          >
            {{ t('settings.memory.redesign.refresh') }}
          </DcButton>
          <DcButton
            size="sm"
            class="h-8 text-xs"
            :disabled="archiving || loading || disabled || selected.size === 0"
            data-testid="memory-impact-archive-selected"
            @click="archiveSelected"
          >
            <Spinner v-if="archiving" class="mr-1.5 size-3.5" />
            {{ t('settings.memory.redesign.impactArchiveSelected', { count: selected.size }) }}
          </DcButton>
        </div>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@shadcn/components/ui/collapsible'
import { Spinner } from '@shadcn/components/ui/spinner'
import { createMemoryClient } from '@api/MemoryClient'
import type { MemoryImpactPage, MemoryLineageCursor } from '@shared/contracts/routes'

const props = defineProps<{
  agentId: string
  memoryId: string
  refreshToken?: number
  disabled?: boolean
}>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const { t } = useI18n()
const memoryClient = createMemoryClient()
const open = ref(false)
const loading = ref(false)
const archiving = ref(false)
const error = ref(false)
const unavailable = ref(false)
const items = ref<MemoryImpactPage['items']>([])
const nextCursor = shallowRef<MemoryLineageCursor | null>(null)
const selected = ref<ReadonlySet<string>>(new Set())
type ImpactStatus = 'applied' | 'rejected' | 'network'
const statuses = ref<ReadonlyMap<string, { content: string; status: ImpactStatus }>>(new Map())
let requestId = 0

function current(agentId: string, memoryId: string, id: number): boolean {
  return id === requestId && props.agentId === agentId && props.memoryId === memoryId
}

async function load(append: boolean): Promise<void> {
  if (loading.value || archiving.value || props.disabled || (append && !nextCursor.value)) return
  const agentId = props.agentId
  const memoryId = props.memoryId
  const cursor = append ? nextCursor.value : null
  const id = ++requestId
  loading.value = true
  error.value = false
  try {
    const page = await memoryClient.getImpact(agentId, memoryId, { cursor })
    if (!current(agentId, memoryId, id)) return
    unavailable.value = page === null
    items.value = page ? (append ? [...items.value, ...page.items] : page.items) : []
    nextCursor.value = page?.nextCursor ?? null
    if (!append) {
      selected.value = new Set()
    }
    if (!page) statuses.value = new Map()
  } catch (loadError) {
    if (!current(agentId, memoryId, id)) return
    console.error('[MemoryImpactReview] Failed to load impact', loadError)
    error.value = true
  } finally {
    if (current(agentId, memoryId, id)) loading.value = false
  }
}

function setSelected(memoryId: string, checked: boolean | 'indeterminate'): void {
  if (archiving.value || loading.value || props.disabled) return
  const next = new Set(selected.value)
  if (checked === true) next.add(memoryId)
  else next.delete(memoryId)
  selected.value = next
}

function statusLabel(status: ImpactStatus): string {
  return t(
    `settings.memory.redesign.impactStatus${status === 'applied' ? 'Applied' : status === 'rejected' ? 'Rejected' : 'Network'}`
  )
}

async function archiveSelected(): Promise<void> {
  if (archiving.value || loading.value || props.disabled || selected.value.size === 0) return
  const agentId = props.agentId
  const memoryId = props.memoryId
  const batchId = ++requestId
  const targets = items.value.filter((item) => selected.value.has(item.memory.id))
  archiving.value = true
  emit('busy', true)
  for (const item of targets) {
    if (!current(agentId, memoryId, batchId)) break
    let status: ImpactStatus
    try {
      const result = await memoryClient.archiveImpact(
        agentId,
        memoryId,
        item.memory.id,
        item.revision
      )
      status = result.action === 'rejected' ? 'rejected' : 'applied'
    } catch (archiveError) {
      console.error('[MemoryImpactReview] Failed to archive impacted memory', archiveError)
      status = 'network'
    }
    if (current(agentId, memoryId, batchId)) {
      statuses.value = new Map(statuses.value).set(item.memory.id, {
        content: item.memory.content,
        status
      })
    }
  }
  if (!current(agentId, memoryId, batchId)) return
  archiving.value = false
  emit('busy', false)
  // Results describe this explicit operation, not the next preview's eligible rows.
  selected.value = new Set()
}

function retry(): void {
  void load(nextCursor.value !== null)
}
function loadMore(): void {
  void load(true)
}

function refresh(): void {
  if (archiving.value || props.disabled) return
  selected.value = new Set()
  statuses.value = new Map()
  items.value = []
  nextCursor.value = null
  void load(false)
}

onBeforeUnmount(() => {
  requestId += 1
})

watch(open, (value) => {
  if (value && items.value.length === 0 && !unavailable.value) void load(false)
})
watch(
  () => [props.agentId, props.memoryId] as const,
  ([agentId, memoryId], [previousAgent, previousMemory]) => {
    if (agentId === previousAgent && memoryId === previousMemory) return
    requestId += 1
    archiving.value = false
    emit('busy', false)
    open.value = false
    loading.value = false
    error.value = false
    unavailable.value = false
    items.value = []
    nextCursor.value = null
    selected.value = new Set()
    statuses.value = new Map()
  }
)
watch(
  () => [props.refreshToken, props.disabled, archiving.value],
  () => {
    // Resume invalidation after either operation, including refreshes received while busy.
    if (archiving.value || props.disabled) return
    requestId += 1
    loading.value = false
    error.value = false
    unavailable.value = false
    items.value = []
    nextCursor.value = null
    selected.value = new Set()
    if (open.value) void load(false)
  }
)
</script>
