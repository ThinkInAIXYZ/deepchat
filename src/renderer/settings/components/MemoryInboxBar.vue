<template>
  <section v-if="visible" class="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <Icon icon="lucide:inbox" class="h-4 w-4 text-amber-600" />
          <h2 class="text-sm font-semibold">{{ t('settings.memory.redesign.inboxTitle') }}</h2>
          <Badge v-if="conflictCount > 0" variant="destructive" class="text-[10px]">
            {{ t('settings.memory.redesign.conflictBadge', { count: conflictCount }) }}
          </Badge>
          <Badge v-if="draftCount > 0" variant="secondary" class="text-[10px]">
            {{ t('settings.memory.redesign.personaDraftBadge', { count: draftCount }) }}
          </Badge>
        </div>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ t('settings.memory.redesign.inboxDescription') }}
        </p>
      </div>
      <Button variant="ghost" size="sm" class="h-8 text-xs" :disabled="loading" @click="load">
        <Icon icon="lucide:refresh-cw" class="mr-1.5 h-3.5 w-3.5" />
        {{ t('settings.memory.redesign.refresh') }}
      </Button>
    </div>

    <div v-if="loading" class="mt-3 py-4 text-center text-xs text-muted-foreground">
      {{ t('common.loading') }}
    </div>

    <div v-else class="mt-3 space-y-3">
      <section v-if="conflicts.length > 0" class="space-y-2">
        <div class="text-xs font-medium">
          {{ t('settings.memory.redesign.conflictSectionTitle', { count: conflicts.length }) }}
        </div>
        <article
          v-for="conflict in conflicts"
          :key="conflict.challenger.id"
          class="rounded-lg border border-border bg-background p-3"
        >
          <div class="grid gap-2 md:grid-cols-2">
            <div class="rounded-md bg-muted/60 p-2">
              <div class="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                {{ t('settings.memory.redesign.conflictExisting') }}
              </div>
              <p class="wrap-break-word text-xs">{{ conflict.target.content }}</p>
            </div>
            <div class="rounded-md bg-muted/60 p-2">
              <div class="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                {{ t('settings.memory.redesign.conflictNew') }}
              </div>
              <p class="wrap-break-word text-xs">{{ conflict.challenger.content }}</p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              @click="resolveConflict(conflict.challenger.id, 'keep_target')"
            >
              {{ t('settings.deepchatAgents.memoryManager.keepTarget') }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              @click="resolveConflict(conflict.challenger.id, 'keep_challenger')"
            >
              {{ t('settings.deepchatAgents.memoryManager.keepChallenger') }}
            </Button>
            <Button
              size="sm"
              class="h-8 text-xs"
              @click="resolveConflict(conflict.challenger.id, 'keep_both')"
            >
              {{ t('settings.deepchatAgents.memoryManager.keepBoth') }}
            </Button>
          </div>
        </article>
      </section>

      <section v-if="drafts.length > 0" class="space-y-2">
        <div class="text-xs font-medium">
          {{ t('settings.memory.redesign.personaDraftSectionTitle', { count: drafts.length }) }}
        </div>
        <article
          v-for="draft in drafts"
          :key="draft.id"
          class="rounded-lg border bg-background p-3"
          :class="draft.needsReview ? 'border-destructive/50' : 'border-border'"
        >
          <div
            v-if="draft.needsReview"
            class="mb-2 flex items-center gap-1.5 text-xs font-medium text-destructive"
          >
            <Icon icon="lucide:triangle-alert" class="h-3.5 w-3.5" />
            {{ t('settings.deepchatAgents.memoryManager.largeChange') }}
          </div>
          <div class="grid gap-2 md:grid-cols-2">
            <div>
              <div class="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                {{ t('settings.deepchatAgents.memoryManager.personaCurrent') }}
              </div>
              <p class="whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground">
                {{ activePersonaContent || t('settings.deepchatAgents.memoryManager.personaNone') }}
              </p>
            </div>
            <div>
              <div class="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                {{ t('settings.deepchatAgents.memoryManager.personaProposed') }}
              </div>
              <p class="whitespace-pre-wrap wrap-break-word text-xs">{{ draft.content }}</p>
            </div>
          </div>
          <div class="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" class="h-8 text-xs" @click="rejectDraft(draft.id)">
              {{ t('settings.deepchatAgents.memoryManager.reject') }}
            </Button>
            <Button size="sm" class="h-8 text-xs" @click="approveDraft(draft.id)">
              {{ t('settings.deepchatAgents.memoryManager.approve') }}
            </Button>
          </div>
        </article>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { useToast } from '@/components/use-toast'
import { createMemoryClient } from '@api/MemoryClient'
import type { MemoryConflictItem, MemoryItem } from '@shared/contracts/routes'
import { notifyMemoryActionFailed } from './memoryRedesignUtils'

const props = defineProps<{
  agentId: string
  conflictCount: number
  draftCount: number
  refreshToken: number
}>()

const { t } = useI18n()
const { toast } = useToast()
const memoryClient = createMemoryClient()

const loading = ref(false)
const conflicts = ref<MemoryConflictItem[]>([])
const drafts = ref<MemoryItem[]>([])
const versions = ref<MemoryItem[]>([])
let requestId = 0

const visible = computed(
  () =>
    props.conflictCount > 0 ||
    props.draftCount > 0 ||
    conflicts.value.length > 0 ||
    drafts.value.length > 0
)

const activePersonaContent = computed<string | null>(() => {
  const active = versions.value.find(
    (version) =>
      version.personaState === 'active' ||
      (version.personaState == null && version.supersededBy === null)
  )
  return active?.content ?? null
})

function notifyFailed(error?: unknown): void {
  notifyMemoryActionFailed(toast, t, error)
}

async function load(): Promise<void> {
  const agentId = props.agentId
  if (!agentId || !visible.value) return
  const current = ++requestId
  loading.value = true
  try {
    const [nextConflicts, nextDrafts, nextVersions] = await Promise.all([
      memoryClient.listConflicts(agentId),
      memoryClient.listPersonaDrafts(agentId),
      memoryClient.listPersonaVersions(agentId)
    ])
    if (current !== requestId || props.agentId !== agentId) return
    conflicts.value = nextConflicts
    drafts.value = nextDrafts
    versions.value = nextVersions
  } catch (error) {
    if (current !== requestId || props.agentId !== agentId) return
    notifyFailed(error)
  } finally {
    if (current === requestId && props.agentId === agentId) loading.value = false
  }
}

async function resolveConflict(
  challengerId: string,
  outcome: 'keep_target' | 'keep_challenger' | 'keep_both'
): Promise<void> {
  try {
    // Main broadcasts memory.updated for this mutation, which bumps
    // refreshToken and reloads this panel; no need to also reload locally.
    await memoryClient.resolveConflict(props.agentId, challengerId, outcome)
  } catch (error) {
    notifyFailed(error)
  }
}

async function approveDraft(draftId: string): Promise<void> {
  try {
    await memoryClient.approvePersonaDraft(props.agentId, draftId)
  } catch (error) {
    notifyFailed(error)
  }
}

async function rejectDraft(draftId: string): Promise<void> {
  try {
    await memoryClient.rejectPersonaDraft(props.agentId, draftId)
  } catch (error) {
    notifyFailed(error)
  }
}

watch(
  () => [props.agentId, props.refreshToken],
  () => void load(),
  { immediate: true }
)
</script>
