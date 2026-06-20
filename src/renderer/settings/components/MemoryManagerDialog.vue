<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent class="sm:max-w-[680px]">
      <DialogHeader class="text-left">
        <DialogTitle>{{ t('settings.deepchatAgents.memoryManager.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.deepchatAgents.memoryManager.description') }}
        </DialogDescription>
      </DialogHeader>

      <div
        v-if="status && status.total > 0 && !hasEmbeddingConfigured"
        class="rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground"
      >
        {{ t('settings.deepchatAgents.memoryManager.degradedHint') }}
      </div>

      <Tabs v-model="activeTab" class="w-full">
        <TabsList class="grid w-full grid-cols-2">
          <TabsTrigger value="memories">
            {{ t('settings.deepchatAgents.memoryManager.tabMemories') }}
            <Badge v-if="status" variant="secondary" class="ml-1.5">{{ status.total }}</Badge>
          </TabsTrigger>
          <TabsTrigger value="persona">
            {{ t('settings.deepchatAgents.memoryManager.tabPersona') }}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="memories" class="mt-3">
          <div class="mb-2 flex items-center justify-between">
            <div class="text-xs text-muted-foreground">
              {{
                t('settings.deepchatAgents.memoryManager.memoriesCount', { count: memories.length })
              }}
            </div>
            <AlertDialog v-if="memories.length > 0">
              <AlertDialogTrigger as-child>
                <Button variant="ghost" size="sm" class="h-7 px-2 text-xs text-destructive">
                  <Icon icon="lucide:trash-2" class="mr-1 h-3.5 w-3.5" />
                  {{ t('settings.deepchatAgents.memoryManager.clearAll') }}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {{ t('settings.deepchatAgents.memoryManager.clearConfirmTitle') }}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {{ t('settings.deepchatAgents.memoryManager.clearConfirmBody') }}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
                  <AlertDialogAction
                    class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    @click="handleClear"
                  >
                    {{ t('settings.deepchatAgents.memoryManager.clearAll') }}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <div v-if="conflicts.length > 0" class="mb-3 space-y-2">
            <div class="text-xs font-medium">
              {{
                t('settings.deepchatAgents.memoryManager.conflictPairsTitle', {
                  count: conflicts.length
                })
              }}
            </div>
            <div
              v-for="conflict in conflicts"
              :key="conflict.challenger.id"
              class="space-y-2 rounded-lg border border-destructive/40 px-3 py-2"
            >
              <div class="grid gap-2 sm:grid-cols-2">
                <p class="wrap-break-word text-xs text-muted-foreground">
                  {{ conflict.target.content }}
                </p>
                <p class="wrap-break-word text-xs">
                  {{ conflict.challenger.content }}
                </p>
              </div>
              <div class="flex flex-wrap justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2 text-xs"
                  @click="handleResolveConflict(conflict.challenger.id, 'keep_target')"
                >
                  {{ t('settings.deepchatAgents.memoryManager.keepTarget') }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2 text-xs"
                  @click="handleResolveConflict(conflict.challenger.id, 'keep_challenger')"
                >
                  {{ t('settings.deepchatAgents.memoryManager.keepChallenger') }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2 text-xs"
                  @click="handleResolveConflict(conflict.challenger.id, 'keep_both')"
                >
                  {{ t('settings.deepchatAgents.memoryManager.keepBoth') }}
                </Button>
              </div>
            </div>
          </div>

          <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">
            {{ t('common.loading') }}
          </div>
          <div v-else-if="error" class="py-10 text-center text-sm text-destructive">
            {{ error }}
          </div>
          <div
            v-else-if="memories.length === 0"
            class="py-10 text-center text-sm text-muted-foreground"
          >
            {{ t('settings.deepchatAgents.memoryManager.emptyMemories') }}
          </div>
          <ScrollArea v-else class="h-[360px] pr-3">
            <ul class="space-y-2">
              <li
                v-for="memory in memories"
                :key="memory.id"
                class="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2"
                :class="{ 'opacity-60': memory.status === 'archived' }"
              >
                <div class="min-w-0 flex-1">
                  <p class="wrap-break-word text-sm">{{ memory.content }}</p>
                  <div class="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" class="text-[10px]">{{ memory.kind }}</Badge>
                    <Badge :variant="statusVariant(memory.status)" class="text-[10px]">
                      {{ t(`settings.deepchatAgents.memoryManager.status.${memory.status}`) }}
                    </Badge>
                    <Badge
                      v-if="memory.conflictState === 'challenged'"
                      variant="destructive"
                      class="text-[10px]"
                    >
                      {{ t('settings.deepchatAgents.memoryManager.conflict') }}
                    </Badge>
                    <span class="text-[10px] text-muted-foreground">
                      {{ formatTime(memory.createdAt) }}
                    </span>
                  </div>
                  <button
                    v-if="memory.sourceSession && memory.sourceEntryIds?.length"
                    class="mt-1 block max-w-full truncate text-left text-[10px] text-muted-foreground hover:text-foreground"
                    :title="sourceEntryTitle(memory)"
                    type="button"
                    @click="handleOpenSource(memory)"
                  >
                    {{
                      t('settings.deepchatAgents.memoryManager.sourceLine', {
                        session: shortSession(memory.sourceSession),
                        count: memory.sourceEntryIds?.length ?? 0
                      })
                    }}
                  </button>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <Button
                    v-if="memory.status === 'archived'"
                    variant="ghost"
                    size="sm"
                    class="h-7 px-2 text-xs"
                    :aria-label="t('settings.deepchatAgents.memoryManager.restore')"
                    @click="handleRestore(memory.id)"
                  >
                    <Icon icon="lucide:archive-restore" class="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 px-2 text-xs text-destructive"
                    :aria-label="t('common.delete')"
                    @click="handleDelete(memory.id)"
                  >
                    <Icon icon="lucide:x" class="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            </ul>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="persona" class="mt-3">
          <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">
            {{ t('common.loading') }}
          </div>
          <template v-else>
            <div
              class="mb-3 rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground"
              :class="props.personaEvolutionEnabled ? '' : 'opacity-80'"
            >
              {{
                props.personaEvolutionEnabled
                  ? t('settings.deepchatAgents.memoryManager.personaEvolutionOnHint')
                  : t('settings.deepchatAgents.memoryManager.personaEvolutionOffHint')
              }}
            </div>

            <div v-if="personaDrafts.length > 0" class="mb-3 space-y-2">
              <div class="text-xs font-medium">
                {{
                  t('settings.deepchatAgents.memoryManager.pendingTitle', {
                    count: personaDrafts.length
                  })
                }}
              </div>
              <div
                v-for="draft in personaDrafts"
                :key="draft.id"
                class="space-y-2 rounded-lg border px-3 py-2"
                :class="
                  draft.needsReview
                    ? 'border-destructive/60 bg-destructive/5'
                    : 'border-amber-500/50 bg-amber-500/5'
                "
              >
                <div
                  v-if="draft.needsReview"
                  class="flex items-center gap-1.5 text-[11px] font-medium text-destructive"
                >
                  <Icon icon="lucide:triangle-alert" class="h-3.5 w-3.5" />
                  {{ t('settings.deepchatAgents.memoryManager.largeChange') }}
                </div>
                <div class="space-y-1">
                  <div class="text-[10px] font-medium uppercase text-muted-foreground">
                    {{ t('settings.deepchatAgents.memoryManager.personaCurrent') }}
                  </div>
                  <p class="whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground">
                    {{
                      activePersonaContent || t('settings.deepchatAgents.memoryManager.personaNone')
                    }}
                  </p>
                  <div class="text-[10px] font-medium uppercase text-muted-foreground">
                    {{ t('settings.deepchatAgents.memoryManager.personaProposed') }}
                  </div>
                  <p class="whitespace-pre-wrap wrap-break-word text-xs">{{ draft.content }}</p>
                </div>
                <div class="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-7 px-2 text-xs"
                    @click="handleRejectDraft(draft.id)"
                  >
                    {{ t('settings.deepchatAgents.memoryManager.reject') }}
                  </Button>
                  <Button size="sm" class="h-7 px-2 text-xs" @click="handleApproveDraft(draft.id)">
                    {{ t('settings.deepchatAgents.memoryManager.approve') }}
                  </Button>
                </div>
              </div>
            </div>

            <div
              v-if="personaTimeline.length === 0"
              class="py-10 text-center text-sm text-muted-foreground"
            >
              {{ t('settings.deepchatAgents.memoryManager.emptyPersona') }}
            </div>
            <ScrollArea v-else class="h-[320px] pr-3">
              <ol class="space-y-2">
                <li
                  v-for="version in personaTimeline"
                  :key="version.id"
                  class="rounded-lg border px-3 py-2"
                  :class="
                    isActivePersona(version) ? 'border-primary bg-primary/5' : 'border-border'
                  "
                >
                  <div class="mb-1 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5">
                      <Badge
                        :variant="isActivePersona(version) ? 'default' : 'outline'"
                        class="text-[10px]"
                      >
                        {{
                          isActivePersona(version)
                            ? t('settings.deepchatAgents.memoryManager.personaActive')
                            : formatTime(version.createdAt)
                        }}
                      </Badge>
                      <Badge v-if="version.isAnchor" variant="secondary" class="gap-1 text-[10px]">
                        <Icon icon="lucide:lock" class="h-3 w-3" />
                        {{ t('settings.deepchatAgents.memoryManager.anchored') }}
                      </Badge>
                    </div>
                    <div class="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        class="h-7 px-2 text-xs"
                        :aria-label="
                          version.isAnchor
                            ? t('settings.deepchatAgents.memoryManager.unanchor')
                            : t('settings.deepchatAgents.memoryManager.anchor')
                        "
                        @click="handleSetAnchor(version.id, !version.isAnchor)"
                      >
                        <Icon
                          :icon="version.isAnchor ? 'lucide:lock-open' : 'lucide:lock'"
                          class="mr-1 h-3.5 w-3.5"
                        />
                        {{
                          version.isAnchor
                            ? t('settings.deepchatAgents.memoryManager.unanchor')
                            : t('settings.deepchatAgents.memoryManager.anchor')
                        }}
                      </Button>
                      <AlertDialog v-if="!isActivePersona(version)">
                        <AlertDialogTrigger as-child>
                          <Button variant="ghost" size="sm" class="h-7 px-2 text-xs">
                            <Icon icon="lucide:rotate-ccw" class="mr-1 h-3.5 w-3.5" />
                            {{ t('settings.deepchatAgents.memoryManager.rollback') }}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {{ t('settings.deepchatAgents.memoryManager.rollbackConfirmTitle') }}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {{ t('settings.deepchatAgents.memoryManager.rollbackConfirmBody') }}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
                            <AlertDialogAction @click="handleRollback(version.id)">
                              {{ t('settings.deepchatAgents.memoryManager.rollback') }}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  <p class="whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground">
                    {{ version.content }}
                  </p>
                </li>
              </ol>
            </ScrollArea>
          </template>
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
  <Dialog v-model:open="sourceSpanOpen">
    <DialogContent class="sm:max-w-160">
      <DialogHeader class="text-left">
        <DialogTitle>{{
          t('settings.deepchatAgents.memoryManager.sourceDialogTitle')
        }}</DialogTitle>
      </DialogHeader>
      <div v-if="!sourceSpan" class="py-6 text-center text-sm text-muted-foreground">
        {{ t('settings.deepchatAgents.memoryManager.sourceDialogEmpty') }}
      </div>
      <ScrollArea v-else class="max-h-105 pr-3">
        <ol class="space-y-2">
          <li
            v-for="entry in sourceSpan.entries"
            :key="entry.entryId"
            class="rounded-lg border border-border px-3 py-2"
          >
            <div class="mb-1 text-[10px] uppercase text-muted-foreground">
              {{ entry.role }} · #{{ entry.orderSeq }}
            </div>
            <p class="whitespace-pre-wrap wrap-break-word text-xs">{{ entry.content }}</p>
          </li>
        </ol>
      </ScrollArea>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@shadcn/components/ui/alert-dialog'
import { createMemoryClient } from '@api/MemoryClient'
import { useToast } from '@/components/use-toast'
import type {
  MemoryConflictItem,
  MemoryItem,
  MemorySourceSpan,
  MemoryStatusDto
} from '@shared/contracts/routes'

const props = defineProps<{
  open: boolean
  agentId: string
  hasEmbeddingConfigured?: boolean
  personaEvolutionEnabled?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const { toast } = useToast()
const memoryClient = createMemoryClient()

const activeTab = ref<'memories' | 'persona'>('memories')
const loading = ref(false)
const error = ref<string | null>(null)
const memories = ref<MemoryItem[]>([])
const conflicts = ref<MemoryConflictItem[]>([])
const personaVersions = ref<MemoryItem[]>([])
const personaDrafts = ref<MemoryItem[]>([])
const status = ref<MemoryStatusDto | null>(null)
const sourceSpanOpen = ref(false)
const sourceSpan = ref<MemorySourceSpan>(null)

const hasEmbeddingConfigured = computed(() => props.hasEmbeddingConfigured === true)

let disposeUpdated: (() => void) | null = null

async function refresh(): Promise<void> {
  if (!props.agentId) return
  loading.value = true
  error.value = null
  try {
    const [list, conflictPairs, versions, drafts, currentStatus] = await Promise.all([
      memoryClient.list(props.agentId),
      memoryClient.listConflicts(props.agentId),
      memoryClient.listPersonaVersions(props.agentId),
      memoryClient.listPersonaDrafts(props.agentId),
      memoryClient.getStatus(props.agentId)
    ])
    memories.value = list
    conflicts.value = conflictPairs
    personaVersions.value = versions
    personaDrafts.value = drafts
    status.value = currentStatus
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// The injected self-model is the newest version that is active (or a legacy row that was never
// superseded). Drafts and rejected versions are kept out of the timeline entirely.
const activePersonaId = computed<string | null>(() => {
  const match = personaVersions.value.find(
    (version) =>
      version.personaState === 'active' ||
      (version.personaState == null && version.supersededBy === null)
  )
  return match?.id ?? null
})

const activePersonaContent = computed<string | null>(
  () =>
    personaVersions.value.find((version) => version.id === activePersonaId.value)?.content ?? null
)

const personaTimeline = computed<MemoryItem[]>(() =>
  personaVersions.value.filter(
    (version) => version.personaState !== 'draft' && version.personaState !== 'rejected'
  )
)

function isActivePersona(version: MemoryItem): boolean {
  return version.id === activePersonaId.value
}

function statusVariant(
  memoryStatus: MemoryItem['status']
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (memoryStatus === 'error') return 'destructive'
  if (memoryStatus === 'conflicted') return 'destructive'
  if (memoryStatus === 'embedded') return 'default'
  if (memoryStatus === 'archived') return 'outline'
  return 'secondary'
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString()
}

function shortSession(session: string): string {
  return session.length > 8 ? `…${session.slice(-8)}` : session
}

function sourceEntryTitle(memory: MemoryItem): string {
  return memory.sourceEntryIds?.join(', ') ?? ''
}

function notifyActionFailed(e?: unknown): void {
  toast({
    variant: 'destructive',
    title: t('settings.deepchatAgents.memoryManager.actionFailed'),
    description: e instanceof Error ? e.message : e ? String(e) : undefined
  })
}

async function handleDelete(memoryId: string): Promise<void> {
  try {
    const ok = await memoryClient.remove(props.agentId, memoryId)
    if (!ok) return notifyActionFailed()
    memories.value = memories.value.filter((memory) => memory.id !== memoryId)
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleClear(): Promise<void> {
  try {
    const removed = await memoryClient.clear(props.agentId)
    if (removed === 0) {
      toast({
        title: t('settings.deepchatAgents.memoryManager.clearNoop')
      })
      return
    }
    memories.value = []
    conflicts.value = []
    status.value = status.value ? { ...status.value, total: 0, pendingEmbedding: 0 } : null
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleOpenSource(memory: MemoryItem): Promise<void> {
  sourceSpan.value = null
  sourceSpanOpen.value = true
  try {
    sourceSpan.value = await memoryClient.getSourceSpan(props.agentId, memory.id)
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleResolveConflict(
  challengerId: string,
  outcome: 'keep_target' | 'keep_challenger' | 'keep_both'
): Promise<void> {
  try {
    const ok = await memoryClient.resolveConflict(props.agentId, challengerId, outcome)
    if (!ok) return notifyActionFailed()
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleRollback(versionId: string): Promise<void> {
  try {
    const ok = await memoryClient.rollbackPersona(props.agentId, versionId)
    if (!ok) return notifyActionFailed()
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleApproveDraft(draftId: string): Promise<void> {
  try {
    const ok = await memoryClient.approvePersonaDraft(props.agentId, draftId)
    if (!ok) return notifyActionFailed()
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleRejectDraft(draftId: string): Promise<void> {
  try {
    const ok = await memoryClient.rejectPersonaDraft(props.agentId, draftId)
    if (!ok) return notifyActionFailed()
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleSetAnchor(versionId: string, anchored: boolean): Promise<void> {
  try {
    const ok = await memoryClient.setPersonaAnchor(props.agentId, versionId, anchored)
    if (!ok) return notifyActionFailed()
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  }
}

async function handleRestore(memoryId: string): Promise<void> {
  try {
    const ok = await memoryClient.restore(props.agentId, memoryId)
    if (!ok) return notifyActionFailed()
    await refresh()
  } catch (e) {
    notifyActionFailed(e)
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      activeTab.value = 'memories'
      void refresh()
      disposeUpdated = memoryClient.onUpdated((payload) => {
        if (payload.agentId === props.agentId) void refresh()
      })
    } else {
      disposeUpdated?.()
      disposeUpdated = null
    }
  }
)

onUnmounted(() => {
  disposeUpdated?.()
  disposeUpdated = null
})
</script>
