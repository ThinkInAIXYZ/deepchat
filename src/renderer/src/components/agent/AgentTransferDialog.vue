<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      class="flex w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden p-0"
      style="max-height: min(720px, calc(100vh - 2rem))"
    >
      <DialogHeader class="border-b px-5 pb-4 pt-5">
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div
          v-if="error"
          class="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {{ error }}
        </div>

        <div
          v-if="loading"
          class="flex min-h-40 items-center justify-center text-sm text-muted-foreground"
        >
          {{ t('dialog.agentTransfer.loading') }}
        </div>

        <div v-else class="space-y-4">
          <div v-if="mode === 'delete-agent'" class="rounded-lg border bg-muted/30 p-3">
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div class="space-y-1">
                <div class="text-xs text-muted-foreground">
                  {{ t('dialog.agentTransfer.totalSessions') }}
                </div>
                <div class="text-lg font-semibold">{{ impact?.totalSessions ?? 0 }}</div>
              </div>
              <div class="space-y-1">
                <div class="text-xs text-muted-foreground">
                  {{ t('dialog.agentTransfer.movableSessions') }}
                </div>
                <div class="text-lg font-semibold">{{ impact?.movableSessions ?? 0 }}</div>
              </div>
              <div class="space-y-1">
                <div class="text-xs text-muted-foreground">
                  {{ t('dialog.agentTransfer.emptyDrafts') }}
                </div>
                <div class="text-lg font-semibold">{{ impact?.emptyDrafts ?? 0 }}</div>
              </div>
              <div class="space-y-1">
                <div class="text-xs text-muted-foreground">
                  {{ t('dialog.agentTransfer.blockedSessions') }}
                </div>
                <div class="text-lg font-semibold">{{ impact?.blockedSessions ?? 0 }}</div>
              </div>
            </div>
          </div>

          <div v-if="mode === 'delete-agent'" class="space-y-2">
            <label
              class="flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40"
            >
              <input v-model="action" class="mt-1" type="radio" value="move" />
              <span class="space-y-1">
                <span class="block text-sm font-medium">
                  {{ t('dialog.agentTransfer.moveBeforeDeleteTitle') }}
                </span>
                <span class="block text-sm text-muted-foreground">
                  {{ t('dialog.agentTransfer.moveBeforeDeleteDescription') }}
                </span>
              </span>
            </label>
            <label
              class="flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40"
            >
              <input v-model="action" class="mt-1" type="radio" value="delete" />
              <span class="space-y-1">
                <span class="block text-sm font-medium">
                  {{ t('dialog.agentTransfer.deleteSessionsTitle') }}
                </span>
                <span class="block text-sm text-muted-foreground">
                  {{ t('dialog.agentTransfer.deleteSessionsDescription') }}
                </span>
              </span>
            </label>
          </div>

          <div v-if="showTargetPicker" class="space-y-2">
            <label class="text-sm font-medium" for="agent-transfer-target">
              {{ t('dialog.agentTransfer.targetAgent') }}
            </label>
            <select
              id="agent-transfer-target"
              v-model="selectedTargetAgentId"
              class="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="" disabled>{{ t('dialog.agentTransfer.selectTarget') }}</option>
              <option v-for="agent in availableTargets" :key="agent.id" :value="agent.id">
                {{ agent.name }} · {{ t(`dialog.agentTransfer.agentType.${agent.type}`) }}
              </option>
            </select>
            <p class="text-xs text-muted-foreground">
              {{ t('dialog.agentTransfer.deepChatTargetOnly') }}
            </p>
          </div>

          <div v-if="mode === 'move-session'" class="rounded-lg border bg-muted/30 p-3 text-sm">
            <div class="font-medium">{{ sessionTitle }}</div>
            <div class="mt-1 text-muted-foreground">
              {{ t('dialog.agentTransfer.currentAgent', { name: sourceAgentName }) }}
            </div>
          </div>

          <div v-if="impact?.samples.length" class="space-y-2">
            <div class="text-sm font-medium">{{ t('dialog.agentTransfer.relatedSessions') }}</div>
            <div class="space-y-2">
              <div
                v-for="sample in impact.samples"
                :key="sample.id"
                class="rounded-md border p-3 text-sm"
              >
                <div class="flex min-w-0 items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="truncate font-medium">{{ sample.title }}</div>
                    <div class="mt-1 text-xs text-muted-foreground">
                      {{ sample.projectDir || t('common.project.none') }}
                    </div>
                  </div>
                  <span
                    class="shrink-0 rounded border px-2 py-0.5 text-xs"
                    :class="
                      sample.blockReason
                        ? 'border-destructive/30 text-destructive'
                        : 'text-muted-foreground'
                    "
                  >
                    {{ getSampleStateLabel(sample) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <p v-if="impact?.blockedSessions" class="text-sm text-destructive">
            {{ t('dialog.agentTransfer.blockedWarning') }}
          </p>
        </div>
      </div>

      <DialogFooter class="border-t px-5 py-4">
        <Button variant="outline" :disabled="busy" @click="emit('update:open', false)">
          {{ t('dialog.cancel') }}
        </Button>
        <Button :variant="confirmVariant" :disabled="!canConfirm" @click="handleConfirm">
          {{ confirmLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import type { AgentTransferImpact, AgentTransferImpactSample } from '@shared/types/agent-interface'

export type TransferDialogAgent = {
  id: string
  name: string
  type: 'deepchat' | 'acp'
  enabled?: boolean
}

const props = withDefaults(
  defineProps<{
    open: boolean
    mode: 'delete-agent' | 'move-session'
    sourceAgentId: string
    sourceAgentName: string
    agents: TransferDialogAgent[]
    impact?: AgentTransferImpact | null
    sessionTitle?: string
    loading?: boolean
    busy?: boolean
    error?: string | null
  }>(),
  {
    impact: null,
    sessionTitle: '',
    loading: false,
    busy: false,
    error: null
  }
)

const emit = defineEmits<{
  (event: 'update:open', open: boolean): void
  (event: 'confirmMove', payload: { targetAgentId: string }): void
  (event: 'confirmDelete'): void
}>()

const { t } = useI18n()
const action = ref<'move' | 'delete'>('move')
const selectedTargetAgentId = ref('')

const availableTargets = computed(() =>
  props.agents.filter(
    (agent) =>
      agent.enabled !== false && agent.id !== props.sourceAgentId && agent.type === 'deepchat'
  )
)
const showTargetPicker = computed(() => props.mode === 'move-session' || action.value === 'move')
const title = computed(() =>
  props.mode === 'delete-agent'
    ? t('dialog.agentTransfer.deleteTitle', { name: props.sourceAgentName })
    : t('dialog.agentTransfer.moveTitle')
)
const description = computed(() =>
  props.mode === 'delete-agent'
    ? t('dialog.agentTransfer.deleteDescription')
    : t('dialog.agentTransfer.moveDescription')
)
const confirmVariant = computed(() => (action.value === 'delete' ? 'destructive' : 'default'))
const confirmLabel = computed(() => {
  if (props.busy) {
    return t('dialog.agentTransfer.processing')
  }
  if (props.mode === 'delete-agent' && action.value === 'delete') {
    return t('dialog.agentTransfer.deleteAgentAndSessions')
  }
  if (props.mode === 'delete-agent') {
    return t('dialog.agentTransfer.moveAndDeleteAgent')
  }
  return t('dialog.agentTransfer.moveConversation')
})
const canConfirm = computed(() => {
  if (props.busy || props.loading) {
    return false
  }
  if (props.error) {
    return false
  }
  if (props.impact?.blockedSessions) {
    return false
  }
  if (!showTargetPicker.value) {
    return true
  }
  return Boolean(selectedTargetAgentId.value)
})

watch(
  () =>
    [
      props.open,
      props.sourceAgentId,
      props.mode,
      props.agents.length,
      props.impact?.totalSessions
    ] as const,
  ([open]) => {
    if (!open) {
      return
    }
    action.value =
      props.mode === 'delete-agent' && props.impact?.totalSessions === 0 ? 'delete' : 'move'
    selectedTargetAgentId.value = availableTargets.value[0]?.id ?? ''
  },
  { immediate: true }
)

const handleConfirm = () => {
  if (!canConfirm.value) {
    return
  }
  if (props.mode === 'delete-agent' && action.value === 'delete') {
    emit('confirmDelete')
    return
  }
  emit('confirmMove', {
    targetAgentId: selectedTargetAgentId.value
  })
}

const getSampleStateLabel = (sample: AgentTransferImpactSample): string => {
  if (sample.blockReason) {
    return t(`dialog.agentTransfer.blockReason.${sample.blockReason}`)
  }
  if (sample.isDraft) {
    return t('dialog.agentTransfer.sampleState.draft')
  }
  if (sample.sessionKind === 'subagent') {
    return t('dialog.agentTransfer.sampleState.subagent')
  }
  return t('dialog.agentTransfer.sampleState.ready')
}
</script>
