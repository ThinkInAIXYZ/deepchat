<template>
  <article
    class="w-full min-w-0 py-1 text-foreground/60"
    :data-testid="`live-delegation-tool-card-${delegationId || 'pending'}`"
  >
    <div class="flex flex-wrap items-center gap-2">
      <Icon
        icon="lucide:git-fork"
        class="h-4 w-4 shrink-0"
        :class="statusTextClass"
        aria-hidden="true"
      />
      <div class="flex min-w-0 flex-1 items-baseline gap-2">
        <p class="min-w-0 truncate text-sm" :title="title">
          {{ title }}
        </p>
        <p
          v-if="slotId !== title"
          class="min-w-0 max-w-[40%] truncate text-xs text-muted-foreground"
          :title="slotId"
        >
          {{ slotId }}
        </p>
      </div>
      <span
        v-if="permissionStatus"
        data-testid="tool-call-permission-badge"
        :data-permission-status="permissionStatus"
        :class="[
          'shrink-0 text-xs',
          permissionStatus === 'granted' ? 'text-muted-foreground' : 'text-destructive'
        ]"
      >
        {{
          permissionStatus === 'granted' ? t('toolCall.badge.allowed') : t('toolCall.badge.denied')
        }}
      </span>
      <span class="shrink-0 text-xs" :class="statusTextClass" aria-live="polite">
        {{ statusLabel }}
      </span>
      <div class="ml-auto inline-flex shrink-0 items-center gap-0.5">
        <DcButton
          v-if="delegationId && (childSessionId || !authoritative)"
          :variant="statusPresentation.actionRequired ? 'default' : 'ghost'"
          size="sm"
          class="h-7 px-2 text-xs"
          :data-testid="`live-delegation-tool-open-${delegationId}`"
          :data-action-required="statusPresentation.actionRequired ? 'true' : undefined"
          :disabled="opening || (authoritative && !childSessionId)"
          @click="openChild"
        >
          <Icon icon="lucide:external-link" class="mr-1 h-3 w-3" />
          {{ t('chat.orchestration.actions.openChild') }}
        </DcButton>
        <DcButton
          v-if="canInterrupt"
          variant="ghost"
          size="icon"
          class="h-7 w-7 text-muted-foreground hover:text-destructive"
          :aria-label="t('common.cancel')"
          :data-testid="`live-delegation-tool-interrupt-${delegationId}`"
          :disabled="interrupting || readOnly"
          @click="interrupt"
          :tooltip="t('common.cancel')"
        >
          <Icon icon="lucide:square" class="h-3 w-3" />
        </DcButton>
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
            class="h-3.5 w-3.5 transition-transform motion-reduce:transition-none"
            :class="detailsExpanded && 'rotate-90'"
          />
        </button>
      </div>
    </div>

    <p
      v-if="preview"
      class="mt-1 pl-6 line-clamp-2 whitespace-pre-wrap break-words text-xs"
      :class="delegation?.errorPreview ? 'text-destructive' : 'text-muted-foreground'"
    >
      {{ preview }}
    </p>
    <p v-if="actionError" class="mt-1 pl-6 break-words text-xs text-destructive">
      {{ actionError }}
    </p>
  </article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
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
  permissionStatus?: 'granted' | 'denied'
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
const statusTextClass = computed(() => {
  if (status.value === 'failed' || status.value === 'tool_error') return 'text-destructive'
  if (statusPresentation.value.actionRequired) return 'text-amber-700 dark:text-amber-400'
  return 'text-muted-foreground'
})

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
