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
      <Button
        variant="ghost"
        size="icon"
        class="h-6 w-6"
        :aria-label="t('common.retry')"
        :disabled="loading"
        @click="refresh"
      >
        <Icon icon="lucide:refresh-cw" class="h-3 w-3" :class="loading && 'animate-spin'" />
      </Button>
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
            <p class="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
              {{ delegation.slotId }} · {{ delegation.id }}
            </p>
            <p
              v-if="delegation.errorPreview || delegation.summaryPreview"
              class="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[10px]"
              :class="delegation.errorPreview ? 'text-destructive' : 'text-muted-foreground'"
            >
              {{ delegation.errorPreview || delegation.summaryPreview }}
            </p>
            <div class="mt-1.5 flex flex-wrap gap-1">
              <Button
                v-if="delegation.childSessionId"
                variant="ghost"
                size="sm"
                class="h-6 px-2 text-[10px]"
                :data-testid="`live-delegation-open-${delegation.id}`"
                @click="openChild(delegation.childSessionId)"
              >
                <Icon icon="lucide:external-link" class="mr-1 h-3 w-3" />
                {{ t('chat.workflow.actions.openChild') }}
              </Button>
              <Button
                v-if="isActive(delegation.status)"
                variant="ghost"
                size="sm"
                class="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
                :data-testid="`live-delegation-interrupt-${delegation.id}`"
                :disabled="interruptingId !== null"
                @click="interrupt(delegation.id)"
              >
                <Icon icon="lucide:square" class="mr-1 h-3 w-3" />
                {{ t('common.cancel') }}
              </Button>
            </div>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { createOrchestrationClient } from '@api/OrchestrationClient'
import type {
  LiveDelegationStatus,
  LiveDelegationSummary
} from '@shared/orchestration/liveDelegation'
import { useSessionStore } from '@/stores/ui/session'

const props = defineProps<{ sessionId: string }>()
const emit = defineEmits<{ countChanged: [count: number] }>()
const { t } = useI18n()
const orchestrationClient = createOrchestrationClient()
const sessionStore = useSessionStore()
const delegations = shallowRef<LiveDelegationSummary[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const interruptingId = ref<string | null>(null)
const MAX_VISIBLE_DELEGATIONS = 100

let disposed = false
let requestId = 0
let interruptRequestId = 0
let stopChanged: (() => void) | null = null

function sortDelegations(items: readonly LiveDelegationSummary[]): LiveDelegationSummary[] {
  return [...items].sort(
    (left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id)
  )
}

function replaceDelegations(items: readonly LiveDelegationSummary[]): void {
  delegations.value = sortDelegations(items).slice(0, MAX_VISIBLE_DELEGATIONS)
  emit('countChanged', delegations.value.length)
}

function mergeRefreshedDelegations(items: readonly LiveDelegationSummary[]): void {
  const merged = new Map(items.map((delegation) => [delegation.id, delegation]))
  for (const current of delegations.value) {
    const loaded = merged.get(current.id)
    if (!loaded || current.revision >= loaded.revision) merged.set(current.id, current)
  }
  replaceDelegations([...merged.values()])
}

function upsertDelegation(delegation: LiveDelegationSummary): void {
  const current = delegations.value.find((candidate) => candidate.id === delegation.id)
  if (current && current.revision > delegation.revision) return
  replaceDelegations([
    delegation,
    ...delegations.value.filter((candidate) => candidate.id !== delegation.id)
  ])
}

async function refresh(): Promise<void> {
  const currentRequest = ++requestId
  const sessionId = props.sessionId
  loading.value = true
  loadError.value = null
  try {
    const loaded = await orchestrationClient.listLiveDelegations(sessionId, 100)
    if (disposed || currentRequest !== requestId || sessionId !== props.sessionId) return
    mergeRefreshedDelegations(loaded)
  } catch (error) {
    if (!disposed && currentRequest === requestId && sessionId === props.sessionId) {
      console.warn('[LiveDelegationPanel] Failed to list delegations:', error)
      loadError.value = t('common.error.requestFailed')
    }
  } finally {
    if (!disposed && currentRequest === requestId && sessionId === props.sessionId) {
      loading.value = false
    }
  }
}

async function interrupt(delegationId: string): Promise<void> {
  if (interruptingId.value) return
  const currentRequest = ++interruptRequestId
  const sessionId = props.sessionId
  interruptingId.value = delegationId
  loadError.value = null
  try {
    const detail = await orchestrationClient.interruptLiveDelegation(sessionId, delegationId)
    if (!disposed && currentRequest === interruptRequestId && sessionId === props.sessionId) {
      upsertDelegation(detail.delegation)
    }
  } catch (error) {
    if (!disposed && currentRequest === interruptRequestId && sessionId === props.sessionId) {
      console.warn('[LiveDelegationPanel] Failed to interrupt delegation:', error)
      loadError.value = t('common.error.operationFailed')
    }
  } finally {
    if (currentRequest === interruptRequestId) interruptingId.value = null
  }
}

function openChild(childSessionId: string): void {
  void sessionStore.selectSession(childSessionId)
}

function isActive(status: LiveDelegationStatus): boolean {
  return (
    status === 'queued' ||
    status === 'running' ||
    status === 'waiting_permission' ||
    status === 'waiting_question'
  )
}

function statusLabel(status: LiveDelegationStatus): string {
  if (status === 'idle') return t('chat.workspace.subagents.status.idle')
  if (status === 'failed') return t('chat.workspace.subagents.status.error')
  if (status === 'interrupted') return t('chat.workflow.status.interrupted')
  if (status === 'queued') return t('chat.workflow.status.queued')
  if (status.startsWith('waiting_')) return t('chat.workflow.status.waiting_interaction')
  return t('chat.workspace.subagents.status.working')
}

function statusDotClass(status: LiveDelegationStatus): string {
  if (status === 'idle') return 'bg-emerald-500'
  if (status === 'failed') return 'bg-destructive'
  if (status === 'interrupted' || status.startsWith('waiting_')) return 'bg-amber-500'
  return 'bg-blue-500'
}

watch(
  () => props.sessionId,
  () => {
    requestId += 1
    interruptRequestId += 1
    interruptingId.value = null
    replaceDelegations([])
    void refresh()
  }
)

onMounted(() => {
  stopChanged = orchestrationClient.onLiveDelegationChanged((payload) => {
    if (payload.parentSessionId === props.sessionId) upsertDelegation(payload.delegation)
  })
  void refresh()
})

onBeforeUnmount(() => {
  disposed = true
  requestId += 1
  stopChanged?.()
  stopChanged = null
})
</script>
