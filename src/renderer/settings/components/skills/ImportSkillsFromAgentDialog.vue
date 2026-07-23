<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@shadcn/components/ui/empty'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import { Spinner } from '@shadcn/components/ui/spinner'
import { createSkillClient } from '@api/SkillClient'
import type {
  AgentSkillImportConflictStrategy,
  AgentSkillImportPreviewItem,
  AgentSkillImportResult,
  AgentSkillImportSourceInfo
} from '@shared/types/agentSkillImport'

const props = defineProps<{
  open: boolean
  targetAgentId: string
  targetAgentName?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  completed: [targetAgentId: string]
}>()

const { t } = useI18n()
const skillClient = createSkillClient()

const sources = ref<AgentSkillImportSourceInfo[]>([])
const selectedSourceKey = ref('')
const previewItems = ref<AgentSkillImportPreviewItem[]>([])
const selectedSkillNames = ref<Set<string>>(new Set())
const strategies = ref<Record<string, AgentSkillImportConflictStrategy>>({})
const loadingSources = ref(false)
const loadingPreview = ref(false)
const executing = ref(false)
const sourceError = ref('')
const previewError = ref('')
const executeError = ref('')
const result = ref<AgentSkillImportResult | null>(null)

let sourceRequestId = 0
let previewRequestId = 0
let executeRequestId = 0

const selectedSource = computed(
  () => sources.value.find((source) => source.id === selectedSourceKey.value) ?? null
)
const actionableItems = computed(() =>
  previewItems.value.filter((item) => item.status !== 'unavailable')
)
const selectedCount = computed(() => selectedSkillNames.value.size)
const canExecute = computed(
  () =>
    Boolean(selectedSource.value) &&
    selectedCount.value > 0 &&
    !loadingSources.value &&
    !loadingPreview.value &&
    !executing.value
)
const failedCount = computed(() => result.value?.failed.length ?? 0)

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const isCurrentTarget = (targetAgentId: string): boolean =>
  props.open && props.targetAgentId.trim() === targetAgentId

const resetPreview = () => {
  previewRequestId += 1
  previewItems.value = []
  selectedSkillNames.value = new Set()
  strategies.value = {}
  previewError.value = ''
  executeError.value = ''
  result.value = null
}

const resetDialog = () => {
  sourceRequestId += 1
  executeRequestId += 1
  sources.value = []
  selectedSourceKey.value = ''
  loadingSources.value = false
  loadingPreview.value = false
  executing.value = false
  sourceError.value = ''
  resetPreview()
}

const loadSources = async (targetAgentId: string) => {
  const requestId = ++sourceRequestId
  loadingSources.value = true
  sourceError.value = ''
  try {
    const nextSources = await skillClient.listAgentImportSources(targetAgentId)
    if (requestId !== sourceRequestId || !isCurrentTarget(targetAgentId)) return

    sources.value = nextSources
    selectedSourceKey.value = nextSources.find((source) => source.available)?.id ?? ''
  } catch (cause) {
    if (requestId !== sourceRequestId || !isCurrentTarget(targetAgentId)) return
    sourceError.value = errorMessage(cause)
  } finally {
    if (requestId === sourceRequestId && isCurrentTarget(targetAgentId)) {
      loadingSources.value = false
    }
  }
}

const loadPreview = async () => {
  const source = selectedSource.value
  const targetAgentId = props.targetAgentId.trim()
  if (!source?.available || !targetAgentId) {
    resetPreview()
    return
  }

  const requestedSourceKey = source.id
  const requestId = ++previewRequestId
  loadingPreview.value = true
  previewError.value = ''
  executeError.value = ''
  result.value = null
  previewItems.value = []
  selectedSkillNames.value = new Set()
  strategies.value = {}

  try {
    const preview = await skillClient.previewAgentImport({ targetAgentId, source: source.source })
    if (
      requestId !== previewRequestId ||
      !isCurrentTarget(targetAgentId) ||
      selectedSourceKey.value !== requestedSourceKey
    ) {
      return
    }

    const items = preview.items
    previewItems.value = items
    selectedSkillNames.value = new Set(
      items.filter((item) => item.status !== 'unavailable').map((item) => item.name)
    )
    strategies.value = Object.fromEntries(
      items.map((item) => [item.name, item.status === 'conflict' ? 'rename' : 'skip'])
    )
  } catch (cause) {
    if (
      requestId !== previewRequestId ||
      !isCurrentTarget(targetAgentId) ||
      selectedSourceKey.value !== requestedSourceKey
    ) {
      return
    }
    previewError.value = errorMessage(cause)
  } finally {
    if (
      requestId === previewRequestId &&
      isCurrentTarget(targetAgentId) &&
      selectedSourceKey.value === requestedSourceKey
    ) {
      loadingPreview.value = false
    }
  }
}

const selectSource = (key: string) => {
  if (executing.value) return
  const source = sources.value.find((item) => item.id === key)
  if (!source?.available || selectedSourceKey.value === key) return
  selectedSourceKey.value = key
}

const toggleSkill = (skillName: string, checked: boolean) => {
  if (executing.value) return
  const next = new Set(selectedSkillNames.value)
  if (checked) next.add(skillName)
  else next.delete(skillName)
  selectedSkillNames.value = next
}

const selectAll = () => {
  if (executing.value) return
  selectedSkillNames.value = new Set(actionableItems.value.map((item) => item.name))
}

const clearSelection = () => {
  if (executing.value) return
  selectedSkillNames.value = new Set()
}

const updateStrategy = (skillName: string, strategy: string) => {
  if (executing.value) return
  if (strategy !== 'skip' && strategy !== 'rename' && strategy !== 'overwrite') return
  strategies.value = { ...strategies.value, [skillName]: strategy }
}

const executeImport = async () => {
  const source = selectedSource.value
  const targetAgentId = props.targetAgentId.trim()
  if (!source || !targetAgentId || !canExecute.value) return

  const requestedSourceKey = source.id
  const items = previewItems.value
    .filter((item) => selectedSkillNames.value.has(item.name) && item.status !== 'unavailable')
    .map((item) => ({
      skillName: item.name,
      strategy: strategies.value[item.name] ?? (item.status === 'conflict' ? 'rename' : 'skip')
    }))
  if (items.length === 0) return

  const requestId = ++executeRequestId
  executing.value = true
  executeError.value = ''
  try {
    const nextResult = await skillClient.executeAgentImport({
      targetAgentId,
      source: source.source,
      items
    })
    if (
      requestId !== executeRequestId ||
      !isCurrentTarget(targetAgentId) ||
      selectedSourceKey.value !== requestedSourceKey
    ) {
      return
    }

    result.value = nextResult
    if (nextResult.imported.length > 0) emit('completed', targetAgentId)
  } catch (cause) {
    if (
      requestId !== executeRequestId ||
      !isCurrentTarget(targetAgentId) ||
      selectedSourceKey.value !== requestedSourceKey
    ) {
      return
    }
    executeError.value = errorMessage(cause)
  } finally {
    if (requestId === executeRequestId) {
      executing.value = false
    }
  }
}

const retrySources = () => {
  const targetAgentId = props.targetAgentId.trim()
  if (targetAgentId) void loadSources(targetAgentId)
}

const requestClose = () => {
  if (!executing.value) emit('update:open', false)
}

const handleOpenChange = (open: boolean) => {
  if (!open && executing.value) return
  emit('update:open', open)
}

watch(
  () => (props.open ? props.targetAgentId.trim() : ''),
  (targetAgentId) => {
    resetDialog()
    if (targetAgentId) void loadSources(targetAgentId)
  },
  { immediate: true }
)

watch(selectedSourceKey, (key) => {
  if (!key) return
  void loadPreview()
})
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent
      v-if="open"
      data-testid="agent-skill-import-dialog"
      class="flex max-h-[88vh] flex-col overflow-hidden p-0 sm:max-w-3xl"
    >
      <DialogHeader class="shrink-0 border-b px-6 py-5">
        <DialogTitle class="flex items-center gap-2 text-base">
          <Icon icon="lucide:copy-plus" class="size-4 text-primary" />
          {{ t('settings.skills.agentImport.title') }}
        </DialogTitle>
        <DialogDescription class="mt-1">
          {{ t('settings.skills.agentImport.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <div class="flex min-w-0 items-center justify-between gap-3 border-b pb-4">
          <div class="min-w-0">
            <div class="text-xs text-muted-foreground">
              {{ t('settings.skills.agentImport.target') }}
            </div>
            <div class="truncate text-sm font-medium" :title="targetAgentName || targetAgentId">
              {{ targetAgentName || targetAgentId }}
            </div>
          </div>
          <Badge variant="outline" class="max-w-52 shrink-0 truncate font-mono text-[11px]">
            {{ targetAgentId }}
          </Badge>
        </div>

        <template v-if="result">
          <Empty class="border-0 py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon
                  :icon="failedCount > 0 ? 'lucide:triangle-alert' : 'lucide:circle-check'"
                  :class="failedCount > 0 ? 'text-amber-500' : 'text-emerald-600'"
                />
              </EmptyMedia>
              <EmptyTitle>
                {{
                  t(
                    failedCount > 0
                      ? 'settings.skills.agentImport.resultPartial'
                      : 'settings.skills.agentImport.resultSuccess'
                  )
                }}
              </EmptyTitle>
              <EmptyDescription>
                {{
                  t('settings.skills.agentImport.resultSummary', {
                    imported: result.imported.length,
                    skipped: result.skipped.length,
                    failed: result.failed.length
                  })
                }}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>

          <div v-if="result.failed.length > 0" class="overflow-hidden rounded-md border">
            <div
              v-for="failure in result.failed"
              :key="failure.skillName"
              class="border-b px-3 py-2 text-xs last:border-b-0"
            >
              <div class="font-medium">{{ failure.skillName }}</div>
              <div class="mt-0.5 text-muted-foreground">
                {{ failure.reason }}
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <section class="space-y-3" aria-labelledby="agent-import-source-heading">
            <div>
              <div id="agent-import-source-heading" class="text-sm font-medium">
                {{ t('settings.skills.agentImport.sourceTitle') }}
              </div>
              <p class="mt-0.5 text-xs text-muted-foreground">
                {{ t('settings.skills.agentImport.sourceDescription') }}
              </p>
            </div>

            <div
              v-if="loadingSources"
              class="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Spinner class="size-4" />
              {{ t('settings.skills.agentImport.loadingSources') }}
            </div>

            <div v-else-if="sourceError" role="alert" class="rounded-md border px-3 py-3">
              <div class="text-sm font-medium text-destructive">
                {{ t('settings.skills.agentImport.sourceError') }}
              </div>
              <p class="mt-1 break-words text-xs text-muted-foreground">{{ sourceError }}</p>
              <Button class="mt-3" variant="outline" size="sm" @click="retrySources">
                <Icon icon="lucide:refresh-cw" class="size-4" />
                {{ t('common.retry') }}
              </Button>
            </div>

            <Empty v-else-if="sources.length === 0" class="border py-7">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon icon="lucide:inbox" />
                </EmptyMedia>
                <EmptyTitle>{{ t('settings.skills.agentImport.emptySources') }}</EmptyTitle>
                <EmptyDescription>
                  {{ t('settings.skills.agentImport.emptySourcesDescription') }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>

            <RadioGroup
              v-else
              :model-value="selectedSourceKey"
              class="grid gap-2 sm:grid-cols-2"
              @update:model-value="selectSource(String($event))"
            >
              <label
                v-for="source in sources"
                :key="source.id"
                :data-testid="`agent-import-source-${source.id}`"
                class="flex min-w-0 gap-3 rounded-md border px-3 py-3 transition-colors"
                :class="[
                  selectedSourceKey === source.id ? 'border-primary bg-primary/5' : '',
                  source.available && !executing
                    ? 'cursor-pointer hover:bg-muted/30'
                    : 'cursor-not-allowed opacity-55'
                ]"
                @click="selectSource(source.id)"
              >
                <RadioGroupItem
                  :id="`agent-import-source-${source.id}`"
                  :value="source.id"
                  :disabled="executing || !source.available"
                  class="mt-0.5"
                />
                <span class="min-w-0 flex-1">
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="truncate text-sm font-medium" :title="source.name">
                      {{ source.name }}
                    </span>
                    <Badge variant="outline" class="shrink-0 text-[10px]">
                      {{ t(`settings.skills.agentImport.sourceKind.${source.source.kind}`) }}
                    </Badge>
                  </span>
                  <span class="mt-1 block text-xs text-muted-foreground">
                    {{ t('settings.skills.agentImport.skillCount', { count: source.skillCount }) }}
                  </span>
                </span>
              </label>
            </RadioGroup>
          </section>

          <section
            v-if="selectedSource"
            class="space-y-3"
            aria-labelledby="agent-import-preview-heading"
          >
            <div class="flex min-w-0 flex-wrap items-end justify-between gap-3">
              <div>
                <div id="agent-import-preview-heading" class="text-sm font-medium">
                  {{ t('settings.skills.agentImport.previewTitle') }}
                </div>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  {{ t('settings.skills.agentImport.selectedCount', { count: selectedCount }) }}
                </p>
              </div>
              <div class="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="executing || loadingPreview || actionableItems.length === 0"
                  @click="selectAll"
                >
                  {{ t('settings.skills.agentImport.selectAll') }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="executing || loadingPreview || selectedCount === 0"
                  @click="clearSelection"
                >
                  {{ t('settings.skills.agentImport.clear') }}
                </Button>
              </div>
            </div>

            <div
              v-if="loadingPreview"
              class="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Spinner class="size-4" />
              {{ t('settings.skills.agentImport.loadingPreview') }}
            </div>

            <div v-else-if="previewError" role="alert" class="rounded-md border px-3 py-3">
              <div class="text-sm font-medium text-destructive">
                {{ t('settings.skills.agentImport.previewError') }}
              </div>
              <p class="mt-1 break-words text-xs text-muted-foreground">{{ previewError }}</p>
              <Button class="mt-3" variant="outline" size="sm" @click="loadPreview">
                <Icon icon="lucide:refresh-cw" class="size-4" />
                {{ t('common.retry') }}
              </Button>
            </div>

            <Empty v-else-if="previewItems.length === 0" class="border py-7">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon icon="lucide:folder-search" />
                </EmptyMedia>
                <EmptyTitle>{{ t('settings.skills.agentImport.emptyPreview') }}</EmptyTitle>
                <EmptyDescription>
                  {{ t('settings.skills.agentImport.emptyPreviewDescription') }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>

            <div v-else class="overflow-hidden rounded-md border">
              <div
                v-for="item in previewItems"
                :key="item.name"
                :data-testid="`agent-import-skill-${item.name}`"
                class="border-b px-3 py-3 last:border-b-0"
                :class="item.status === 'unavailable' ? 'bg-muted/20 opacity-60' : ''"
              >
                <div class="flex min-w-0 items-start gap-3">
                  <Checkbox
                    :id="`agent-import-skill-${item.name}`"
                    class="mt-0.5"
                    :checked="selectedSkillNames.has(item.name)"
                    :disabled="executing || item.status === 'unavailable'"
                    @update:checked="toggleSkill(item.name, $event)"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 flex-wrap items-center gap-2">
                      <label
                        :for="`agent-import-skill-${item.name}`"
                        class="min-w-0 truncate text-sm font-medium"
                        :title="item.name"
                      >
                        {{ item.name }}
                      </label>
                      <Badge variant="outline" class="shrink-0 text-[10px]">
                        {{ t(`settings.skills.agentImport.status.${item.status}`) }}
                      </Badge>
                    </div>
                    <p
                      v-if="item.description"
                      class="mt-1 line-clamp-2 text-xs text-muted-foreground"
                    >
                      {{ item.description }}
                    </p>
                    <p v-if="item.warning" class="mt-1 text-xs text-amber-600">
                      {{ item.warning }}
                    </p>

                    <div
                      v-if="item.status === 'conflict' && selectedSkillNames.has(item.name)"
                      class="mt-3 space-y-2"
                    >
                      <RadioGroup
                        :model-value="strategies[item.name]"
                        class="flex flex-wrap gap-x-4 gap-y-2"
                        @update:model-value="updateStrategy(item.name, String($event))"
                      >
                        <label
                          v-for="strategy in ['skip', 'rename', 'overwrite'] as const"
                          :key="strategy"
                          :data-testid="`agent-import-strategy-${item.name}-${strategy}`"
                          class="flex items-center gap-2 text-xs"
                          :class="executing ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
                          @click="updateStrategy(item.name, strategy)"
                        >
                          <RadioGroupItem :value="strategy" :disabled="executing" />
                          {{ t(`settings.skills.agentImport.strategy.${strategy}`) }}
                        </label>
                      </RadioGroup>
                      <p
                        v-if="strategies[item.name] === 'rename' && item.suggestedTargetName"
                        class="truncate text-xs text-muted-foreground"
                        :title="item.suggestedTargetName"
                      >
                        {{
                          t('settings.skills.agentImport.renameTarget', {
                            name: item.suggestedTargetName
                          })
                        }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div v-if="executeError" role="alert" class="rounded-md border px-3 py-3">
            <div class="text-sm font-medium text-destructive">
              {{ t('settings.skills.agentImport.executeError') }}
            </div>
            <p class="mt-1 break-words text-xs text-muted-foreground">{{ executeError }}</p>
          </div>
        </template>
      </div>

      <DialogFooter class="shrink-0 border-t px-6 py-4 sm:justify-between">
        <Button variant="outline" :disabled="executing" @click="requestClose">
          {{ result ? t('common.close') : t('common.cancel') }}
        </Button>
        <Button
          v-if="!result"
          data-testid="agent-import-execute"
          :disabled="!canExecute"
          @click="executeImport"
        >
          <Spinner v-if="executing" class="size-4" />
          {{
            executing
              ? t('settings.skills.agentImport.importing')
              : t('settings.skills.agentImport.importSelected', { count: selectedCount })
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
