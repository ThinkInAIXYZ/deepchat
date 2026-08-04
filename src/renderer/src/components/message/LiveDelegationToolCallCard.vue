<template>
  <article
    class="w-full max-w-2xl rounded-lg border bg-muted/20 px-3 py-2.5"
    :data-testid="`live-delegation-tool-card-${delegationId || 'pending'}`"
  >
    <div class="flex flex-wrap items-center gap-2">
      <span class="h-2 w-2 shrink-0 rounded-full" :class="statusDotClass" aria-hidden="true"></span>
      <Icon icon="lucide:git-fork" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div class="min-w-32 flex-1">
        <p class="truncate text-xs font-medium text-foreground" :title="title">
          {{ title }}
        </p>
        <p class="mt-0.5 truncate text-[10px] text-muted-foreground" :title="slotId">
          {{ slotId }}
        </p>
      </div>
      <span
        class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
        :class="statusBadgeClass"
        aria-live="polite"
      >
        {{ statusLabel }}
      </span>
      <Button
        v-if="delegationId && (childSessionId || !authoritative)"
        :variant="statusPresentation.actionRequired ? 'default' : 'ghost'"
        size="sm"
        class="h-7 px-2 text-[10px]"
        :data-testid="`live-delegation-tool-open-${delegationId}`"
        :data-action-required="statusPresentation.actionRequired ? 'true' : undefined"
        :disabled="opening || (authoritative && !childSessionId)"
        @click="openChild"
      >
        <Icon icon="lucide:external-link" class="mr-1 h-3 w-3" />
        {{ t('chat.orchestration.actions.openChild') }}
      </Button>
      <Button
        v-if="canInterrupt"
        variant="ghost"
        size="icon"
        class="h-7 w-7 text-destructive hover:text-destructive"
        :aria-label="t('common.cancel')"
        :data-testid="`live-delegation-tool-interrupt-${delegationId}`"
        :disabled="interrupting || readOnly"
        @click="interrupt"
      >
        <Icon icon="lucide:square" class="h-3 w-3" />
      </Button>
      <button
        type="button"
        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('chat.toolCall.clickToView')"
        :aria-expanded="detailsExpanded"
        :aria-controls="detailsId"
        data-testid="live-delegation-tool-details"
        @click="emit('toggleDetails')"
      >
        <Icon
          icon="lucide:chevron-right"
          class="h-3.5 w-3.5 transition-transform"
          :class="detailsExpanded && 'rotate-90'"
        />
      </button>
    </div>

    <p
      v-if="preview"
      class="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-[11px]"
      :class="delegation?.errorPreview ? 'text-destructive' : 'text-muted-foreground'"
    >
      {{ preview }}
    </p>
    <p v-if="actionError" class="mt-2 break-words text-[11px] text-destructive">
      {{ actionError }}
    </p>
  </article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import {
  getLiveDelegationStatusPresentation,
  type LiveDelegationDisplayStatus
} from '@/lib/liveDelegationPresentation'
import type { ParsedLiveDelegationSpawn } from '@/lib/liveDelegationToolCall'
import { useLiveDelegationStore } from '@/stores/ui/liveDelegation'
import { useSessionStore } from '@/stores/ui/session'

const props = defineProps<{
  parentSessionId: string
  spawn: ParsedLiveDelegationSpawn
  toolStatus: DisplayAssistantMessageBlock['status']
  detailsId: string
  detailsExpanded: boolean
  readOnly?: boolean
}>()

const emit = defineEmits<{ toggleDetails: [] }>()
const { t } = useI18n()
const sessionStore = useSessionStore()
const liveDelegationStore = useLiveDelegationStore()
const actionError = ref<string | null>(null)
const opening = ref(false)

const delegationId = computed(() => props.spawn.delegation?.id ?? null)
const delegation = computed(() => {
  const id = delegationId.value
  if (!id) return null
  return (
    liveDelegationStore.getDelegation(props.parentSessionId, id) ?? props.spawn.delegation ?? null
  )
})
const title = computed(() => delegation.value?.title ?? props.spawn.title)
const slotId = computed(() => delegation.value?.slotId ?? props.spawn.slotId)
const childSessionId = computed(() => delegation.value?.childSessionId ?? null)
const authoritative = computed(() =>
  delegationId.value
    ? liveDelegationStore.isAuthoritative(props.parentSessionId, delegationId.value)
    : false
)
const status = computed<LiveDelegationDisplayStatus>(() => {
  if (props.toolStatus === 'error') return 'tool_error'
  return delegation.value?.status ?? 'queued'
})
const statusPresentation = computed(() => getLiveDelegationStatusPresentation(status.value))
const preview = computed(
  () => delegation.value?.errorPreview || delegation.value?.summaryPreview || ''
)
const canInterrupt = computed(() => Boolean(delegationId.value && statusPresentation.value.active))
const interrupting = computed(() =>
  delegationId.value
    ? liveDelegationStore.isInterrupting(props.parentSessionId, delegationId.value)
    : false
)
const statusLabel = computed(() => t(statusPresentation.value.labelKey))
const statusDotClass = computed(() => statusPresentation.value.dotClass)
const statusBadgeClass = computed(() => statusPresentation.value.badgeClass)

async function openChild(): Promise<void> {
  const id = delegationId.value
  if (!id || opening.value) return
  opening.value = true
  actionError.value = null
  try {
    const confirmed = await liveDelegationStore.confirm(props.parentSessionId, id)
    if (confirmed.slotId !== props.spawn.slotId || confirmed.title !== props.spawn.title) {
      throw new Error('The delegation no longer matches this transcript entry.')
    }
    if (!confirmed.childSessionId) throw new Error('The child Session is not available yet.')
    await sessionStore.selectSession(confirmed.childSessionId)
  } catch (error) {
    console.warn('[LiveDelegationToolCallCard] Failed to open child Session:', error)
    actionError.value = t('common.error.operationFailed')
  } finally {
    opening.value = false
  }
}

async function interrupt(): Promise<void> {
  const id = delegationId.value
  if (!id || interrupting.value || props.readOnly) return
  actionError.value = null
  try {
    await liveDelegationStore.interrupt(props.parentSessionId, id, {
      slotId: props.spawn.slotId,
      title: props.spawn.title
    })
  } catch (error) {
    console.warn('[LiveDelegationToolCallCard] Failed to interrupt delegation:', error)
    actionError.value = t('common.error.operationFailed')
  }
}

watch(
  () => props.spawn.delegation,
  (seed) => {
    if (seed?.parentSessionId === props.parentSessionId) liveDelegationStore.seed(seed)
  },
  { immediate: true }
)

watch(
  () => props.parentSessionId,
  (parentSessionId) => void liveDelegationStore.ensureLoaded(parentSessionId),
  { immediate: true }
)
</script>
