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
                    class="justify-between  px-3 text-xs"
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
                    class="justify-between  px-3 text-xs"
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
          @enabled-change="(enabled) => handleModelEnabledChange(model, enabled)"
          @delete-model="() => handleDeleteCustomModel(model)"
          @config-changed="$emit('config-changed')"
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
      <DynamicScroller
        :items="virtualItems"
        :min-item-size="MIN_MODEL_ITEM_HEIGHT"
        key-field="id"
        class="w-full"
        page-mode
        :buffer="500"
      >
        <template #default="{ item, active }">
          <DynamicScrollerItem
            :item="item"
            :active="active"
            :size-dependencies="getScrollerItemSizeDependencies(item)"
          >
            <div v-if="isLabelItem(item)" class="px-3 py-2 text-xs text-muted-foreground">
              {{ item.label }}
            </div>
            <div
              v-else-if="isProviderActionsItem(item)"
              class="flex flex-wrap items-center justify-between gap-3 px-3 py-2 bg-muted/30"
            >
              <div class="text-sm font-medium">{{ getProviderName(item.providerId) }}</div>
              <div class="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  class="text-xs text-normal rounded-lg"
                  @click="enableAllModels(item.providerId)"
                >
                  <Icon icon="lucide:check-circle" class="w-3.5 h-3.5 mr-1" />
                  {{ t('model.actions.enableAll') }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="text-xs text-normal rounded-lg"
                  @click="disableAllModels(item.providerId)"
                >
                  <Icon icon="lucide:x-circle" class="w-3.5 h-3.5 mr-1" />
                  {{ t('model.actions.disableAll') }}
                </Button>
              </div>
            </div>
            <div v-else-if="isModelItem(item)" class="bg-card">
              <ModelConfigItem
                :model-name="item.model.name"
                :model-id="item.model.id"
                :provider-id="item.providerId"
                :enabled="item.model.enabled ?? false"
                :is-custom-model="false"
                :vision="item.model.vision"
                :function-call="item.model.functionCall"
                :reasoning="item.model.reasoning"
                :enable-search="item.model.enableSearch"
                :type="item.model.type ?? ModelType.Chat"
                @enabled-change="(enabled) => handleModelEnabledChange(item.model, enabled)"
                @delete-model="() => handleDeleteCustomModel(item.model)"
                @config-changed="$emit('config-changed')"
              />
            </div>
          </DynamicScrollerItem>
        </template>
      </DynamicScroller>
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
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import { useElementSize } from '@vueuse/core'

import AddCustomModelButton from './AddCustomModelButton.vue'

const { t } = useI18n()
const modelSearchQuery = ref('')
const modelStore = useModelStore()
const MIN_MODEL_ITEM_HEIGHT = 56
const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

type ModelSortKey = 'status' | 'name'
type ModelCapabilityKey = 'vision' | 'functionCall' | 'reasoning' | 'search'
type FilterToken = {
  kind: 'capability' | 'type'
  value: string
  label: string
}

type FacetOption<Value extends string> = {
  value: Value
  label: string
  icon: string
  count: number
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

const normalizedSearchQuery = computed(() => modelSearchQuery.value.trim().toLowerCase())

const getModelTypeValue = (model: RENDERER_MODEL_META): ModelType => model.type ?? ModelType.Chat

const getModelCapabilityValues = (model: RENDERER_MODEL_META): ModelCapabilityKey[] => {
  const capabilities: ModelCapabilityKey[] = []
  if (model.vision) capabilities.push('vision')
  if (model.functionCall) capabilities.push('functionCall')
  if (model.reasoning) capabilities.push('reasoning')
  if (model.enableSearch) capabilities.push('search')
  return capabilities
}

const getModelTypeLabel = (type: ModelType) => t(`model.filter.typeOptions.${type}`)
const getCapabilityLabel = (capability: ModelCapabilityKey) =>
  t(`model.filter.capabilityOptions.${capability}`)

const allModels = computed(() => [
  ...props.customModels,
  ...props.providerModels.flatMap((provider) => provider.models)
])

const totalModelCount = computed(() => allModels.value.length)

const capabilityFilterOptions = computed<FacetOption<ModelCapabilityKey>[]>(() =>
  CAPABILITY_ORDER.map((capability) => ({
    value: capability,
    label: getCapabilityLabel(capability),
    icon: CAPABILITY_ICONS[capability],
    count: allModels.value.filter((model) => getModelCapabilityValues(model).includes(capability))
      .length
  })).filter((option) => option.count > 0)
)

const typeFilterOptions = computed<FacetOption<ModelType>[]>(() =>
  TYPE_ORDER.map((type) => ({
    value: type,
    label: getModelTypeLabel(type),
    icon: TYPE_ICONS[type],
    count: allModels.value.filter((model) => getModelTypeValue(model) === type).length
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
  if (!normalizedSearchQuery.value) {
    return true
  }

  return [model.name, model.id, model.group, model.description]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .some((value) => value.toLowerCase().includes(normalizedSearchQuery.value))
}

const matchesAdvancedFilters = (model: RENDERER_MODEL_META) => {
  const capabilities = getModelCapabilityValues(model)
  const type = getModelTypeValue(model)

  if (
    filterState.capabilities.length > 0 &&
    !filterState.capabilities.some((capability) => capabilities.includes(capability))
  ) {
    return false
  }

  if (filterState.types.length > 0 && !filterState.types.includes(type)) {
    return false
  }

  return true
}

const statusSortWeight = (model: RENDERER_MODEL_META) => (model.enabled ? 0 : 1)

const sortModels = (models: RENDERER_MODEL_META[]) =>
  [...models].sort((left, right) => {
    if (filterState.sort === 'name') {
      return modelNameCollator.compare(left.name, right.name)
    }

    const statusDifference = statusSortWeight(left) - statusSortWeight(right)
    if (statusDifference !== 0) {
      return statusDifference
    }

    return modelNameCollator.compare(left.name, right.name)
  })

const filterAndSortModels = (models: RENDERER_MODEL_META[]) =>
  sortModels(models.filter((model) => matchesSearch(model) && matchesAdvancedFilters(model)))

const filteredProviderModels = computed(() => {
  return props.providerModels
    .map((provider) => ({
      providerId: provider.providerId,
      models: filterAndSortModels(provider.models)
    }))
    .filter((provider) => provider.models.length > 0)
})

const filteredCustomModels = computed(() => filterAndSortModels(props.customModels))

const visibleModelCount = computed(
  () =>
    filteredCustomModels.value.length +
    filteredProviderModels.value.reduce((total, provider) => total + provider.models.length, 0)
)

type VirtualModelListItem =
  | { id: string; type: 'label'; label: string }
  | { id: string; type: 'provider-actions'; providerId: string }
  | {
      id: string
      type: 'model'
      providerId: string
      model: RENDERER_MODEL_META
    }

const virtualItems = computed<VirtualModelListItem[]>(() => {
  const items: VirtualModelListItem[] = []
  let officialLabelInserted = false
  filteredProviderModels.value.forEach((provider) => {
    if (provider.models.length === 0) {
      return
    }

    if (!officialLabelInserted) {
      items.push({ id: 'label-official', type: 'label', label: t('model.type.official') })
      officialLabelInserted = true
    }

    if (!hasListRefinements.value) {
      items.push({
        id: `${provider.providerId}-actions`,
        type: 'provider-actions',
        providerId: provider.providerId
      })
    }

    provider.models.forEach((model) => {
      items.push({
        id: `${provider.providerId}-${model.id}`,
        type: 'model',
        providerId: provider.providerId,
        model
      })
    })
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

const getItemSizeDependencies = (item: VirtualModelListItem) => {
  if (item.type === 'model') {
    return [
      item.model.name,
      item.model.id,
      item.model.enabled,
      item.model.vision,
      item.model.functionCall,
      item.model.reasoning,
      item.model.enableSearch,
      item.model.type
    ]
  }

  if (item.type === 'provider-actions') {
    return [
      item.providerId,
      filteredProviderModels.value.find((p) => p.providerId === item.providerId)?.models.length
    ]
  }

  return [item.label]
}

const getScrollerItemSizeDependencies = (item: unknown) => {
  return getItemSizeDependencies(item as VirtualModelListItem)
}

const getProviderName = (providerId: string) => {
  const provider = props.providers.find((p) => p.id === providerId)
  return provider?.name || providerId
}

const handleModelEnabledChange = (model: RENDERER_MODEL_META, enabled: boolean) => {
  emit('enabledChange', model, enabled)
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
  filterState.sort = sort
  sortPopoverOpen.value = false
}

// 启用提供商下所有模型
const enableAllModels = (providerId: string) => {
  modelStore.enableAllModels(providerId)
}

// 禁用提供商下所有模型
const disableAllModels = (providerId: string) => {
  modelStore.disableAllModels(providerId)
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
