<template>
  <div class="w-full h-full flex flex-row">
    <ScrollArea class="w-64 border-r h-full px-2">
      <div class="space-y-4">
        <!-- 搜索框 -->
        <div class="p-2 sticky top-0 z-10 bg-container">
          <div class="relative">
            <Input
              v-model="searchQueryBase"
              :placeholder="t('settings.provider.search')"
              class="h-8 pr-8"
              @keydown.esc="clearSearch"
            />
            <!-- 搜索图标：在无内容时显示 -->
            <Icon
              v-if="!showClearButton"
              icon="lucide:search"
              class="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
            />
            <!-- 清除按钮：在有内容时显示 -->
            <Icon
              v-else
              icon="lucide:x"
              class="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground cursor-pointer hover:text-foreground"
              @click="clearSearch"
            />
          </div>
        </div>
        <!-- 启用的服务商区域 -->
        <div v-if="enabledProviders.length > 0">
          <div class="text-xs font-medium text-muted-foreground mb-2 px-2">
            {{ t('settings.provider.enabled') }} ({{ enabledProviders.length }})
          </div>
          <draggable
            v-model="enabledProviders"
            item-key="id"
            handle=".drag-handle"
            class="space-y-2"
            group="providers"
            :move="onMoveEnabled"
            @end="handleDragEnd"
          >
            <template #item="{ element: provider }">
              <div
                :data-provider-id="provider.id"
                :class="[
                  'flex flex-row hover:bg-accent items-center gap-2 rounded-lg p-2 cursor-pointer group',
                  route.params?.providerId === provider.id
                    ? 'bg-secondary text-secondary-foreground'
                    : ''
                ]"
                @click="setActiveProvider(provider.id)"
              >
                <Icon
                  icon="lucide:grip-vertical"
                  class="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-move drag-handle"
                />
                <ModelIcon
                  :model-id="provider.id"
                  :custom-class="'w-4 h-4 text-muted-foreground'"
                  :is-dark="themeStore.isDark"
                />
                <span class="text-sm font-medium flex-1" :dir="languageStore.dir">{{
                  t(provider.name)
                }}</span>
                <Switch :checked="provider.enable" @click.stop="toggleProviderStatus(provider)" />
              </div>
            </template>
          </draggable>
        </div>

        <!-- 禁用的服务商区域 -->
        <div v-if="disabledProviders.length > 0">
          <div class="text-xs font-medium text-muted-foreground mb-2 px-2">
            {{ t('settings.provider.disabled') }} ({{ disabledProviders.length }})
          </div>
          <draggable
            v-model="disabledProviders"
            item-key="id"
            handle=".drag-handle"
            class="space-y-2"
            group="providers"
            :move="onMoveDisabled"
            @end="handleDragEnd"
          >
            <template #item="{ element: provider }">
              <div
                :data-provider-id="provider.id"
                :class="[
                  'flex flex-row hover:bg-accent items-center gap-2 rounded-lg p-2 cursor-pointer group opacity-60',
                  route.params?.providerId === provider.id
                    ? 'bg-secondary text-secondary-foreground'
                    : ''
                ]"
                @click="setActiveProvider(provider.id)"
              >
                <Icon
                  icon="lucide:grip-vertical"
                  class="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-move drag-handle"
                />
                <ModelIcon
                  :model-id="provider.id"
                  :custom-class="'w-4 h-4 text-muted-foreground'"
                  :is-dark="themeStore.isDark"
                />
                <span class="text-sm font-medium flex-1" :dir="languageStore.dir">{{
                  t(provider.name)
                }}</span>
                <Switch :checked="provider.enable" @click.stop="toggleProviderStatus(provider)" />
              </div>
            </template>
          </draggable>
        </div>

        <div class="sticky bottom-0 z-10 p-2 bg-container" :dir="languageStore.dir">
          <button
            class="w-full flex flex-row items-center gap-2 rounded-lg p-2 bg-container cursor-pointer hover:bg-accent"
            @click="openAddProviderDialog"
          >
            <Icon icon="lucide:plus" class="w-4 h-4 text-muted-foreground" />
            <span class="text-sm font-medium">{{ t('settings.provider.addCustomProvider') }}</span>
          </button>
        </div>
      </div>
    </ScrollArea>
    <template v-if="activeProvider">
      <OllamaProviderSettingsDetail
        v-if="activeProvider.apiType === 'ollama'"
        :key="`ollama-${activeProvider.id}`"
        :provider="activeProvider"
        class="flex-1"
      />
      <AnthropicProviderSettingsDetail
        v-else-if="activeProvider.id === 'anthropic' || activeProvider.apiType === 'anthropic'"
        :key="`anthropic-${activeProvider.id}`"
        :provider="activeProvider"
        class="flex-1"
        @auth-success="handleAnthropicAuthSuccess"
        @auth-error="handleAnthropicAuthError"
      />
      <BedrockProviderSettingsDetail
        v-else-if="activeProvider.apiType === 'aws-bedrock'"
        :key="`bedrock-${activeProvider.id}`"
        :provider="activeProvider as AWS_BEDROCK_PROVIDER"
        class="flex-1"
      />
      <ModelProviderSettingsDetail
        v-else
        :key="`standard-${activeProvider.id}`"
        :provider="activeProvider"
        class="flex-1"
      />
    </template>
    <AddCustomProviderDialog
      v-model:open="isAddProviderDialogOpen"
      @provider-added="handleProviderAdded"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useRoute, useRouter } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import ModelProviderSettingsDetail from './ModelProviderSettingsDetail.vue'
import OllamaProviderSettingsDetail from './OllamaProviderSettingsDetail.vue'
import BedrockProviderSettingsDetail from './BedrockProviderSettingsDetail.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { Icon } from '@iconify/vue'
import AddCustomProviderDialog from './AddCustomProviderDialog.vue'
import { useI18n } from 'vue-i18n'
import type { AWS_BEDROCK_PROVIDER, LLM_PROVIDER } from '@shared/presenter'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import draggable from 'vuedraggable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useThemeStore } from '@/stores/theme'
import { useLanguageStore } from '@/stores/language'
import AnthropicProviderSettingsDetail from './AnthropicProviderSettingsDetail.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const languageStore = useLanguageStore()
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()
const isAddProviderDialogOpen = ref(false)
const searchQueryBase = ref('')
const searchQuery = refDebounced(searchQueryBase, 150)
const showClearButton = computed(() => searchQueryBase.value.trim().length > 0)

const clearSearch = () => {
  searchQueryBase.value = ''
}

const filterProviders = (providers: LLM_PROVIDER[]) => {
  if (!searchQuery.value.trim()) {
    return providers
  }
  const query = searchQuery.value.toLowerCase().trim()
  return providers.filter(
    (provider) =>
      t(provider.name).toLowerCase().includes(query) ||
      provider.id.toLowerCase().includes(query) ||
      (provider.apiType && provider.apiType.toLowerCase().includes(query))
  )
}

const allEnabledProviders = computed(() => settingsStore.sortedProviders.filter((p) => p.enable))
const allDisabledProviders = computed(() => settingsStore.sortedProviders.filter((p) => !p.enable))

// 分别处理启用和禁用的 providers
const enabledProviders = computed({
  get: () => filterProviders(allEnabledProviders.value),
  set: (newProviders) => {
    const isFiltered = searchQuery.value.trim().length > 0
    if (isFiltered) {
      const orderMap = new Map(newProviders.map((provider, index) => [provider.id, index]))
      const reorderedEnabled = [...allEnabledProviders.value].sort((a, b) => {
        const orderA = orderMap.get(a.id) ?? Infinity
        const orderB = orderMap.get(b.id) ?? Infinity
        return orderA - orderB
      })
      const allProviders = [...reorderedEnabled, ...allDisabledProviders.value]
      settingsStore.updateProvidersOrder(allProviders)
    } else {
      const allProviders = [...newProviders, ...allDisabledProviders.value]
      settingsStore.updateProvidersOrder(allProviders)
    }
  }
})

const disabledProviders = computed({
  get: () => filterProviders(allDisabledProviders.value),
  set: (newProviders) => {
    const isFiltered = searchQuery.value.trim().length > 0
    if (isFiltered) {
      const orderMap = new Map(newProviders.map((provider, index) => [provider.id, index]))
      const reorderedDisabled = [...allDisabledProviders.value].sort((a, b) => {
        const orderA = orderMap.get(a.id) ?? Infinity
        const orderB = orderMap.get(b.id) ?? Infinity
        return orderA - orderB
      })
      const allProviders = [...allEnabledProviders.value, ...reorderedDisabled]
      settingsStore.updateProvidersOrder(allProviders)
    } else {
      const allProviders = [...allEnabledProviders.value, ...newProviders]
      settingsStore.updateProvidersOrder(allProviders)
    }
  }
})

const setActiveProvider = (providerId: string) => {
  router.push({
    name: 'settings-provider',
    params: {
      providerId
    }
  })
}

const scrollToProvider = (providerId: string) => {
  const element = document.querySelector(`[data-provider-id="${providerId}"]`)
  if (element) {
    // 滚动到该服务商的位置
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'end'
    })
  }
}

const toggleProviderStatus = async (provider: LLM_PROVIDER) => {
  const willEnable = !provider.enable
  await settingsStore.updateProviderStatus(provider.id, willEnable)
  // 切换状态后，同时打开该服务商的详情页面
  setActiveProvider(provider.id)

  // 仅在开启服务商时滚动
  if (willEnable) {
    await nextTick()
    scrollToProvider(provider.id)
  }
}

const activeProvider = computed(() => {
  return settingsStore.providers.find((p) => p.id === route.params.providerId)
})

const openAddProviderDialog = () => {
  isAddProviderDialogOpen.value = true
}

const handleProviderAdded = (provider: LLM_PROVIDER) => {
  // 添加成功后，自动选择新添加的provider
  setActiveProvider(provider.id)
}

const handleAnthropicAuthSuccess = async () => {
  // 处理 Anthropic 认证成功后的逻辑
  console.log('Anthropic auth success')
  // 刷新模型列表以获取最新的授权状态
  await settingsStore.refreshAllModels()
}

const handleAnthropicAuthError = (error: string) => {
  // 处理 Anthropic 认证失败后的逻辑
  console.error('Anthropic auth error:', error)
  // 可以在这里添加用户友好的错误提示
}

// 处理拖拽结束事件
const handleDragEnd = () => {
  // 可以在这里添加额外的处理逻辑
}

// 处理启用区域的拖拽移动事件
const onMoveEnabled = (evt: any) => {
  const draggedProvider = evt.draggedContext.element
  const relatedProvider = evt.relatedContext?.element
  if (!draggedProvider || !draggedProvider.enable) {
    return false
  }
  if (relatedProvider && !relatedProvider.enable) {
    return false
  }
  return true
}

// 处理禁用区域的拖拽移动事件
const onMoveDisabled = (evt: any) => {
  const draggedProvider = evt.draggedContext.element
  const relatedProvider = evt.relatedContext?.element
  if (!draggedProvider || draggedProvider.enable) {
    return false
  }
  if (relatedProvider && relatedProvider.enable) {
    return false
  }
  return true
}
</script>

<style scoped>
.drag-handle {
  touch-action: none;
}
</style>
