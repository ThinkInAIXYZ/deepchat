<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import { Spinner } from '@shadcn/components/ui/spinner'
import { createSkillClient } from '@api/SkillClient'
import type {
  AgentSkillImportConflictStrategy,
  AgentSkillImportPreviewItem,
  AgentSkillImportResult,
  AgentSkillImportSourceInfo
} from '@shared/types/agentSkillImport'

const props = withDefaults(
  defineProps<{
    open: boolean
    agents?: Array<{ id: string; name: string }>
  }>(),
  {
    agents: () => []
  }
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  imported: []
}>()

const { t } = useI18n()
const skillClient = createSkillClient()
const sources = ref<AgentSkillImportSourceInfo[]>([])
const selectedSourceId = ref('')
const previewItems = ref<AgentSkillImportPreviewItem[]>([])
const selectedSkillNames = ref<Set<string>>(new Set())
const strategies = ref<Record<string, AgentSkillImportConflictStrategy>>({})
const loading = ref(false)
const previewing = ref(false)
const executing = ref(false)
const error = ref(false)
const failedStage = ref<'load' | 'preview' | 'execute' | null>(null)
const result = ref<AgentSkillImportResult | null>(null)
let requestId = 0

const selectedSource = computed(
  () => sources.value.find((source) => source.id === selectedSourceId.value) ?? null
)
const serializeSource = (source: AgentSkillImportSourceInfo['source']) => ({
  kind: 'external' as const,
  toolId: source.toolId
})
const canPreview = computed(() => Boolean(selectedSource.value?.available))
const canExecute = computed(
  () =>
    canPreview.value && selectedSkillNames.value.size > 0 && !previewing.value && !executing.value
)
const agentNameById = computed(
  () => new Map(props.agents.map((agent) => [agent.id, agent.name || agent.id] as const))
)

const resetPreview = () => {
  previewItems.value = []
  selectedSkillNames.value = new Set()
  strategies.value = {}
  result.value = null
}

const loadSources = async () => {
  const currentRequest = ++requestId
  loading.value = true
  error.value = false
  failedStage.value = null
  try {
    const nextSources = await skillClient.listAgentImportSources()
    if (currentRequest !== requestId || !props.open) return
    sources.value = nextSources
    selectedSourceId.value = nextSources.find((source) => source.available)?.id ?? ''
  } catch (cause) {
    if (currentRequest !== requestId) return
    error.value = true
    failedStage.value = 'load'
    console.error('[ImportSkillsFromAgentDialog] Failed to load sources', cause)
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

const loadPreview = async (preferredSkillNames?: ReadonlySet<string>) => {
  const source = selectedSource.value
  if (!source || !canPreview.value) {
    resetPreview()
    return
  }
  const currentRequest = ++requestId
  previewing.value = true
  error.value = false
  failedStage.value = null
  resetPreview()
  try {
    const preview = await skillClient.previewAgentImport({
      source: serializeSource(source.source)
    })
    if (currentRequest !== requestId || !props.open || selectedSourceId.value !== source.id) return
    previewItems.value = preview.items
    selectedSkillNames.value = new Set(
      preview.items
        .filter(
          (item) =>
            item.status !== 'unavailable' &&
            (!preferredSkillNames || preferredSkillNames.has(item.name))
        )
        .map((item) => item.name)
    )
    strategies.value = Object.fromEntries(
      preview.items.map((item) => [item.name, item.status === 'conflict' ? 'rename' : 'skip'])
    )
  } catch (cause) {
    if (currentRequest !== requestId) return
    error.value = true
    failedStage.value = 'preview'
    console.error('[ImportSkillsFromAgentDialog] Failed to preview Skills', cause)
  } finally {
    if (currentRequest === requestId) previewing.value = false
  }
}

const toggleSkill = (name: string, checked: boolean | 'indeterminate') => {
  if (executing.value) return
  const next = new Set(selectedSkillNames.value)
  if (checked === true) next.add(name)
  else next.delete(name)
  selectedSkillNames.value = next
}

const updateStrategy = (name: string, value: string) => {
  if (value !== 'skip' && value !== 'rename' && value !== 'overwrite') return
  strategies.value = { ...strategies.value, [name]: value }
}

const execute = async () => {
  const source = selectedSource.value
  if (!source || !canExecute.value) return
  executing.value = true
  error.value = false
  failedStage.value = null
  try {
    const nextResult = await skillClient.executeAgentImport({
      source: serializeSource(source.source),
      items: previewItems.value
        .filter((item) => selectedSkillNames.value.has(item.name) && item.status !== 'unavailable')
        .map((item) => ({
          skillName: item.name,
          strategy: strategies.value[item.name] ?? 'skip',
          acknowledgedAgentIds:
            strategies.value[item.name] === 'overwrite' ? item.affectedAgentIds : undefined
        }))
    })
    result.value = nextResult
    if (nextResult.imported.length > 0 || nextResult.reused.length > 0) emit('imported')
  } catch (cause) {
    error.value = true
    failedStage.value = 'execute'
    console.error('[ImportSkillsFromAgentDialog] Failed to import Skills', cause)
  } finally {
    executing.value = false
  }
}

const retry = () => {
  if (failedStage.value === 'load') void loadSources()
  else if (failedStage.value === 'preview') void loadPreview()
  else if (failedStage.value === 'execute') void execute()
}

const retryFailedItems = () => {
  const failedNames = new Set(result.value?.failed.map((failure) => failure.skillName) ?? [])
  result.value = null
  void loadPreview(failedNames)
}

const formatAgentNames = (agentIds: string[] | undefined) =>
  (agentIds ?? []).map((agentId) => agentNameById.value.get(agentId) ?? agentId).join(', ')

const handleOpenChange = (open: boolean) => {
  if (!open && executing.value) return
  emit('update:open', open)
}

watch(
  () => props.open,
  (open) => {
    requestId += 1
    resetPreview()
    if (open) {
      sources.value = []
      selectedSourceId.value = ''
      failedStage.value = null
      void loadSources()
    }
  },
  { immediate: true }
)

watch(selectedSourceId, () => {
  if (props.open && !loading.value) void loadPreview()
})
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent
      v-if="open"
      data-testid="plugins-agent-skill-import-dialog"
      class="flex max-h-[88vh] flex-col overflow-hidden p-0 sm:max-w-3xl"
    >
      <DialogHeader class="border-b px-6 py-5">
        <DialogTitle class="flex items-center gap-2 text-base">
          <Icon icon="lucide:download" class="size-4" />
          {{ t('settings.skills.agentImport.title') }}
        </DialogTitle>
        <DialogDescription>{{ t('settings.skills.agentImport.description') }}</DialogDescription>
      </DialogHeader>

      <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <div
          v-if="loading"
          class="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner class="size-4" />
          {{ t('common.loading') }}
        </div>

        <template v-else-if="result">
          <div class="rounded-md border p-4">
            <div class="text-sm font-medium">
              {{
                result.failed.length
                  ? t('settings.skills.agentImport.resultPartial')
                  : t('settings.skills.agentImport.resultSuccess')
              }}
            </div>
            <p class="mt-1 text-xs text-muted-foreground">
              {{
                t('settings.skills.agentImport.resultSummaryV3', {
                  imported: result.imported.length,
                  reused: result.reused.length,
                  skipped: result.skipped.length,
                  failed: result.failed.length
                })
              }}
            </p>
          </div>
          <div v-if="result.failed.length" class="rounded-md border">
            <div
              v-for="failure in result.failed"
              :key="failure.skillName"
              class="border-b px-3 py-2 text-xs last:border-b-0"
            >
              <div class="font-medium">{{ failure.skillName }}</div>
              <div class="text-muted-foreground">{{ failure.reason }}</div>
            </div>
          </div>
        </template>

        <template v-else>
          <div
            v-if="sources.length === 0"
            class="rounded-md border p-6 text-center text-sm text-muted-foreground"
          >
            {{ t('settings.skills.agentImport.emptySources') }}
          </div>
          <section v-if="sources.length" class="space-y-2">
            <div class="text-sm font-medium">
              {{ t('settings.skills.agentImport.sourceTitle') }}
            </div>
            <RadioGroup v-model="selectedSourceId" class="grid gap-2 sm:grid-cols-2">
              <label
                v-for="source in sources"
                :key="source.id"
                :data-testid="`agent-import-source-${source.id}`"
                class="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3"
                :class="{ 'opacity-50': !source.available }"
              >
                <RadioGroupItem :value="source.id" :disabled="!source.available || executing" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">{{ source.name }}</span>
                  <span class="text-xs text-muted-foreground">
                    {{ t('settings.skills.agentImport.skillCount', { count: source.skillCount }) }}
                  </span>
                </span>
              </label>
            </RadioGroup>
          </section>

          <section v-if="selectedSource" class="space-y-2">
            <div class="text-sm font-medium">
              {{ t('settings.skills.agentImport.previewTitle') }}
            </div>
            <div v-if="previewing" class="p-8 text-center text-sm text-muted-foreground">
              {{ t('common.loading') }}
            </div>
            <div
              v-else-if="previewItems.length === 0"
              class="rounded-md border p-8 text-center text-sm text-muted-foreground"
            >
              {{ t('settings.skills.agentImport.emptyPreview') }}
            </div>
            <div v-else class="overflow-hidden rounded-md border">
              <div
                v-for="item in previewItems"
                :key="item.name"
                :data-testid="`agent-import-skill-${item.name}`"
                class="flex flex-col gap-2 border-b px-3 py-3 last:border-b-0 sm:flex-row sm:items-center"
              >
                <Checkbox
                  :aria-label="item.name"
                  :model-value="selectedSkillNames.has(item.name)"
                  :disabled="item.status === 'unavailable' || executing"
                  @update:model-value="toggleSkill(item.name, $event)"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate text-sm font-medium">{{ item.name }}</span>
                    <DcBadge variant="outline" class="text-[10px]">
                      {{ t(`settings.skills.agentImport.status.${item.status}`) }}
                    </DcBadge>
                  </div>
                  <p class="line-clamp-1 text-xs text-muted-foreground">{{ item.description }}</p>
                  <p
                    v-if="item.status === 'conflict' && item.affectedAgentIds?.length"
                    class="mt-1 text-xs text-muted-foreground"
                  >
                    {{
                      t('settings.skills.agentImport.overwriteImpact', {
                        agents: formatAgentNames(item.affectedAgentIds)
                      })
                    }}
                  </p>
                </div>
                <RadioGroup
                  v-if="item.status === 'conflict'"
                  :model-value="strategies[item.name]"
                  class="flex gap-3 text-xs"
                  @update:model-value="updateStrategy(item.name, String($event))"
                >
                  <label
                    :data-testid="`agent-import-strategy-${item.name}-rename`"
                    class="flex items-center gap-1"
                    ><RadioGroupItem value="rename" />{{
                      t('settings.skills.agentImport.strategy.rename')
                    }}</label
                  >
                  <label
                    :data-testid="`agent-import-strategy-${item.name}-skip`"
                    class="flex items-center gap-1"
                    ><RadioGroupItem value="skip" />{{
                      t('settings.skills.agentImport.strategy.skip')
                    }}</label
                  >
                  <label
                    :data-testid="`agent-import-strategy-${item.name}-overwrite`"
                    class="flex items-center gap-1"
                    ><RadioGroupItem value="overwrite" />{{
                      t('settings.skills.agentImport.strategy.overwrite')
                    }}</label
                  >
                </RadioGroup>
              </div>
            </div>
          </section>
        </template>

        <div v-if="error" class="flex items-center gap-3" role="alert">
          <p class="text-sm text-destructive">{{ t('common.error.requestFailed') }}</p>
          <DcButton variant="outline" size="sm" @click="retry">{{ t('common.retry') }}</DcButton>
        </div>
      </div>

      <DialogFooter class="border-t px-6 py-4">
        <DcButton variant="outline" :disabled="executing" @click="handleOpenChange(false)">
          {{ result ? t('common.close') : t('common.cancel') }}
        </DcButton>
        <DcButton
          v-if="result?.failed.length"
          variant="outline"
          :disabled="executing"
          @click="retryFailedItems"
        >
          {{ t('common.retry') }}
        </DcButton>
        <DcButton
          v-if="!result"
          data-testid="agent-import-execute"
          :disabled="!canExecute"
          @click="execute"
        >
          <Spinner v-if="executing" class="size-4" />
          {{ t('settings.skills.agentImport.execute') }}
        </DcButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
