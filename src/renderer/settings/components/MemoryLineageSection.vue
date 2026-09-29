<template>
  <Collapsible v-model:open="open" class="rounded-lg border">
    <CollapsibleTrigger
      class="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
      :data-testid="`memory-lineage-${direction}-trigger`"
    >
      {{ title }}
      <Icon :icon="open ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="h-4 w-4" />
    </CollapsibleTrigger>
    <CollapsibleContent class="border-t">
      <div class="max-h-72 overflow-y-auto p-3" :data-testid="`memory-lineage-${direction}`">
        <p class="mb-3 text-[11px] text-muted-foreground">
          {{ t('settings.memory.redesign.lineageCurrentContent') }}
        </p>
        <div
          v-if="loading && items.length === 0"
          class="py-4 text-center text-xs text-muted-foreground"
        >
          {{ t('common.loading') }}
        </div>
        <div v-else-if="error && items.length === 0" role="alert" class="space-y-2 py-3 text-xs">
          <p class="text-destructive">{{ t('settings.memory.redesign.lineageLoadFailed') }}</p>
          <DcButton variant="outline" size="sm" class="h-7 text-xs" @click="retry">
            {{ t('settings.memory.redesign.retry') }}
          </DcButton>
        </div>
        <p v-else-if="unavailable" class="py-4 text-center text-xs text-muted-foreground">
          {{ t('settings.memory.redesign.lineageUnavailable') }}
        </p>
        <p v-else-if="items.length === 0" class="py-4 text-center text-xs text-muted-foreground">
          {{ t('settings.memory.redesign.lineageEmpty') }}
        </p>
        <ul v-else class="space-y-2">
          <li
            v-for="item in items"
            :key="`${item.memoryId}:${item.derivationKind}:${item.createdAt}`"
            class="rounded-md border bg-background px-2.5 py-2"
          >
            <template v-if="item.memory">
              <button
                type="button"
                class="w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :data-testid="`memory-lineage-open-${item.memoryId}`"
                @click="emit('open-memory', item.memory)"
              >
                <span class="block whitespace-pre-wrap wrap-break-word text-xs">{{
                  item.memory.content
                }}</span>
                <span class="mt-1 block text-[10px] text-muted-foreground">
                  {{ shortDate(item.createdAt, locale) }}
                </span>
              </button>
            </template>
            <template v-else>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.memory.redesign.relatedMemoryUnavailable') }}
              </p>
              <p class="mt-1 text-[10px] text-muted-foreground">
                {{ shortDate(item.createdAt, locale) }}
              </p>
            </template>
          </li>
        </ul>
        <div v-if="nextCursor || (error && items.length > 0)" class="mt-3 flex justify-center">
          <DcButton
            variant="outline"
            size="sm"
            class="h-7 text-xs"
            :disabled="loading"
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
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@shadcn/components/ui/collapsible'
import { createMemoryClient } from '@api/MemoryClient'
import type { MemoryItem, MemoryLineageCursor, MemoryLineagePage } from '@shared/contracts/routes'
import { shortDate } from './memoryRedesignUtils'

const props = defineProps<{
  agentId: string
  memoryId: string
  direction: 'parents' | 'children'
  refreshToken?: number
}>()
const emit = defineEmits<{ 'open-memory': [memory: MemoryItem] }>()
const { t, locale } = useI18n()
const memoryClient = createMemoryClient()
const open = ref(false)
const loading = ref(false)
const error = ref(false)
const unavailable = ref(false)
const items = ref<MemoryLineagePage['items']>([])
// Cursors are immutable IPC values; deep reactivity would make them uncloneable proxies.
const nextCursor = shallowRef<MemoryLineageCursor | null>(null)
let requestId = 0

const title = computed(() =>
  t(
    props.direction === 'parents'
      ? 'settings.memory.redesign.lineageParents'
      : 'settings.memory.redesign.lineageChildren'
  )
)

async function load(append: boolean): Promise<void> {
  if (loading.value || (append && !nextCursor.value)) return
  const agentId = props.agentId
  const memoryId = props.memoryId
  const direction = props.direction
  const cursor = append ? nextCursor.value : null
  const currentRequest = ++requestId
  loading.value = true
  error.value = false
  try {
    const page = await memoryClient.getLineage(agentId, memoryId, direction, { cursor })
    if (
      currentRequest !== requestId ||
      props.agentId !== agentId ||
      props.memoryId !== memoryId ||
      props.direction !== direction
    )
      return
    unavailable.value = page === null
    if (!page) {
      items.value = []
      nextCursor.value = null
      return
    }
    items.value = append ? [...items.value, ...page.items] : page.items
    nextCursor.value = page.nextCursor
  } catch (loadError) {
    if (currentRequest !== requestId) return
    console.error('[MemoryLineageSection] Failed to load lineage', loadError)
    error.value = true
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

function retry(): void {
  void load(items.value.length > 0)
}

function loadMore(): void {
  void load(true)
}

watch(open, (value) => {
  if (value && items.value.length === 0 && !unavailable.value) void load(false)
})

watch(
  () => [props.agentId, props.memoryId, props.direction, props.refreshToken] as const,
  ([agentId, memoryId, direction], [previousAgent, previousMemory, previousDirection]) => {
    requestId += 1
    if (
      agentId !== previousAgent ||
      memoryId !== previousMemory ||
      direction !== previousDirection
    ) {
      open.value = false
    }
    loading.value = false
    error.value = false
    unavailable.value = false
    items.value = []
    nextCursor.value = null
    if (open.value) void load(false)
  }
)
</script>
