<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent class="sm:max-w-[680px]">
      <DialogHeader class="text-left">
        <DialogTitle>{{ t('settings.deepchatAgents.memoryManager.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.deepchatAgents.memoryManager.description') }}
        </DialogDescription>
      </DialogHeader>

      <!-- 降级提示：未配置 embedding 时纯 FTS 召回 -->
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

        <!-- ============ 记忆列表 ============ -->
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
              >
                <div class="min-w-0 flex-1">
                  <p class="break-words text-sm">{{ memory.content }}</p>
                  <div class="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" class="text-[10px]">{{ memory.kind }}</Badge>
                    <Badge :variant="statusVariant(memory.status)" class="text-[10px]">
                      {{ t(`settings.deepchatAgents.memoryManager.status.${memory.status}`) }}
                    </Badge>
                    <span class="text-[10px] text-muted-foreground">
                      {{ formatTime(memory.createdAt) }}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 shrink-0 px-2 text-xs text-destructive"
                  :aria-label="t('common.delete')"
                  @click="handleDelete(memory.id)"
                >
                  <Icon icon="lucide:x" class="h-3.5 w-3.5" />
                </Button>
              </li>
            </ul>
          </ScrollArea>
        </TabsContent>

        <!-- ============ 人格时间线 ============ -->
        <TabsContent value="persona" class="mt-3">
          <div v-if="loading" class="py-10 text-center text-sm text-muted-foreground">
            {{ t('common.loading') }}
          </div>
          <div
            v-else-if="personaVersions.length === 0"
            class="py-10 text-center text-sm text-muted-foreground"
          >
            {{ t('settings.deepchatAgents.memoryManager.emptyPersona') }}
          </div>
          <ScrollArea v-else class="h-[400px] pr-3">
            <ol class="space-y-2">
              <li
                v-for="version in personaVersions"
                :key="version.id"
                class="rounded-lg border px-3 py-2"
                :class="isActivePersona(version) ? 'border-primary bg-primary/5' : 'border-border'"
              >
                <div class="mb-1 flex items-center justify-between gap-2">
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
                  <Button
                    v-if="!isActivePersona(version)"
                    variant="ghost"
                    size="sm"
                    class="h-7 px-2 text-xs"
                    @click="handleRollback(version.id)"
                  >
                    <Icon icon="lucide:rotate-ccw" class="mr-1 h-3.5 w-3.5" />
                    {{ t('settings.deepchatAgents.memoryManager.rollback') }}
                  </Button>
                </div>
                <p class="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {{ version.content }}
                </p>
              </li>
            </ol>
          </ScrollArea>
        </TabsContent>
      </Tabs>
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
import type { MemoryItem, MemoryStatusDto } from '@shared/contracts/routes'

const props = defineProps<{
  open: boolean
  agentId: string
  /** 该 agent 是否已配置 embedding 模型，用于降级提示。 */
  hasEmbeddingConfigured?: boolean
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
const personaVersions = ref<MemoryItem[]>([])
const status = ref<MemoryStatusDto | null>(null)

const hasEmbeddingConfigured = computed(() => props.hasEmbeddingConfigured === true)

let disposeUpdated: (() => void) | null = null

async function refresh(): Promise<void> {
  if (!props.agentId) return
  loading.value = true
  error.value = null
  try {
    const [list, versions, currentStatus] = await Promise.all([
      memoryClient.list(props.agentId),
      memoryClient.listPersonaVersions(props.agentId),
      memoryClient.getStatus(props.agentId)
    ])
    memories.value = list
    personaVersions.value = versions
    status.value = currentStatus
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function isActivePersona(version: MemoryItem): boolean {
  return version.supersededBy === null
}

function statusVariant(
  memoryStatus: MemoryItem['status']
): 'default' | 'secondary' | 'destructive' {
  if (memoryStatus === 'error') return 'destructive'
  if (memoryStatus === 'embedded') return 'default'
  return 'secondary'
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString()
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
    await memoryClient.clear(props.agentId)
    memories.value = []
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

// 打开时加载并订阅变更；关闭时清理订阅
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
