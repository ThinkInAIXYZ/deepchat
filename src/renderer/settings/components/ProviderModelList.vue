<template>
  <div class="flex flex-col w-full gap-4">
    <div
      ref="searchContainerRef"
      class="sticky z-30 border-b border-border/60 py-2 backdrop-blur supports-backdrop-filter:bg-background/80"
      :style="{ top: `${searchStickyTop}px` }"
    >
      <div class="flex gap-2">
        <Input
          class="flex-1"
          v-model="modelSearchQuery"
          :placeholder="t('model.search.placeholder')"
        />

        <Popover v-model:open="filterPopoverOpen">
          <PopoverTrigger as-child>
            <Button
              variant="outline"
              class="px-3 text-xs"
              :class="activeAdvancedFilterCount ? 'border-primary/40 bg-primary/5' : ''"
            >
              <Icon icon="lucide:funnel" class="mr-2 h-4 w-4 text-muted-foreground" />
              {{ t('model.filter.label') }}
              <Badge v-if="activeAdvancedFilterCount" variant="secondary" class="ml-2">
                {{ activeAdvancedFilterCount }}
              </Badge>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-[320px] p-4">
            <div class="space-y-4">
              <div class="flex items-center justify-between gap-2">
                <div class="text-sm font-medium">{{ t('model.filter.label') }}</div>
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-7 px-2 text-xs"
                  :disabled="!activeAdvancedFilterCount"
                  @click="clearAdvancedFilters"
                >
                  {{ t('common.clear') }}
                </Button>
              </div>

              <div class="space-y-2">
                <div class="text-xs font-medium text-muted-foreground">
                  {{ t('model.filter.capabilities') }}
                </div>
                <div class="grid gap-2 sm:grid-cols-2">
                  <Button
                    v-for="option in capabilityFilterOptions"
                    :key="option.value"
                    :data-testid="`model-capability-filter-${option.value}`"
                    size="sm"
                    class="justify-between px-3 text-xs"
                    :variant="selectedCapabilities.includes(option.value) ? 'default' : 'outline'"
                    @click="toggleCapabilityFilter(option.value)"
                  >
                    <span class="flex min-w-0 items-center gap-1.5">
                      <Icon :icon="option.icon" class="h-3.5 w-3.5 shrink-0" />
                      <span class="truncate">{{ option.label }}</span>
                    </span>
                    <span class="ml-2 text-[11px] opacity-70">{{ option.count }}</span>
                  </Button>
                </div>
              </div>

              <div class="space-y-2">
                <div class="text-xs font-medium text-muted-foreground">
                  {{ t('model.filter.types') }}
                </div>
                <div class="grid gap-2 sm:grid-cols-2">
                  <Button
                    v-for="option in typeFilterOptions"
                    :key="option.value"
                    :data-testid="`model-type-filter-${option.value}`"
                    size="sm"
                    class="justify-between px-3 text-xs"
                    :variant="selectedTypes.includes(option.value) ? 'default' : 'outline'"
                    @click="toggleTypeFilter(option.value)"
                  >
                    <span class="flex min-w-0 items-center gap-1.5">
                      <Icon :icon="option.icon" class="h-3.5 w-3.5 shrink-0" />
                      <span class="truncate">{{ option.label }}</span>
                    </span>
                    <span class="ml-2 text-[11px] opacity-70">{{ option.count }}</span>
                  </Button>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Popover v-model:open="sortPopoverOpen">
          <PopoverTrigger as-child>
            <Button variant="outline" class="px-3 text-xs">
              <Icon icon="lucide:arrow-up-down" class="mr-2 h-4 w-4 text-muted-foreground" />
              {{ currentSortLabel }}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-48 p-2">
            <div class="space-y-1">
              <Button
                v-for="option in sortOptions"
                :key="option.value"
                :data-testid="`model-sort-${option.value}`"
                size="sm"
                variant="ghost"
                class="w-full justify-between px-2! text-xs"
                @click="setSort(option.value)"
              >
                <span>{{ option.label }}</span>
                <Icon v-if="sortState === option.value" icon="lucide:check" class="h-2 w-2" />
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <AddCustomModelButton :provider-id="newProviderModel" @saved="$emit('config-changed')" />
      </div>

      <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div v-if="activeFilterTokens.length" class="flex flex-wrap items-center gap-2">
          <Button
            v-for="token in activeFilterTokens"
            :key="`${token.kind}-${token.value}`"
            size="sm"
            variant="outline"
            class="h-7 px-2.5 text-xs"
            @click="removeFilterToken(token)"
          >
            <span>{{ token.label }}</span>
            <Icon icon="lucide:x" class="ml-1 h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" class="h-7 px-2 text-xs" @click="clearAllFilters">
            {{ t('model.filter.clearAll') }}
          </Button>
        </div>

        <div class="text-xs text-muted-foreground">
          {{
            t('model.filter.visibleCount', {
              visible: visibleModelCount,
              total: totalModelCount
            })
          }}
        </div>
      </div>
    </div>

    <div v-if="filteredCustomModels.length > 0" class="relative">
      <div
        class="sticky z-20 backdrop-blur supports-backdrop-filter:bg-background/80 px-3 py-2 text-xs font-medium text-muted-foreground"
        :style="{ top: `${customLabelStickyTop}px` }"
      >
        {{ t('model.type.custom') }}
      </div>
      <div class="w-full border border-border/50 overflow-hidden divide-y divide-border bg-card">
        <ModelConfigItem
          v-for="model in filteredCustomModels"
          :key="model.id"
          v-memo="[
            model.id,
            model.providerId,
            model.enabled,
            model.name,
            model.group,
            model.type,
            model.vision,
            model.functionCall,
            model.reasoning,
            model.enableSearch
          ]"
          :model-name="model.name"
          :model-id="model.id"
          :provider-id="model.providerId"
          :enabled="model.enabled ?? false"
          :is-custom-model="true"
          :vision="model.vision"
          :function-call="model.functionCall"
          :reasoning="model.reasoning"
          :enable-search="model.enableSearch"
          :type="model.type ?? ModelType.Chat"
          @enabled-change="handleCustomModelEnabledChange(model, $event)"
          @delete-model="handleDeleteCustomModel(model)"
          @config-changed="emitConfigChanged"
        />
      </div>
    </div>

    <div
      v-if="isLoading"
      class="flex items-center gap-2 rounded-lg border border-dashed border-muted py-4 px-4 text-sm text-muted-foreground"
    >
      <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
      {{ t('common.loading') }}
    </div>

    <template v-else-if="virtualItems.length > 0">
      <RecycleScroller
        :items="virtualItems"
        :item-size="null"
        :min-item-size="LABEL_ITEM_HEIGHT"
        key-field="id"
        size-field="size"
        class="w-full"
        page-mode
        :buffer="900"
        :prerender="12"
      >
        <template #default="{ item }">
          <div
            v-if="isLabelItem(item)"
            class="flex h-9 items-center px-3 text-xs text-muted-foreground"
          >
            {{ item.label }}
          </div>
          <div
            v-else-if="isProviderActionsItem(item)"
            class="flex h-14 items-center justify-between gap-3 overflow-hidden px-3 py-2 bg-muted/30"
          >
            <div class="min-w-0 flex-1 truncate text-sm font-medium">
              {{ getProviderName(item.providerId) }}
            </div>
            <div class="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                class="h-8 min-w-8 max-w-[9rem] whitespace-nowrap rounded-lg px-2 text-xs text-normal"
                :disabled="isProviderBatchPending(item.providerId)"
                :title="t('model.actions.enableAll')"
                @click="enableAllModels(item.providerId)"
              >
                <Icon
                  :icon="
                    getProviderPendingAction(item.providerId) === 'enable'
                      ? 'lucide:loader-2'
                      : 'lucide:check-circle'
                  "
                  class="h-3.5 w-3.5 shrink-0 sm:mr-1"
                  :class="
                    getProviderPendingAction(item.providerId) === 'enable' ? 'animate-spin' : ''
                  "
                />
                <span class="hidden min-w-0 truncate sm:inline">
                  {{ t('model.actions.enableAll') }}
                </span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="h-8 min-w-8 max-w-[9rem] whitespace-nowrap rounded-lg px-2 text-xs text-normal"
                :disabled="isProviderBatchPending(item.providerId)"
                :title="t('model.actions.disableAll')"
                @click="disableAllModels(item.providerId)"
              >
                <Icon
                  :icon="
                    getProviderPendingAction(item.providerId) === 'disable'
                      ? 'lucide:loader-2'
                      : 'lucide:x-circle'
                  "
                  class="h-3.5 w-3.5 shrink-0 sm:mr-1"
                  :class="
                    getProviderPendingAction(item.providerId) === 'disable' ? 'animate-spin' : ''
                  "
                />
                <span class="hidden min-w-0 truncate sm:inline">
                  {{ t('model.actions.disableAll') }}
                </span>
              </Button>
            </div>
          </div>
          <div v-else-if="isModelItem(item)" :key="item.id" class="h-12 overflow-hidden bg-card">
            <ModelConfigItem
              :key="item.id"
              :model-name="item.name"
              :model-id="item.modelId"
              :provider-id="item.providerId"
              :enabled="item.enabled ?? false"
              :is-custom-model="false"
              :vision="item.vision"
              :function-call="item.functionCall"
              :reasoning="item.reasoning"
              :enable-search="item.enableSearch"
              :type="item.typeValue ?? ModelType.Chat"
              @enabled-change="handleVirtualModelEnabledChange(item, $event)"
              @config-changed="emitConfigChanged"
            />
          </div>
        </template>
      </RecycleScroller>
    </template>

    <div
      v-else-if="filteredCustomModels.length === 0"
      class="rounded-lg border py-6 px-4 text-sm text-muted-foreground text-center"
    >
      {{ t('settings.provider.dialog.modelCheck.noModels') }}
    </div>
  </div>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, reactive, ref, watch } from 'vue'
import { Input } from '@shadcn/components/ui/input'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { Icon } from '@iconify/vue'
import ModelConfigItem from '@/components/settings/ModelConfigItem.vue'
import { type RENDERER_MODEL_META } from '@shared/presenter'
import { ModelType } from '@shared/model'
import { useModelStore } from '@/stores/modelStore'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import { useDebounceFn, useElementSize } from '@vueuse/core'

import AddCustomModelButton from './AddCustomModelButton.vue'

const { t } = useI18n()
const modelSearchQuery = ref('')
const debouncedSearchQuery = ref('')
const modelStore = useModelStore()
const uiSettingsStore = useUiSettingsStore()
const LABEL_ITEM_HEIGHT = 36
const MODEL_ITEM_HEIGHT = 48
const PROVIDER_ACTIONS_ITEM_HEIGHT = 56
const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const MODEL_TOGGLE_PERF_LOG_PREFIX = '[ModelTogglePerf]'
const getPerfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const logModelTogglePerf = (phase: string, details: Record<string, unknown>) => {
  if (!uiSettingsStore.traceDebugEnabled) {
    return
  }

  console.info(`${MODEL_TOGGLE_PERF_LOG_PREFIX} ${phase}`, details)
}

type ModelSortKey = 'status' | 'name'
type ModelCapabilityKey = 'vision' | 'functionCall' | 'reasoning' | 'search'
type FilterToken = {
  kind: 'capability' | 'type'
  value: string
  label: string
}

type BatchAction = 'enable' | 'disable'

type FacetOption<Value extends string> = {
  value: Value
  label: string
  icon: string
  count: number
}

type FacetCounts = {
  total: number
  capabilities: Record<ModelCapabilityKey, number>
  types: Partial<Record<ModelType, number>>
}

const CAPABILITY_ORDER: ModelCapabilityKey[] = ['vision', 'functionCall', 'reasoning', 'search']
const TYPE_ORDER: ModelType[] = [
  ModelType.Chat,
  ModelType.Embedding,
  ModelType.Rerank,
  ModelType.ImageGeneration
]

const CAPABILITY_ICONS: Record<ModelCapabilityKey, string> = {
  vision: 'lucide:eye',
  functionCall: 'lucide:function-square',
  reasoning: 'lucide:brain',
  search: 'lucide:globe'
}

const TYPE_ICONS: Record<ModelType, string> = {
  [ModelType.Chat]: 'lucide:messages-square',
  [ModelType.Embedding]: 'lucide:database',
  [ModelType.Rerank]: 'lucide:arrow-up-wide-narrow',
  [ModelType.ImageGeneration]: 'lucide:image'
}

const props = defineProps<{
  providerModels: { providerId: string; models: RENDERER_MODEL_META[] }[]
  customModels: RENDERER_MODEL_META[]
  providers: { id: string; name: string }[]
  isLoading?: boolean
  stickyOffset?: number
}>()

const isLoading = computed(() => props.isLoading ?? false)
const newProviderModel = computed(() => {
  return props.providers?.[0].id ?? ''
})

const filterPopoverOpen = ref(false)
const sortPopoverOpen = ref(false)
const filterState = reactive({
  sort: 'status' as ModelSortKey,
  capabilities: [] as ModelCapabilityKey[],
  types: [] as ModelType[]
})

const emit = defineEmits<{
  enabledChange: [model: RENDERER_MODEL_META, enabled: boolean]
  'config-changed': []
}>()

const stickyBaseOffset = computed(() => props.stickyOffset ?? 0)

const syncSearchQuery = useDebounceFn((value: string) => {
  debouncedSearchQuery.value = value
}, 180)

watch(
  modelSearchQuery,
  (value) => {
    syncSearchQuery(value)
  },
  { immediate: true }
)

const normalizedSearchQuery = computed(() => debouncedSearchQuery.value.trim().toLowerCase())

const getModelTypeValue = (model: RENDERER_MODEL_META): ModelType => model.type ?? ModelType.Chat

const hasModelCapability = (model: RENDERER_MODEL_META, capability: ModelCapabilityKey) => {
  switch (capability) {
    case 'vision':
      return !!model.vision
    case 'functionCall':
      return !!model.functionCall
    case 'reasoning':
      return !!model.reasoning
    case 'search':
      return !!model.enableSearch
  }
}

const getModelTypeLabel = (type: ModelType) => t(`model.filter.typeOptions.${type}`)
const getCapabilityLabel = (capability: ModelCapabilityKey) =>
  t(`model.filter.capabilityOptions.${capability}`)

const createFacetCounts = (): FacetCounts => ({
  total: 0,
  capabilities: {
    vision: 0,
    functionCall: 0,
    reasoning: 0,
    search: 0
  },
  types: {}
})

const addModelToFacetCounts = (counts: FacetCounts, model: RENDERER_MODEL_META) => {
  counts.total += 1
  if (model.vision) counts.capabilities.vision += 1
  if (model.functionCall) counts.capabilities.functionCall += 1
  if (model.reasoning) counts.capabilities.reasoning += 1
  if (model.enableSearch) counts.capabilities.search += 1

  const type = getModelTypeValue(model)
  counts.types[type] = (counts.types[type] ?? 0) + 1
}

const facetCounts = computed(() => {
  const counts = createFacetCounts()
  for (const model of props.customModels) {
    addModelToFacetCounts(counts, model)
  }

  for (const provider of props.providerModels) {
    for (const model of provider.models) {
      addModelToFacetCounts(counts, model)
    }
  }

  return counts
})

const totalModelCount = computed(() => facetCounts.value.total)

const capabilityFilterOptions = computed<FacetOption<ModelCapabilityKey>[]>(() =>
  CAPABILITY_ORDER.map((capability) => ({
    value: capability,
    label: getCapabilityLabel(capability),
    icon: CAPABILITY_ICONS[capability],
    count: facetCounts.value.capabilities[capability]
  })).filter((option) => option.count > 0)
)

const typeFilterOptions = computed<FacetOption<ModelType>[]>(() =>
  TYPE_ORDER.map((type) => ({
    value: type,
    label: getModelTypeLabel(type),
    icon: TYPE_ICONS[type],
    count: facetCounts.value.types[type] ?? 0
  })).filter((option) => option.count > 0)
)

const sortOptions = computed(() => [
  { value: 'status' as ModelSortKey, label: t('model.sort.status') },
  { value: 'name' as ModelSortKey, label: t('model.sort.name') }
])

const currentSortLabel = computed(() => t(`model.sort.${filterState.sort}`))
const sortState = computed(() => filterState.sort)
const selectedCapabilities = computed(() => filterState.capabilities)
const selectedTypes = computed(() => filterState.types)
const activeAdvancedFilterCount = computed(
  () => filterState.capabilities.length + filterState.types.length
)

const activeFilterTokens = computed<FilterToken[]>(() => {
  const tokens: FilterToken[] = []

  filterState.capabilities.forEach((capability) => {
    tokens.push({
      kind: 'capability',
      value: capability,
      label: getCapabilityLabel(capability)
    })
  })

  filterState.types.forEach((type) => {
    tokens.push({
      kind: 'type',
      value: type,
      label: getModelTypeLabel(type)
    })
  })

  return tokens
})

const hasListRefinements = computed(
  () => normalizedSearchQuery.value.length > 0 || activeAdvancedFilterCount.value > 0
)

const matchesSearch = (model: RENDERER_MODEL_META) => {
  const query = normalizedSearchQuery.value
  if (!query) {
    return true
  }

  return (
    model.name.toLowerCase().includes(query) ||
    model.id.toLowerCase().includes(query) ||
    (!!model.group && model.group.toLowerCase().includes(query)) ||
    (!!model.description && model.description.toLowerCase().includes(query))
  )
}

const matchesAdvancedFilters = (model: RENDERER_MODEL_META) => {
  const type = getModelTypeValue(model)

  if (
    filterState.capabilities.length > 0 &&
    !filterState.capabilities.some((capability) => hasModelCapability(model, capability))
  ) {
    return false
  }

  if (filterState.types.length > 0 && !filterState.types.includes(type)) {
    return false
  }

  return true
}

const statusSortWeight = (model: RENDERER_MODEL_META) => (model.enabled ? 0 : 1)

const getModelKey = (model: RENDERER_MODEL_META) => `${model.providerId}:${model.id}`
const statusSortOrder = ref<Record<string, number>>({})
const providerBatchPending = ref<Record<string, BatchAction | undefined>>({})
const virtualItemCache = new Map<string, VirtualModelListItem>()

const modelStructureFingerprint = (model: RENDERER_MODEL_META) =>
  [
    model.providerId,
    model.id,
    model.name,
    model.group,
    model.type ?? ModelType.Chat,
    model.vision ? '1' : '0',
    model.functionCall ? '1' : '0',
    model.reasoning ? '1' : '0',
    model.enableSearch ? '1' : '0'
  ].join('\u001f')

const modelStructureKeys = computed(() => [
  ...props.customModels.map(modelStructureFingerprint),
  ...props.providerModels.flatMap((provider) => provider.models.map(modelStructureFingerprint))
])

const buildStatusSortOrder = () => {
  const models = [
    ...props.customModels,
    ...props.providerModels.flatMap((provider) => provider.models)
  ]
  const nextOrder: Record<string, number> = {}
  const orderedModels = [...models].sort((left, right) => {
    const statusDifference = statusSortWeight(left) - statusSortWeight(right)
    if (statusDifference !== 0) {
      return statusDifference
    }

    return modelNameCollator.compare(left.name, right.name)
  })

  orderedModels.forEach((model, index) => {
    nextOrder[getModelKey(model)] = index
  })

  statusSortOrder.value = nextOrder
}

watch(modelStructureKeys, buildStatusSortOrder, { immediate: true })

const sortModels = (models: RENDERER_MODEL_META[]) =>
  [...models].sort((left, right) => {
    if (filterState.sort === 'name') {
      return modelNameCollator.compare(left.name, right.name)
    }

    const leftRank = statusSortOrder.value[getModelKey(left)]
    const rightRank = statusSortOrder.value[getModelKey(right)]

    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) {
        return 1
      }

      if (rightRank === undefined) {
        return -1
      }

      if (leftRank !== rightRank) {
        return leftRank - rightRank
      }
    }

    return modelNameCollator.compare(left.name, right.name)
  })

const filterAndSortModels = (models: RENDERER_MODEL_META[]) =>
  sortModels(models.filter((model) => matchesSearch(model) && matchesAdvancedFilters(model)))

const filteredProviderModels = computed(() => {
  const start = getPerfNow()
  const result = props.providerModels
    .map((provider) => ({
      providerId: provider.providerId,
      models: filterAndSortModels(provider.models)
    }))
    .filter((provider) => provider.models.length > 0)

  logModelTogglePerf('list.filtered-provider-models', {
    providerCount: result.length,
    visibleModels: result.reduce((total, provider) => total + provider.models.length, 0),
    elapsedMs: Math.round(getPerfNow() - start),
    hasRefinements: hasListRefinements.value
  })

  return result
})

const filteredCustomModels = computed(() => filterAndSortModels(props.customModels))

const visibleModelCount = computed(
  () =>
    filteredCustomModels.value.length +
    filteredProviderModels.value.reduce((total, provider) => total + provider.models.length, 0)
)

type VirtualModelListItem =
  | { id: string; type: 'label'; label: string; size: number }
  | { id: string; type: 'provider-actions'; providerId: string; size: number }
  | {
      id: string
      type: 'model'
      size: number
      providerId: string
      modelId: string
      name: string
      enabled: boolean
      vision: boolean
      functionCall: boolean
      reasoning: boolean
      enableSearch: boolean
      typeValue: ModelType
      group: string
      contextLength: number
      maxTokens: number
      isCustom: boolean
      supportedEndpointTypes: RENDERER_MODEL_META['supportedEndpointTypes']
      endpointType: RENDERER_MODEL_META['endpointType']
    }

const getCachedVirtualItem = <TItem extends VirtualModelListItem>(
  id: string,
  factory: () => TItem,
  apply: (item: TItem) => void
): TItem => {
  const existing = virtualItemCache.get(id)
  if (existing) {
    const typedExisting = existing as TItem
    apply(typedExisting)
    return typedExisting
  }

  const nextItem = factory()
  apply(nextItem)
  virtualItemCache.set(id, nextItem)
  return nextItem
}

const syncVirtualItemCache = (activeIds: Set<string>) => {
  for (const id of virtualItemCache.keys()) {
    if (!activeIds.has(id)) {
      virtualItemCache.delete(id)
    }
  }
}

const createLabelItem = (label: string) =>
  getCachedVirtualItem(
    'label-official',
    () => ({ id: 'label-official', type: 'label', label, size: LABEL_ITEM_HEIGHT }),
    (item) => {
      item.label = label
      item.size = LABEL_ITEM_HEIGHT
    }
  )

const createProviderActionsItem = (providerId: string) =>
  getCachedVirtualItem(
    `${providerId}-actions`,
    () => ({
      id: `${providerId}-actions`,
      type: 'provider-actions',
      providerId,
      size: PROVIDER_ACTIONS_ITEM_HEIGHT
    }),
    (item) => {
      item.providerId = providerId
      item.size = PROVIDER_ACTIONS_ITEM_HEIGHT
    }
  )

const createModelItem = (model: RENDERER_MODEL_META) =>
  getCachedVirtualItem(
    `${model.providerId}-${model.id}`,
    () => ({
      id: `${model.providerId}-${model.id}`,
      type: 'model',
      size: MODEL_ITEM_HEIGHT,
      providerId: model.providerId,
      modelId: model.id,
      name: model.name,
      enabled: model.enabled ?? false,
      vision: model.vision ?? false,
      functionCall: model.functionCall ?? false,
      reasoning: model.reasoning ?? false,
      enableSearch: model.enableSearch ?? false,
      typeValue: model.type ?? ModelType.Chat,
      group: model.group,
      contextLength: model.contextLength,
      maxTokens: model.maxTokens,
      isCustom: model.isCustom ?? false,
      supportedEndpointTypes: model.supportedEndpointTypes,
      endpointType: model.endpointType
    }),
    (item) => {
      item.size = MODEL_ITEM_HEIGHT
      item.providerId = model.providerId
      item.modelId = model.id
      item.name = model.name
      item.enabled = model.enabled ?? false
      item.vision = model.vision ?? false
      item.functionCall = model.functionCall ?? false
      item.reasoning = model.reasoning ?? false
      item.enableSearch = model.enableSearch ?? false
      item.typeValue = model.type ?? ModelType.Chat
      item.group = model.group
      item.contextLength = model.contextLength
      item.maxTokens = model.maxTokens
      item.isCustom = model.isCustom ?? false
      item.supportedEndpointTypes = model.supportedEndpointTypes
      item.endpointType = model.endpointType
    }
  )

const virtualItems = computed<VirtualModelListItem[]>(() => {
  const start = getPerfNow()
  const items: VirtualModelListItem[] = []
  const activeIds = new Set<string>()
  let officialLabelInserted = false
  filteredProviderModels.value.forEach((provider) => {
    if (provider.models.length === 0) {
      return
    }

    if (!officialLabelInserted) {
      const labelItem = createLabelItem(t('model.type.official'))
      items.push(labelItem)
      activeIds.add(labelItem.id)
      officialLabelInserted = true
    }

    if (!hasListRefinements.value) {
      const providerActionsItem = createProviderActionsItem(provider.providerId)
      items.push(providerActionsItem)
      activeIds.add(providerActionsItem.id)
    }

    provider.models.forEach((model) => {
      const modelItem = createModelItem(model)
      items.push(modelItem)
      activeIds.add(modelItem.id)
    })
  })

  syncVirtualItemCache(activeIds)

  logModelTogglePerf('list.virtual-items', {
    itemCount: items.length,
    elapsedMs: Math.round(getPerfNow() - start),
    hasRefinements: hasListRefinements.value
  })

  return items
})

const isLabelItem = (item: unknown): item is Extract<VirtualModelListItem, { type: 'label' }> => {
  return (
    typeof item === 'object' && item !== null && (item as VirtualModelListItem).type === 'label'
  )
}

const isProviderActionsItem = (
  item: unknown
): item is Extract<VirtualModelListItem, { type: 'provider-actions' }> => {
  return (
    typeof item === 'object' &&
    item !== null &&
    (item as VirtualModelListItem).type === 'provider-actions'
  )
}

const isModelItem = (item: unknown): item is Extract<VirtualModelListItem, { type: 'model' }> => {
  return (
    typeof item === 'object' && item !== null && (item as VirtualModelListItem).type === 'model'
  )
}

const getProviderName = (providerId: string) => {
  const provider = props.providers.find((p) => p.id === providerId)
  return provider?.name || providerId
}

const getProviderPendingAction = (providerId: string) => providerBatchPending.value[providerId]

const isProviderBatchPending = (providerId: string) =>
  getProviderPendingAction(providerId) !== undefined

const setProviderBatchPending = (providerId: string, action?: BatchAction) => {
  const nextPending = { ...providerBatchPending.value }
  if (action) {
    nextPending[providerId] = action
  } else {
    delete nextPending[providerId]
  }
  providerBatchPending.value = nextPending
}

const getBatchTargetModels = (providerId: string) => {
  const providerModels =
    filteredProviderModels.value.find((provider) => provider.providerId === providerId)?.models ??
    []
  const providerCustomModels = filteredCustomModels.value.filter(
    (model) => model.providerId === providerId
  )

  if (providerCustomModels.length === 0) {
    return providerModels
  }

  const dedupedModels = new Map<string, RENDERER_MODEL_META>()
  for (const model of providerModels) {
    dedupedModels.set(getModelKey(model), model)
  }

  for (const model of providerCustomModels) {
    dedupedModels.set(getModelKey(model), model)
  }

  return Array.from(dedupedModels.values())
}

const toRendererModel = (
  item: Extract<VirtualModelListItem, { type: 'model' }>
): RENDERER_MODEL_META => ({
  id: item.modelId,
  name: item.name,
  contextLength: item.contextLength,
  maxTokens: item.maxTokens,
  group: item.group,
  providerId: item.providerId,
  enabled: item.enabled,
  isCustom: item.isCustom,
  vision: item.vision,
  functionCall: item.functionCall,
  reasoning: item.reasoning,
  enableSearch: item.enableSearch,
  type: item.typeValue,
  supportedEndpointTypes: item.supportedEndpointTypes,
  endpointType: item.endpointType
})

const handleModelEnabledChange = (model: RENDERER_MODEL_META, enabled: boolean) => {
  emit('enabledChange', model, enabled)
}

const handleCustomModelEnabledChange = (model: RENDERER_MODEL_META, enabled: boolean) => {
  handleModelEnabledChange(model, enabled)
}

const handleVirtualModelEnabledChange = (
  item: Extract<VirtualModelListItem, { type: 'model' }>,
  enabled: boolean
) => {
  handleModelEnabledChange(toRendererModel(item), enabled)
}

const emitConfigChanged = () => {
  emit('config-changed')
}

const handleDeleteCustomModel = async (model: RENDERER_MODEL_META) => {
  try {
    await modelStore.removeCustomModel(model.providerId, model.id)
  } catch (error) {
    console.error('Failed to delete custom model:', error)
  }
}

const toggleCapabilityFilter = (capability: ModelCapabilityKey) => {
  filterState.capabilities = filterState.capabilities.includes(capability)
    ? filterState.capabilities.filter((item) => item !== capability)
    : [...filterState.capabilities, capability]
}

const toggleTypeFilter = (type: ModelType) => {
  filterState.types = filterState.types.includes(type)
    ? filterState.types.filter((item) => item !== type)
    : [...filterState.types, type]
}

const clearAdvancedFilters = () => {
  filterState.capabilities = []
  filterState.types = []
}

const clearAllFilters = () => {
  clearAdvancedFilters()
}

const removeFilterToken = (token: FilterToken) => {
  if (token.kind === 'capability') {
    filterState.capabilities = filterState.capabilities.filter((item) => item !== token.value)
    return
  }

  filterState.types = filterState.types.filter((item) => item !== token.value)
}

const setSort = (sort: ModelSortKey) => {
  if (sort === 'status') {
    buildStatusSortOrder()
  }
  filterState.sort = sort
  sortPopoverOpen.value = false
}

// 启用提供商下所有模型
const enableAllModels = async (providerId: string) => {
  if (isProviderBatchPending(providerId)) {
    return
  }

  setProviderBatchPending(providerId, 'enable')
  try {
    await modelStore.enableAllModels(providerId, getBatchTargetModels(providerId))
  } catch (error) {
    console.error(`Failed to enable all models for provider ${providerId}:`, error)
  } finally {
    setProviderBatchPending(providerId)
  }
}

// 禁用提供商下所有模型
const disableAllModels = async (providerId: string) => {
  if (isProviderBatchPending(providerId)) {
    return
  }

  setProviderBatchPending(providerId, 'disable')
  try {
    await modelStore.disableAllModels(providerId, getBatchTargetModels(providerId))
  } catch (error) {
    console.error(`Failed to disable all models for provider ${providerId}:`, error)
  } finally {
    setProviderBatchPending(providerId)
  }
}

const searchContainerRef = ref<HTMLElement | null>(null)
const { height: searchContainerHeight } = useElementSize(searchContainerRef)
const searchStickyTop = computed(() => stickyBaseOffset.value)
const customLabelStickyTop = computed(() => {
  if (filteredCustomModels.value.length === 0) {
    return stickyBaseOffset.value
  }
  return stickyBaseOffset.value + (searchContainerHeight.value || 53) + 8
})

const stickyHeaderInfo = ref<{
  provider?: { providerId: string }
}>({})

const updateStickyHeader = (startIndex: number) => {
  if (startIndex < 0 || startIndex >= virtualItems.value.length) return

  const currentItem = virtualItems.value[startIndex]
  let providerItem: { providerId: string } | undefined

  if (currentItem.type === 'model' || currentItem.type === 'provider-actions') {
    providerItem = { providerId: currentItem.providerId }
  }

  stickyHeaderInfo.value = {
    provider: providerItem
  }
}

watch(
  virtualItems,
  () => {
    updateStickyHeader(0)
  },
  { immediate: true }
)
</script>
