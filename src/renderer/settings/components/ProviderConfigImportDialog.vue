<template>
  <Dialog v-model:open="isOpen">
    <DialogContent
      class="flex h-[88vh] max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
    >
      <DialogHeader class="shrink-0 border-b px-6 py-5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <DialogTitle class="flex items-center gap-2 text-base">
              <Icon icon="lucide:download" class="h-4 w-4 text-primary" />
              {{ t('settings.data.providerImport.dialogTitle') }}
            </DialogTitle>
            <DialogDescription class="mt-2">
              {{ t('settings.data.providerImport.dialogDescription') }}
            </DialogDescription>
          </div>
          <div
            class="hidden shrink-0 items-center gap-1 rounded-full border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground sm:flex"
          >
            <span
              v-for="step in visibleSteps"
              :key="step.key"
              class="rounded-full px-2 py-1"
              :class="step.key === activeStepKey ? 'bg-background text-foreground' : ''"
            >
              {{ step.label }}
            </span>
          </div>
        </div>
      </DialogHeader>

      <div class="min-h-0 flex-1 overflow-hidden px-6 py-5">
        <div v-if="step === 'scan'" class="flex h-full min-h-0 flex-col gap-4">
          <div v-if="isScanning" class="flex flex-1 flex-col items-center justify-center gap-3">
            <Icon icon="lucide:loader-2" class="h-6 w-6 animate-spin text-primary" />
            <div class="space-y-1 text-center">
              <div class="text-sm font-medium">
                {{ t('settings.data.providerImport.scanningTitle') }}
              </div>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.data.providerImport.scanningDescription') }}
              </p>
            </div>
          </div>

          <div v-else-if="scanError" class="flex flex-1 flex-col items-center justify-center gap-3">
            <Icon icon="lucide:triangle-alert" class="h-6 w-6 text-destructive" />
            <div class="space-y-1 text-center">
              <div class="text-sm font-medium">
                {{ t('settings.data.providerImport.scanFailedTitle') }}
              </div>
              <p class="max-w-md text-xs text-muted-foreground">
                {{ scanError }}
              </p>
            </div>
            <Button variant="outline" size="sm" @click="runScan">
              <Icon icon="lucide:refresh-cw" class="h-4 w-4" />
              {{ t('settings.data.providerImport.actions.rescan') }}
            </Button>
          </div>

          <template v-else-if="scanResult">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div class="space-y-1">
                <div class="text-sm font-medium">
                  {{ t('settings.data.providerImport.sourcesTitle') }}
                </div>
                <p class="text-xs text-muted-foreground">
                  {{ t('settings.data.providerImport.sourcesDescription') }}
                </p>
              </div>
              <div class="text-xs text-muted-foreground">
                {{
                  t('settings.data.providerImport.selectedSources', {
                    selected: selectedSourceIds.length,
                    total: selectableSourceCount
                  })
                }}
              </div>
            </div>

            <div class="overflow-hidden rounded-lg border">
              <div
                v-for="source in visibleSources"
                :key="source.id"
                class="flex items-start gap-3 border-b px-4 py-3 last:border-b-0"
                :class="source.selectable ? 'bg-background' : 'bg-muted/20 text-muted-foreground'"
              >
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <div class="text-sm font-medium">{{ source.name }}</div>
                    <Badge variant="outline" class="text-[11px]">
                      {{ t(`settings.data.providerImport.sourceStatus.${source.status}`) }}
                    </Badge>
                    <span class="text-xs text-muted-foreground">
                      {{
                        t('settings.data.providerImport.providersFound', {
                          count: source.providerCount
                        })
                      }}
                    </span>
                  </div>
                  <p class="mt-0.5 truncate text-xs text-muted-foreground">
                    {{ source.configPath }}
                  </p>
                  <p v-if="source.message" class="mt-0.5 text-xs text-destructive">
                    {{ source.message }}
                  </p>
                </div>
                <Checkbox
                  class="mt-1 shrink-0"
                  :checked="selectedSources.has(source.id)"
                  :disabled="!source.selectable"
                  @update:checked="toggleSource(source.id)"
                />
              </div>
            </div>

            <div
              v-if="selectableSourceCount === 0"
              class="rounded-lg border border-dashed p-5 text-center"
            >
              <div class="text-sm font-medium">
                {{ t('settings.data.providerImport.noSourcesTitle') }}
              </div>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ t('settings.data.providerImport.noSourcesDescription') }}
              </p>
            </div>
          </template>
        </div>

        <div v-else-if="step === 'providers' && currentSource" class="flex h-full min-h-0 flex-col">
          <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <div class="text-sm font-medium">{{ currentSource.name }}</div>
                <Badge variant="outline" class="text-[11px]">
                  {{
                    t('settings.data.providerImport.sourceProgress', {
                      current: currentSourceIndex + 1,
                      total: selectedSourceIds.length
                    })
                  }}
                </Badge>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.data.providerImport.overwriteNote') }}
              </p>
              <p v-if="applyError" class="text-xs text-destructive">
                {{ t('settings.data.providerImport.applyFailed', { message: applyError }) }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" @click="selectAllCurrentProviders">
                {{ t('settings.data.providerImport.actions.selectAll') }}
              </Button>
              <Button variant="outline" size="sm" @click="clearCurrentProviders">
                {{ t('settings.data.providerImport.actions.clearSelected') }}
              </Button>
            </div>
          </div>

          <ScrollArea class="h-0 min-h-0 flex-1 pr-3">
            <div
              v-if="currentSourceProviders.length === 0"
              class="rounded-lg border p-6 text-center"
            >
              <div class="text-sm font-medium">
                {{ t('settings.data.providerImport.noProvidersTitle') }}
              </div>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ t('settings.data.providerImport.noProvidersDescription') }}
              </p>
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="provider in currentSourceProviders"
                :key="provider.id"
                class="rounded-lg border p-4"
                :class="
                  cn(
                    !isProviderSelectable(provider) && !canEditProviderApiType(provider)
                      ? 'bg-muted/20 opacity-75'
                      : 'bg-background',
                    isProviderSelected(provider.id) ? 'border-primary/50' : ''
                  )
                "
              >
                <div class="flex gap-3">
                  <Checkbox
                    class="mt-1"
                    :checked="isProviderSelected(provider.id)"
                    :disabled="!isProviderSelectable(provider)"
                    @update:checked="toggleProvider(provider.id)"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <div class="text-sm font-medium">{{ provider.name }}</div>
                          <Badge
                            :variant="provider.configured ? 'secondary' : 'outline'"
                            class="text-[11px]"
                          >
                            {{
                              provider.configured
                                ? t('settings.data.providerImport.badges.configured')
                                : provider.sourceType
                            }}
                          </Badge>
                        </div>
                        <div
                          class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
                        >
                          <span>{{ provider.sourceProviderId }}</span>
                          <span v-if="provider.apiKeyMasked">
                            {{
                              t('settings.data.providerImport.apiKey', {
                                value: provider.apiKeyMasked
                              })
                            }}
                          </span>
                          <span v-if="provider.baseUrl">{{ provider.baseUrl }}</span>
                        </div>
                      </div>

                      <div class="min-w-0 rounded-md border bg-muted/20 px-3 py-2 lg:w-64">
                        <div class="flex items-center gap-2 text-xs">
                          <Badge variant="outline" class="text-[11px]">
                            {{ targetKindLabel(provider.targetKind) }}
                          </Badge>
                          <span class="truncate font-medium">
                            {{ provider.targetProviderName || provider.targetProviderId }}
                          </span>
                        </div>
                        <div class="mt-1 truncate text-[11px] text-muted-foreground">
                          {{
                            provider.targetKind === 'custom'
                              ? selectedProviderApiTypeLabel(provider)
                              : provider.targetApiType || provider.targetProviderId
                          }}
                        </div>
                        <div v-if="provider.targetKind === 'custom'" class="mt-2">
                          <div class="mb-1 text-[11px] text-muted-foreground">
                            {{ t('settings.provider.dialog.addCustomProvider.apiType') }}
                          </div>
                          <Select
                            :model-value="selectedProviderApiType(provider)"
                            :disabled="!canEditProviderApiType(provider)"
                            @update:model-value="
                              (value) => updateProviderApiType(provider.id, value)
                            "
                          >
                            <SelectTrigger class="h-8 w-full text-xs">
                              <SelectValue
                                :placeholder="
                                  t('settings.provider.dialog.addCustomProvider.apiTypePlaceholder')
                                "
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem
                                v-for="option in customApiTypeOptions"
                                :key="option.value"
                                :value="option.value"
                              >
                                {{ option.label }}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    <div class="mt-3 flex flex-wrap gap-2">
                      <Badge
                        v-for="model in provider.modelPreview"
                        :key="model"
                        variant="secondary"
                        class="max-w-[12rem] truncate text-[11px]"
                      >
                        {{ model }}
                      </Badge>
                      <span
                        v-if="provider.modelCount > provider.modelPreview.length"
                        class="text-xs text-muted-foreground"
                      >
                        +{{ provider.modelCount - provider.modelPreview.length }}
                      </span>
                      <span v-if="provider.modelCount === 0" class="text-xs text-muted-foreground">
                        {{ t('settings.data.providerImport.noModels') }}
                      </span>
                    </div>

                    <div class="mt-3 flex flex-col gap-1 text-xs">
                      <p
                        v-for="warning in warningTexts(provider)"
                        :key="warning"
                        class="text-muted-foreground"
                      >
                        {{ warning }}
                      </p>
                      <p
                        v-if="selectionConflictText(provider)"
                        class="text-amber-600 dark:text-amber-400"
                      >
                        {{ selectionConflictText(provider) }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>

        <div
          v-else-if="step === 'applying'"
          class="flex h-full min-h-0 flex-col items-center justify-center gap-3"
        >
          <Icon icon="lucide:loader-2" class="h-6 w-6 animate-spin text-primary" />
          <div class="space-y-1 text-center">
            <div class="text-sm font-medium">
              {{ t('settings.data.providerImport.importingTitle') }}
            </div>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.data.providerImport.importingDescription') }}
            </p>
          </div>
        </div>

        <div v-else-if="step === 'done' && applyResult" class="flex h-full min-h-0 flex-col gap-4">
          <div class="space-y-1">
            <div class="text-sm font-medium">
              {{ t('settings.data.providerImport.doneTitle') }}
            </div>
            <p class="text-xs text-muted-foreground">
              {{
                t('settings.data.providerImport.doneDescription', {
                  count: applyResult.summary.imported
                })
              }}
            </p>
          </div>

          <div class="grid grid-cols-2 gap-2 md:grid-cols-6">
            <div
              v-for="metric in summaryMetrics"
              :key="metric.key"
              class="rounded-lg border bg-muted/20 px-3 py-2"
            >
              <div class="text-[11px] text-muted-foreground">{{ metric.label }}</div>
              <div class="mt-1 text-lg font-semibold">{{ metric.value }}</div>
            </div>
          </div>

          <ScrollArea class="h-0 min-h-0 flex-1 rounded-lg border">
            <div
              v-for="result in applyResult.results"
              :key="result.id"
              class="flex items-start gap-3 border-b p-3 last:border-b-0"
            >
              <Icon
                :icon="resultStatusIcon(result.status)"
                class="mt-0.5 h-4 w-4 text-muted-foreground"
              />
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <div class="text-sm font-medium">{{ result.name }}</div>
                  <Badge variant="outline" class="text-[11px]">
                    {{ t(`settings.data.providerImport.resultStatus.${result.status}`) }}
                  </Badge>
                </div>
                <p class="mt-1 truncate text-xs text-muted-foreground">
                  {{ result.sourceName }} ->
                  {{ result.targetProviderName || result.targetProviderId }}
                </p>
                <p v-if="result.message" class="mt-1 text-xs text-muted-foreground">
                  {{ result.message }}
                </p>
              </div>
              <div class="text-xs text-muted-foreground">
                {{ t('settings.data.providerImport.modelsImported', { count: result.modelCount }) }}
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>

      <DialogFooter class="shrink-0 border-t px-6 py-4">
        <Button v-if="step === 'scan'" variant="outline" @click="isOpen = false">
          {{ t('dialog.cancel') }}
        </Button>
        <Button
          v-else-if="step !== 'applying' && step !== 'done'"
          variant="outline"
          @click="goBack"
        >
          {{ t('common.back') }}
        </Button>
        <Button v-if="step === 'scan'" variant="outline" :disabled="isScanning" @click="runScan">
          {{ t('settings.data.providerImport.actions.rescan') }}
        </Button>
        <Button v-if="step === 'scan'" :disabled="!canContinueFromScan" @click="goToProviders">
          {{ t('common.next') }}
        </Button>
        <Button
          v-else-if="step === 'providers'"
          :disabled="!canContinueFromProviders"
          @click="goNextProviderStep"
        >
          {{ providerActionLabel }}
        </Button>
        <Button v-else-if="step === 'done'" @click="isOpen = false">
          {{ t('dialog.ok') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { Badge } from '@shadcn/components/ui/badge'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { cn } from '@/lib/utils'
import { createProviderClient } from '@api/ProviderClient'
import { PROVIDER_IMPORT_CUSTOM_API_TYPES } from '@shared/providerImport'
import type {
  ProviderImportApplyResult,
  ProviderImportApplyResultItem,
  ProviderImportCustomApiType,
  ProviderImportProviderPreview,
  ProviderImportScanResult,
  ProviderImportSelection,
  ProviderImportSourceId,
  ProviderImportSourceScan
} from '@shared/providerImport'

type WizardStep = 'scan' | 'providers' | 'applying' | 'done'

const isOpen = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  'import-complete': [result: ProviderImportApplyResult]
}>()

const { t } = useI18n()
const providerClient = createProviderClient()

const step = ref<WizardStep>('scan')
const scanResult = ref<ProviderImportScanResult | null>(null)
const applyResult = ref<ProviderImportApplyResult | null>(null)
const isScanning = ref(false)
const scanError = ref('')
const applyError = ref('')
const currentSourceIndex = ref(0)
const selectedSources = ref<Set<ProviderImportSourceId>>(new Set())
const selectedProvidersBySource = ref<Record<string, string[]>>({})
const selectedProviderApiTypes = ref<Record<string, ProviderImportCustomApiType>>({})

const customApiTypeOptions = computed(() =>
  PROVIDER_IMPORT_CUSTOM_API_TYPES.map((value) => ({
    value,
    label: apiTypeLabel(value)
  }))
)

const orderedSources = computed<ProviderImportSourceScan[]>(() => {
  if (!scanResult.value) return []
  const sourceById = new Map(scanResult.value.sources.map((source) => [source.id, source]))
  return scanResult.value.sourceOrder.flatMap((sourceId) => {
    const source = sourceById.get(sourceId)
    return source ? [source] : []
  })
})
const visibleSources = computed<ProviderImportSourceScan[]>(() =>
  orderedSources.value.filter(
    (source) => source.status !== 'not_found' && source.status !== 'unsupported_platform'
  )
)

const selectableSourceCount = computed(
  () => visibleSources.value.filter((source) => source.selectable).length
)
const selectedSourceIds = computed(() =>
  visibleSources.value
    .filter((source) => source.selectable && selectedSources.value.has(source.id))
    .map((source) => source.id)
)
const currentSource = computed(() => {
  const sourceId = selectedSourceIds.value[currentSourceIndex.value]
  return orderedSources.value.find((source) => source.id === sourceId) ?? null
})
const currentSourceProviders = computed(() =>
  currentSource.value && scanResult.value
    ? scanResult.value.providers.filter((provider) => provider.sourceId === currentSource.value?.id)
    : []
)
const selectedProviderCount = computed(() =>
  selectedSourceIds.value.reduce((count, sourceId) => {
    return count + (selectedProvidersBySource.value[sourceId]?.length ?? 0)
  }, 0)
)
const canContinueFromScan = computed(() => !isScanning.value && selectedSourceIds.value.length > 0)
const canContinueFromProviders = computed(
  () =>
    step.value === 'providers' &&
    (currentSourceIndex.value < selectedSourceIds.value.length - 1 ||
      selectedProviderCount.value > 0)
)
const providerActionLabel = computed(() =>
  currentSourceIndex.value < selectedSourceIds.value.length - 1
    ? t('common.next')
    : t('settings.data.providerImport.actions.import')
)

const activeStepKey = computed(() => {
  if (step.value === 'providers') {
    return `source-${currentSource.value?.id ?? 'unknown'}`
  }
  return step.value
})
const visibleSteps = computed(() => {
  const sources = selectedSourceIds.value.map((sourceId) => {
    const source = orderedSources.value.find((item) => item.id === sourceId)
    return {
      key: `source-${sourceId}`,
      label: source?.name ?? sourceId
    }
  })
  return [
    { key: 'scan', label: t('settings.data.providerImport.steps.scan') },
    ...sources,
    { key: 'done', label: t('settings.data.providerImport.steps.done') }
  ]
})

const selectedProviderOrder = computed(() => {
  if (!scanResult.value) return []
  return selectedSourceIds.value.flatMap((sourceId) => {
    const selected = new Set(selectedProvidersBySource.value[sourceId] ?? [])
    return scanResult.value!.providers.filter(
      (provider) => provider.sourceId === sourceId && selected.has(provider.id)
    )
  })
})
const selectedProviderConflict = computed(() => {
  const lastByTarget = new Map<string, ProviderImportProviderPreview>()
  const firstByTarget = new Map<string, ProviderImportProviderPreview>()
  for (const provider of selectedProviderOrder.value) {
    const key = providerTargetKey(provider)
    if (!key) continue
    if (!firstByTarget.has(key)) {
      firstByTarget.set(key, provider)
    }
    lastByTarget.set(key, provider)
  }
  return {
    firstByTarget,
    lastByTarget
  }
})
const summaryMetrics = computed(() => {
  if (!applyResult.value) return []
  return [
    {
      key: 'imported',
      label: t('settings.data.providerImport.summary.imported'),
      value: applyResult.value.summary.imported
    },
    {
      key: 'created',
      label: t('settings.data.providerImport.summary.created'),
      value: applyResult.value.summary.created
    },
    {
      key: 'updated',
      label: t('settings.data.providerImport.summary.updated'),
      value: applyResult.value.summary.updated
    },
    {
      key: 'overwritten',
      label: t('settings.data.providerImport.summary.overwritten'),
      value: applyResult.value.summary.overwritten
    },
    {
      key: 'skipped',
      label: t('settings.data.providerImport.summary.skipped'),
      value: applyResult.value.summary.skipped
    },
    {
      key: 'models',
      label: t('settings.data.providerImport.summary.models'),
      value: applyResult.value.summary.models
    }
  ]
})

watch(isOpen, (open) => {
  if (open) {
    void initialize()
  }
})

const initialize = async () => {
  step.value = 'scan'
  applyResult.value = null
  applyError.value = ''
  currentSourceIndex.value = 0
  selectedProviderApiTypes.value = {}
  await runScan()
}

const runScan = async () => {
  isScanning.value = true
  scanError.value = ''
  applyError.value = ''
  selectedProviderApiTypes.value = {}
  try {
    const result = (await providerClient.scanProviderImports()) as ProviderImportScanResult
    scanResult.value = result
    selectedSources.value = new Set(
      result.sources
        .filter((source) => source.selectable && source.defaultSelected)
        .map((source) => source.id)
    )
    selectedProvidersBySource.value = result.providers.reduce<Record<string, string[]>>(
      (acc, provider) => {
        if (!provider.defaultSelected) return acc
        acc[provider.sourceId] = [...(acc[provider.sourceId] ?? []), provider.id]
        return acc
      },
      {}
    )
    selectedProviderApiTypes.value = result.providers.reduce<
      Record<string, ProviderImportCustomApiType>
    >((acc, provider) => {
      if (provider.targetKind !== 'custom') return acc
      acc[provider.id] = toCustomApiType(provider.targetApiType)
      return acc
    }, {})
  } catch (error) {
    scanResult.value = null
    scanError.value = error instanceof Error ? error.message : String(error)
  } finally {
    isScanning.value = false
  }
}

const toggleSource = (sourceId: ProviderImportSourceId) => {
  const next = new Set(selectedSources.value)
  if (next.has(sourceId)) {
    next.delete(sourceId)
  } else {
    next.add(sourceId)
  }
  selectedSources.value = next
}

const toggleProvider = (providerId: string) => {
  const sourceId = currentSource.value?.id
  if (!sourceId) return
  const provider = currentSourceProviders.value.find((item) => item.id === providerId)
  if (!provider) return
  const selected = new Set(selectedProvidersBySource.value[sourceId] ?? [])
  if (selected.has(providerId)) {
    selected.delete(providerId)
  } else {
    if (!isProviderSelectable(provider)) return
    selected.add(providerId)
  }
  selectedProvidersBySource.value = {
    ...selectedProvidersBySource.value,
    [sourceId]: [...selected]
  }
}

const isProviderSelected = (providerId: string): boolean => {
  const sourceId = currentSource.value?.id
  return Boolean(sourceId && selectedProvidersBySource.value[sourceId]?.includes(providerId))
}

const selectAllCurrentProviders = () => {
  const sourceId = currentSource.value?.id
  if (!sourceId) return
  selectedProvidersBySource.value = {
    ...selectedProvidersBySource.value,
    [sourceId]: currentSourceProviders.value
      .filter((provider) => isProviderSelectable(provider))
      .map((provider) => provider.id)
  }
}

const clearCurrentProviders = () => {
  const sourceId = currentSource.value?.id
  if (!sourceId) return
  selectedProvidersBySource.value = {
    ...selectedProvidersBySource.value,
    [sourceId]: []
  }
}

const goToProviders = () => {
  currentSourceIndex.value = 0
  step.value = 'providers'
}

const goBack = () => {
  if (step.value !== 'providers') return
  if (currentSourceIndex.value === 0) {
    step.value = 'scan'
    return
  }
  currentSourceIndex.value -= 1
}

const goNextProviderStep = async () => {
  if (currentSourceIndex.value < selectedSourceIds.value.length - 1) {
    currentSourceIndex.value += 1
    return
  }

  if (!scanResult.value || selectedProviderCount.value === 0) {
    return
  }

  step.value = 'applying'
  applyError.value = ''
  try {
    const result = await providerClient.applyProviderImports(
      scanResult.value.sessionId,
      selectedSourceIds.value.map((sourceId) => {
        const providerIds = [...(selectedProvidersBySource.value[sourceId] ?? [])]
        return {
          sourceId,
          providerIds,
          providerOptions: buildProviderOptions(providerIds)
        }
      })
    )
    applyResult.value = result
    step.value = 'done'
    emit('import-complete', result)
  } catch (error) {
    applyError.value = error instanceof Error ? error.message : String(error)
    step.value = 'providers'
  }
}

const buildProviderOptions = (
  providerIds: string[]
): ProviderImportSelection['providerOptions'] => {
  if (!scanResult.value) return undefined
  const selectedIds = new Set(providerIds)
  const options = scanResult.value.providers.reduce<
    NonNullable<ProviderImportSelection['providerOptions']>
  >((acc, provider) => {
    if (!selectedIds.has(provider.id) || provider.targetKind !== 'custom') return acc
    acc[provider.id] = {
      targetApiType:
        selectedProviderApiTypes.value[provider.id] || toCustomApiType(provider.targetApiType)
    }
    return acc
  }, {})
  return Object.keys(options).length > 0 ? options : undefined
}

const selectedProviderApiType = (provider: ProviderImportProviderPreview): string =>
  selectedProviderApiTypes.value[provider.id] || toCustomApiType(provider.targetApiType)

const selectedProviderApiTypeLabel = (provider: ProviderImportProviderPreview): string =>
  apiTypeLabel(selectedProviderApiType(provider))

const updateProviderApiType = (providerId: string, value: unknown) => {
  if (typeof value !== 'string') return
  if (!PROVIDER_IMPORT_CUSTOM_API_TYPES.includes(value as ProviderImportCustomApiType)) return
  selectedProviderApiTypes.value = {
    ...selectedProviderApiTypes.value,
    [providerId]: value as ProviderImportCustomApiType
  }
  const provider = scanResult.value?.providers.find((item) => item.id === providerId)
  if (provider && isProviderSelected(providerId) && !hasRequiredPreviewCredentials(provider)) {
    toggleProvider(providerId)
  }
}

const toCustomApiType = (value: string): ProviderImportCustomApiType =>
  PROVIDER_IMPORT_CUSTOM_API_TYPES.includes(value as ProviderImportCustomApiType)
    ? (value as ProviderImportCustomApiType)
    : 'openai-completions'

function apiTypeLabel(value: string): string {
  switch (value) {
    case 'openai-completions':
      return t('settings.data.providerImport.apiTypes.openaiCompletions')
    case 'openai':
      return t('settings.data.providerImport.apiTypes.openai')
    case 'openai-responses':
      return t('settings.data.providerImport.apiTypes.openaiResponses')
    case 'anthropic':
      return t('settings.data.providerImport.apiTypes.anthropic')
    case 'gemini':
      return t('settings.data.providerImport.apiTypes.gemini')
    case 'ollama':
      return t('settings.data.providerImport.apiTypes.ollama')
    case 'mistral':
      return t('settings.data.providerImport.apiTypes.mistral')
    default:
      return value
  }
}

const targetKindLabel = (targetKind: ProviderImportProviderPreview['targetKind']): string =>
  t(`settings.data.providerImport.targetKind.${targetKind}`)

const hasRequiredPreviewCredentials = (
  provider: ProviderImportProviderPreview,
  apiType = selectedProviderApiType(provider)
): boolean => {
  if (provider.targetKind !== 'custom') {
    return !provider.warnings.includes('missing_api_key')
  }

  if (apiType === 'ollama') {
    return Boolean(provider.baseUrl.trim())
  }

  return Boolean(provider.apiKeyMasked.trim()) && Boolean(provider.baseUrl.trim())
}

const canEditProviderApiType = (provider: ProviderImportProviderPreview): boolean =>
  provider.targetKind === 'custom' && Boolean(provider.baseUrl.trim())

const isProviderSelectable = (provider: ProviderImportProviderPreview): boolean => {
  if (provider.targetKind === 'custom') {
    return canEditProviderApiType(provider) && hasRequiredPreviewCredentials(provider)
  }

  return provider.selectable
}

const warningTexts = (provider: ProviderImportProviderPreview): string[] => {
  const warnings = provider.warnings.filter(
    (warning) => warning !== 'missing_api_key' || provider.targetKind !== 'custom'
  )
  if (provider.targetKind === 'custom' && !hasRequiredPreviewCredentials(provider)) {
    warnings.push('missing_api_key')
  }
  return warnings.map((warning) => t(`settings.data.providerImport.warnings.${warning}`))
}

const providerTargetKey = (provider: ProviderImportProviderPreview): string => {
  if (provider.targetKind === 'unsupported' || !provider.targetProviderId) {
    return ''
  }
  if (provider.targetKind === 'custom') {
    return `${provider.targetKind}:${provider.targetProviderId}:${provider.baseUrl}:${provider.apiKeyMasked}`
  }
  return `${provider.targetKind}:${provider.targetProviderId}`
}

const selectionConflictText = (provider: ProviderImportProviderPreview): string => {
  if (!isSelectedPreview(provider)) return ''
  const key = providerTargetKey(provider)
  if (!key) return ''
  const first = selectedProviderConflict.value.firstByTarget.get(key)
  const last = selectedProviderConflict.value.lastByTarget.get(key)
  if (!first || !last || first.id === last.id) return ''
  if (last.id === provider.id) {
    return t('settings.data.providerImport.conflicts.overridesPrevious')
  }
  return t('settings.data.providerImport.conflicts.overwrittenByLater')
}

const isSelectedPreview = (provider: ProviderImportProviderPreview): boolean =>
  Boolean(selectedProvidersBySource.value[provider.sourceId]?.includes(provider.id))

const resultStatusIcon = (status: ProviderImportApplyResultItem['status']): string => {
  switch (status) {
    case 'created':
      return 'lucide:plus-circle'
    case 'updated':
      return 'lucide:check-circle-2'
    case 'overwritten':
      return 'lucide:replace'
    case 'skipped':
      return 'lucide:circle-slash'
  }
}
</script>
