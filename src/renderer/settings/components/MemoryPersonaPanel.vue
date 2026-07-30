<template>
  <section class="flex min-h-0 flex-1 flex-col gap-3">
    <div
      class="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"
      :class="personaEvolutionEnabled ? '' : 'opacity-80'"
    >
      {{
        personaEvolutionEnabled
          ? t('settings.deepchatAgents.memoryManager.personaEvolutionOnHint')
          : t('settings.deepchatAgents.memoryManager.personaEvolutionOffHint')
      }}
    </div>

    <MemoryInlineFeedback v-if="feedback" :feedback="feedback" @clear="clearFeedback" />

    <div v-if="loading" class="py-12 text-center text-sm text-muted-foreground">
      {{ t('common.loading') }}
    </div>
    <div
      v-else-if="timeline.length === 0"
      class="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground"
    >
      {{ t('settings.deepchatAgents.memoryManager.emptyPersona') }}
    </div>
    <ScrollArea v-else class="min-h-0 flex-1 pr-3">
      <ol class="space-y-2">
        <li
          v-for="version in timeline"
          :key="version.id"
          class="rounded-lg border px-3 py-2"
          :class="isActive(version) ? 'border-primary bg-primary/5' : 'border-border'"
        >
          <div class="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex flex-wrap items-center gap-1.5">
              <Badge :variant="isActive(version) ? 'default' : 'outline'" class="text-[10px]">
                {{
                  isActive(version)
                    ? t('settings.deepchatAgents.memoryManager.personaActive')
                    : formatRelativeTime(version.createdAt, locale)
                }}
              </Badge>
              <Badge v-if="version.isAnchor" variant="secondary" class="gap-1 text-[10px]">
                <Icon icon="lucide:lock" class="h-3 w-3" />
                {{ t('settings.deepchatAgents.memoryManager.anchored') }}
              </Badge>
            </div>
            <div class="flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                class="h-8 text-xs"
                :disabled="pendingIds.has(version.id)"
                @click="setAnchor(version.id, !version.isAnchor)"
              >
                <Icon
                  :icon="version.isAnchor ? 'lucide:lock-open' : 'lucide:lock'"
                  class="mr-1.5 h-3.5 w-3.5"
                />
                {{
                  version.isAnchor
                    ? t('settings.deepchatAgents.memoryManager.unanchor')
                    : t('settings.deepchatAgents.memoryManager.anchor')
                }}
              </Button>
              <AlertDialog v-if="!isActive(version)">
                <AlertDialogTrigger as-child>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-8 text-xs"
                    :disabled="pendingIds.has(version.id)"
                  >
                    <Icon icon="lucide:rotate-ccw" class="mr-1.5 h-3.5 w-3.5" />
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
                    <AlertDialogAction @click="rollback(version.id)">
                      {{ t('settings.deepchatAgents.memoryManager.rollback') }}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <p class="whitespace-pre-wrap wrap-break-word text-sm text-muted-foreground">
            {{ version.content }}
          </p>
        </li>
      </ol>
    </ScrollArea>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
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
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { createMemoryClient } from '@api/MemoryClient'
import type { MemoryItem } from '@shared/contracts/routes'
import { formatRelativeTime } from './memoryRedesignUtils'
import MemoryInlineFeedback from './MemoryInlineFeedback.vue'
import { useMemoryInlineFeedback } from '../lib/useMemoryInlineFeedback'

const props = defineProps<{
  agentId: string
  personaEvolutionEnabled: boolean
  refreshToken: number
}>()

const { t, locale } = useI18n()
const memoryClient = createMemoryClient()
const panelFeedback = useMemoryInlineFeedback('MemoryPersonaPanel')
const feedback = panelFeedback.feedback
const clearFeedback = panelFeedback.clear

const loading = ref(false)
const versions = ref<MemoryItem[]>([])
const pendingIds = ref<ReadonlySet<string>>(new Set())
let requestId = 0

const activeId = computed<string | null>(() => {
  const active = versions.value.find(
    (version) =>
      version.personaState === 'active' ||
      (version.personaState == null && version.supersededBy === null)
  )
  return active?.id ?? null
})

const timeline = computed(() =>
  versions.value.filter(
    (version) => version.personaState !== 'draft' && version.personaState !== 'rejected'
  )
)

function isActive(version: MemoryItem): boolean {
  return version.id === activeId.value
}

function setPending(versionId: string, pending: boolean): void {
  const next = new Set(pendingIds.value)
  if (pending) next.add(versionId)
  else next.delete(versionId)
  pendingIds.value = next
}

async function load(): Promise<void> {
  const agentId = props.agentId
  if (!agentId) return
  const current = ++requestId
  loading.value = true
  try {
    const next = await memoryClient.listPersonaVersions(agentId)
    if (current !== requestId || props.agentId !== agentId) return
    versions.value = next
  } catch (error) {
    if (current !== requestId || props.agentId !== agentId) return
    panelFeedback.fail(error)
  } finally {
    if (current === requestId && props.agentId === agentId) loading.value = false
  }
}

async function rollback(versionId: string): Promise<void> {
  if (pendingIds.value.has(versionId)) return
  const agentId = props.agentId
  clearFeedback()
  setPending(versionId, true)
  try {
    // Main broadcasts memory.updated for this mutation, which bumps
    // refreshToken and reloads this panel; no need to also reload locally.
    await memoryClient.rollbackPersona(agentId, versionId)
  } catch (error) {
    if (props.agentId === agentId) panelFeedback.fail(error)
  } finally {
    if (props.agentId === agentId) setPending(versionId, false)
  }
}

async function setAnchor(versionId: string, anchored: boolean): Promise<void> {
  if (pendingIds.value.has(versionId)) return
  const agentId = props.agentId
  clearFeedback()
  setPending(versionId, true)
  try {
    await memoryClient.setPersonaAnchor(agentId, versionId, anchored)
  } catch (error) {
    if (props.agentId === agentId) panelFeedback.fail(error)
  } finally {
    if (props.agentId === agentId) setPending(versionId, false)
  }
}

watch(
  () => props.agentId,
  () => {
    clearFeedback()
    pendingIds.value = new Set()
  }
)

watch(
  () => [props.agentId, props.refreshToken],
  () => void load(),
  { immediate: true }
)
</script>
