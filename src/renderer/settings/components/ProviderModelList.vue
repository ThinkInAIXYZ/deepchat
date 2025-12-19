<template>
  <div class="flex flex-col w-full gap-4">
    <div
      ref="searchContainerRef"
      class="sticky z-30 backdrop-blur supports-[backdrop-filter]:bg-background/80 py-2 border-b border-border/60 flex gap-2"
      :style="{ top: `${searchStickyTop}px` }"
    >
      <Input
        class="flex-1"
        v-model="modelSearchQuery"
        :placeholder="t('model.search.placeholder')"
      />

      <AddCustomModelButton :provider-id="newProviderModel" @saved="$emit('config-changed')" />
    </div>

    <div v-if="filteredCustomModels.length > 0" class="relative">
      <div
        class="sticky z-20 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-3 py-2 text-xs font-medium text-muted-foreground"
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
            :size-dependencies="getItemSizeDependencies(item)"
          >
            <div v-if="item.type === 'label'" class="px-3 py-2 text-xs text-muted-foreground">
              {{ item.label }}
            </div>
            <div
              v-else-if="item.type === 'provider-actions'"
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
            <div v-else class="bg-card">
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
import { computed, ref, watch } from 'vue'
import { Input } from '@shadcn/components/ui/input'
import { Button } from '@shadcn/components/ui/button'
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

const emit = defineEmits<{
  enabledChange: [model: RENDERER_MODEL_META, enabled: boolean]
  'config-changed': []
}>()

const stickyBaseOffset = computed(() => props.stickyOffset ?? 0)

const filteredProviderModels = computed(() => {
  if (!modelSearchQuery.value) {
    return props.providerModels
  }

  return props.providerModels
    .map((provider) => ({
      providerId: provider.providerId,
      models: provider.models.filter(
        (model) =>
          model.name.toLowerCase().includes(modelSearchQuery.value.toLowerCase()) ||
          model.id.toLowerCase().includes(modelSearchQuery.value.toLowerCase())
      )
    }))
    .filter((provider) => provider.models.length > 0)
})

const filteredCustomModels = computed(() => {
  const customModelsList: RENDERER_MODEL_META[] = []
  for (const model of props.customModels) {
    customModelsList.push(model)
  }

  if (!modelSearchQuery.value) {
    return customModelsList
  }

  const filteredModels: RENDERER_MODEL_META[] = []
  for (const model of customModelsList) {
    if (
      model.name.toLowerCase().includes(modelSearchQuery.value.toLowerCase()) ||
      model.id.toLowerCase().includes(modelSearchQuery.value.toLowerCase())
    ) {
      filteredModels.push(model)
    }
  }
  return filteredModels
})

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

    items.push({
      id: `${provider.providerId}-actions`,
      type: 'provider-actions',
      providerId: provider.providerId
    })

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
