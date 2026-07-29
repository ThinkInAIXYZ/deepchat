<template>
  <Dialog :open="memoryActivity.isTurnPanelOpen" @update:open="onOpenChange">
    <DialogContent class="max-h-[80vh] overflow-hidden p-0 sm:max-w-xl">
      <DialogHeader class="border-b px-5 pb-3 pt-5">
        <DialogTitle class="text-base">{{ t('chat.memory.turn.title') }}</DialogTitle>
      </DialogHeader>

      <div class="dc-overscroll-contain max-h-[60vh] overflow-y-auto px-5 py-4">
        <div
          v-if="turn?.status === 'loading'"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          {{ t('common.loading') }}
        </div>
        <div
          v-else-if="!turn || turn.status === 'idle'"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          {{ t('chat.memory.turn.empty') }}
        </div>
        <div
          v-else-if="turn.status === 'error'"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          {{ t('chat.memory.turn.error') }}
        </div>
        <div v-else-if="!turn.manifest" class="py-8 text-center text-sm text-muted-foreground">
          {{ t('chat.memory.turn.empty') }}
        </div>
        <div v-else class="space-y-4">
          <div
            v-if="turn.stale && turn.error"
            class="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300"
          >
            <Icon icon="lucide:triangle-alert" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{{ t('chat.memory.turn.refreshFailed') }}</span>
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div class="rounded-md border p-2">
              <p class="text-muted-foreground">{{ t('chat.memory.turn.selected') }}</p>
              <p class="mt-1 text-sm font-medium">{{ turn.manifest.selectedCount }}</p>
            </div>
            <div class="rounded-md border p-2">
              <p class="text-muted-foreground">{{ t('chat.memory.turn.dropped') }}</p>
              <p class="mt-1 text-sm font-medium">{{ turn.manifest.droppedCount }}</p>
            </div>
            <div class="rounded-md border p-2">
              <p class="text-muted-foreground">{{ t('chat.memory.turn.tokens') }}</p>
              <p class="mt-1 text-sm font-medium">{{ turn.manifest.estimatedTokens }}</p>
            </div>
            <div class="rounded-md border p-2">
              <p class="text-muted-foreground">{{ t('chat.memory.turn.budget') }}</p>
              <p class="mt-1 text-sm font-medium">{{ turn.manifest.tokenBudget }}</p>
            </div>
          </div>

          <div
            v-if="allocation"
            data-testid="memory-budget-allocation"
            class="rounded-md border p-3"
          >
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs font-medium">{{ t('chat.memory.turn.allocation') }}</p>
              <p class="text-xs tabular-nums text-muted-foreground">
                {{ allocation.estimatedTotalTokens }} / {{ allocation.totalTokenBudget }}
              </p>
            </div>
            <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
              <div>
                <p class="text-muted-foreground">{{ t('chat.memory.turn.directive') }}</p>
                <p class="mt-0.5 font-medium tabular-nums">
                  {{ allocation.used.directive }} / {{ allocation.allocated.directive }}
                </p>
              </div>
              <div>
                <p class="text-muted-foreground">{{ t('chat.memory.turn.persona') }}</p>
                <p class="mt-0.5 font-medium tabular-nums">
                  {{ allocation.used.persona }} / {{ allocation.allocated.persona }}
                </p>
              </div>
              <div>
                <p class="text-muted-foreground">{{ t('chat.memory.turn.working') }}</p>
                <p class="mt-0.5 font-medium tabular-nums">
                  {{ allocation.used.working }} / {{ allocation.allocated.working }}
                </p>
              </div>
              <div>
                <p class="text-muted-foreground">{{ t('chat.memory.turn.queryRecall') }}</p>
                <p class="mt-0.5 font-medium tabular-nums">
                  {{ allocation.used.queryRecall }} / {{ allocation.allocated.queryRecall }}
                </p>
              </div>
            </div>
            <p class="mt-2 text-[11px] text-muted-foreground">
              {{
                t('chat.memory.turn.overheadSummary', {
                  overhead: allocation.overheadTokens,
                  unused: allocation.unusedTokens
                })
              }}
            </p>
          </div>

          <div
            v-if="turn.manifest.selectedIds === null"
            class="rounded-md border p-3 text-sm text-muted-foreground"
          >
            {{ t('chat.memory.turn.countOnly') }}
          </div>

          <div v-else-if="turn.details.length > 0" class="space-y-2">
            <div
              v-for="detail in turn.details"
              :key="detail.id"
              class="rounded-md border border-border/70 p-3"
            >
              <template v-if="detail.memory">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <p class="line-clamp-4 text-sm leading-5">{{ detail.memory.content }}</p>
                    <div class="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge variant="outline" class="text-[10px]">{{ detail.memory.kind }}</Badge>
                      <Badge v-if="detail.memory.category" variant="secondary" class="text-[10px]">
                        {{ detail.memory.category }}
                      </Badge>
                      <Badge
                        v-if="detail.memory.status === 'archived'"
                        variant="secondary"
                        class="text-[10px]"
                      >
                        {{ t('chat.memory.status.archived') }}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7"
                    :disabled="
                      mutationDisabled ||
                      detail.memory.status === 'archived' ||
                      isForgetting(detail.id)
                    "
                    :aria-label="t('chat.memory.actions.forget')"
                    @click="handleForget(detail.id)"
                  >
                    <Icon icon="lucide:archive" class="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p
                  v-if="forgetErrors[detail.id]"
                  role="alert"
                  class="mt-2 text-xs text-destructive"
                >
                  {{ forgetErrors[detail.id] }}
                </p>
              </template>
              <p v-else class="text-sm text-muted-foreground">
                {{ t('chat.memory.turn.unavailable') }}
              </p>
            </div>
          </div>
          <div v-else class="rounded-md border p-3 text-sm text-muted-foreground">
            {{ t('chat.memory.turn.noSelectedDetails') }}
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shadcn/components/ui/dialog'
import { useMemoryActivityStore } from '@/stores/ui/memoryActivity'

const props = defineProps<{
  readOnly?: boolean
}>()
const memoryActivity = useMemoryActivityStore()
const { t } = useI18n()
const turn = computed(() => memoryActivity.selectedTurn)
const allocation = computed(() => turn.value?.manifest?.allocation ?? null)
const mutationDisabled = computed(() => props.readOnly === true || memoryActivity.readOnly)
const forgettingIds = ref(new Set<string>())
const forgetErrors = ref<Record<string, string>>({})

watch(
  () => turn.value?.messageId,
  () => {
    forgetErrors.value = {}
  }
)

function onOpenChange(open: boolean): void {
  if (!open) {
    forgetErrors.value = {}
    memoryActivity.closeTurnPanel()
  }
}

function isForgetting(memoryId: string): boolean {
  return forgettingIds.value.has(memoryId)
}

function setForgetting(memoryId: string, forgetting: boolean): void {
  const next = new Set(forgettingIds.value)
  if (forgetting) next.add(memoryId)
  else next.delete(memoryId)
  forgettingIds.value = next
}

async function handleForget(memoryId: string): Promise<void> {
  if (mutationDisabled.value || isForgetting(memoryId)) return
  const turnMessageId = turn.value?.messageId
  setForgetting(memoryId, true)
  const remainingErrors = { ...forgetErrors.value }
  delete remainingErrors[memoryId]
  forgetErrors.value = remainingErrors
  try {
    const ok = await memoryActivity.forget(memoryId)
    if (!ok && turn.value?.messageId === turnMessageId) {
      forgetErrors.value = {
        ...forgetErrors.value,
        [memoryId]: t('chat.memory.toast.forgetFailed')
      }
    }
  } finally {
    setForgetting(memoryId, false)
  }
}
</script>
