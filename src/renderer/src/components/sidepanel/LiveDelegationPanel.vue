<template>
  <section
    v-if="loading || loadError || delegations.length > 0"
    class="space-y-2 rounded-lg border bg-muted/10 p-2.5"
    data-testid="live-delegation-panel"
  >
    <div class="flex items-center gap-2">
      <Icon icon="lucide:users" class="h-3.5 w-3.5 text-muted-foreground" />
      <p class="flex-1 text-[11px] font-semibold">{{ t('chat.workspace.sections.subagents') }}</p>
      <span v-if="delegations.length > 0" class="text-[10px] text-muted-foreground">
        {{ delegations.length }}
      </span>
      <DcButton
        variant="ghost"
        size="icon"
        class="h-6 w-6"
        :aria-label="t('common.retry')"
        :disabled="loading"
        @click="refresh"
        :tooltip="t('common.retry')"
      >
        <Icon icon="lucide:refresh-cw" class="h-3 w-3" :class="loading && 'animate-spin'" />
      </DcButton>
    </div>

    <p v-if="loadError" class="break-words text-[11px] text-destructive">
      {{ loadError }}
    </p>

    <div v-if="delegations.length > 0" class="space-y-1.5">
      <article
        v-for="delegation in delegations"
        :key="delegation.id"
        class="rounded-md border bg-background px-2.5 py-2"
        :data-testid="`live-delegation-${delegation.id}`"
      >
        <div class="flex items-start gap-2">
          <span
            class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
            :class="statusDotClass(delegation.status)"
          ></span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <p class="min-w-0 flex-1 truncate text-[11px] font-medium">
                {{ delegation.title }}
              </p>
              <span class="text-[9px] text-muted-foreground">
                {{ statusLabel(delegation.status) }}
              </span>
            </div>
            <p class="mt-0.5 truncate text-[9px] text-muted-foreground">
              {{ delegation.slotId }}
            </p>
            <p
              v-if="delegation.errorPreview || delegation.summaryPreview"
              class="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[10px]"
              :class="delegation.errorPreview ? 'text-destructive' : 'text-muted-foreground'"
            >
              {{ delegation.errorPreview || delegation.summaryPreview }}
            </p>
            <div class="mt-1.5 flex flex-wrap gap-1">
              <DcButton
                v-if="delegation.childSessionId"
                :variant="requiresInteraction(delegation.status) ? 'default' : 'ghost'"
                size="sm"
                class="h-6 px-2 text-[10px]"
                :data-testid="`live-delegation-open-${delegation.id}`"
                :data-action-required="requiresInteraction(delegation.status) ? 'true' : undefined"
                :disabled="openingId === delegation.id"
                @click="openChild(delegation)"
              >
                <Icon icon="lucide:external-link" class="mr-1 h-3 w-3" />
                {{ t('chat.orchestration.actions.openChild') }}
              </DcButton>
              <DcButton
                v-if="isActive(delegation.status)"
                variant="ghost"
                size="sm"
                class="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
                :data-testid="`live-delegation-interrupt-${delegation.id}`"
                :disabled="liveDelegationStore.isInterrupting(props.sessionId, delegation.id)"
                @click="interrupt(delegation.id)"
              >
                <Icon icon="lucide:square" class="mr-1 h-3 w-3" />
                {{ t('common.cancel') }}
              </DcButton>
            </div>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import type {
  LiveDelegationStatus,
  LiveDelegationSummary
} from '@shared/orchestration/liveDelegation'
import { getLiveDelegationStatusPresentation } from '@/lib/liveDelegationPresentation'
import { useLiveDelegationStore } from '@/stores/ui/liveDelegation'
import { useSessionStore } from '@/stores/ui/session'

const props = defineProps<{ sessionId: string }>()
const emit = defineEmits<{ countChanged: [count: number] }>()
const { t } = useI18n()
const sessionStore = useSessionStore()
const liveDelegationStore = useLiveDelegationStore()
const actionError = ref<string | null>(null)
const openingId = ref<string | null>(null)
const MAX_VISIBLE_DELEGATIONS = 100

const delegations = computed<LiveDelegationSummary[]>(() =>
  liveDelegationStore.listAuthoritative(props.sessionId).slice(0, MAX_VISIBLE_DELEGATIONS)
)
const loadState = computed(() => liveDelegationStore.getLoadState(props.sessionId))
const loading = computed(() => loadState.value.loading)
const loadError = computed(
  () => actionError.value || (loadState.value.loadFailed ? t('common.error.requestFailed') : null)
)

async function refresh(): Promise<void> {
  actionError.value = null
  await liveDelegationStore.refresh(props.sessionId)
}

async function interrupt(delegationId: string): Promise<void> {
  const sessionId = props.sessionId
  if (liveDelegationStore.isInterrupting(sessionId, delegationId)) return
  actionError.value = null
  try {
    const delegation = liveDelegationStore.getDelegation(sessionId, delegationId)
    if (!delegation) throw new Error('The delegation is no longer available.')
    await liveDelegationStore.interrupt(sessionId, delegationId, {
      slotId: delegation.slotId,
      title: delegation.title
    })
  } catch (error) {
    if (sessionId === props.sessionId) {
      console.warn('[LiveDelegationPanel] Failed to interrupt delegation:', error)
      actionError.value = t('common.error.operationFailed')
    }
  }
}

async function openChild(delegation: LiveDelegationSummary): Promise<void> {
  if (openingId.value) return
  const sessionId = props.sessionId
  openingId.value = delegation.id
  actionError.value = null
  try {
    const confirmed = await liveDelegationStore.confirm(sessionId, delegation.id)
    if (confirmed.slotId !== delegation.slotId || confirmed.title !== delegation.title) {
      throw new Error('The delegation no longer matches the displayed task.')
    }
    if (!confirmed.childSessionId) throw new Error('The child Session is not available yet.')
    if (sessionId === props.sessionId) await sessionStore.selectSession(confirmed.childSessionId)
  } catch (error) {
    if (sessionId === props.sessionId) {
      console.warn('[LiveDelegationPanel] Failed to open child Session:', error)
      actionError.value = t('common.error.operationFailed')
    }
  } finally {
    if (openingId.value === delegation.id) openingId.value = null
  }
}

function isActive(status: LiveDelegationStatus): boolean {
  return getLiveDelegationStatusPresentation(status).active
}

function requiresInteraction(status: LiveDelegationStatus): boolean {
  return getLiveDelegationStatusPresentation(status).actionRequired
}

function statusLabel(status: LiveDelegationStatus): string {
  return t(getLiveDelegationStatusPresentation(status).labelKey)
}

function statusDotClass(status: LiveDelegationStatus): string {
  return getLiveDelegationStatusPresentation(status).dotClass
}

watch(
  () => props.sessionId,
  () => {
    actionError.value = null
    openingId.value = null
    // Reconcile with the durable repository whenever the activity surface is mounted or switches
    // Session. IPC events are an optimization, not the sole terminal-state delivery path.
    void liveDelegationStore.ensureLoaded(props.sessionId, { revalidate: true })
  },
  { immediate: true }
)

watch(delegations, (items) => emit('countChanged', items.length), { immediate: true })
</script>
