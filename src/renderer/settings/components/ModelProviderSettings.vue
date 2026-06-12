<template>
  <div v-if="showProviderSkeleton" class="w-full h-full flex flex-row animate-pulse">
    <div class="w-80 h-full border-r p-4 space-y-3">
      <div class="h-9 rounded-md bg-muted/60"></div>
      <div
        v-for="index in 8"
        :key="`provider-skeleton-${index}`"
        class="h-10 rounded-lg bg-muted/40"
      ></div>
      <div class="pt-2">
        <div class="h-10 rounded-lg bg-muted/50"></div>
      </div>
    </div>
    <div class="flex-1 p-6 space-y-4">
      <div class="h-6 w-48 rounded-md bg-muted/50"></div>
      <div class="h-24 rounded-xl bg-muted/40"></div>
      <div class="grid grid-cols-2 gap-4">
        <div class="h-20 rounded-xl bg-muted/40"></div>
        <div class="h-20 rounded-xl bg-muted/40"></div>
      </div>
      <div class="h-72 rounded-xl bg-muted/30"></div>
    </div>
  </div>
  <div
    v-else
    ref="guideRootRef"
    data-testid="settings-provider-page"
    class="w-full h-full flex flex-row"
  >
    <ScrollArea class="w-80 border-r h-full">
      <div class="flex flex-col gap-4 p-4">
        <div class="flex flex-col gap-1">
          <h1 class="text-lg font-semibold">{{ t('settings.provider.center.title') }}</h1>
          <p class="text-xs text-muted-foreground">
            {{ t('settings.provider.center.description') }}
          </p>
        </div>
        <div class="sticky top-4 z-10">
          <div class="relative">
            <Input
              v-model="searchQueryBase"
              :placeholder="t('settings.provider.search')"
              class="h-9 pr-8 text-sm backdrop-blur-lg border-border"
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
              class="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground hover:text-foreground"
              @click="clearSearch"
            />
          </div>
        </div>
        <div v-if="enabledProviders.length > 0" class="flex flex-col gap-2">
          <div class="text-xs font-medium text-muted-foreground px-2">
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
                  'flex flex-row hover:bg-accent items-center gap-2 rounded-lg p-2 group',
                  route.params?.providerId === provider.id ? 'bg-accent text-accent-foreground' : ''
                ]"
                @click="handleProviderRowClick(provider.id)"
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
                <input
                  v-if="editingProviderId === provider.id"
                  ref="editInputRef"
                  v-model="editingName"
                  class="text-sm font-medium flex-1 min-w-0 bg-background border border-input rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-ring"
                  :dir="languageStore.dir"
                  @blur="saveEditingName"
                  @keydown="handleEditKeydown"
                  @click.stop
                />
                <template v-else>
                  <span
                    class="text-sm font-medium flex-1 min-w-0 truncate"
                    :dir="languageStore.dir"
                    >{{ t(provider.name) }}</span
                  >
                  <Icon
                    v-if="provider.custom"
                    icon="lucide:pencil"
                    class="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-60 hover:opacity-100! shrink-0"
                    @click="startEditingName(provider, $event)"
                  />
                </template>
                <Switch
                  :model-value="provider.enable"
                  @click.stop="toggleProviderStatus(provider)"
                />
              </div>
            </template>
          </draggable>
        </div>

        <div v-if="disabledProviders.length > 0" class="flex flex-col gap-2">
          <div class="text-xs font-medium text-muted-foreground px-2">
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
                  'flex flex-row hover:bg-accent items-center gap-2 rounded-lg p-2 group opacity-60',
                  route.params?.providerId === provider.id ? 'bg-accent text-accent-foreground' : ''
                ]"
                @click="handleProviderRowClick(provider.id)"
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
                <input
                  v-if="editingProviderId === provider.id"
                  ref="editInputRef"
                  v-model="editingName"
                  class="text-sm font-medium flex-1 min-w-0 bg-background border border-input rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-ring"
                  :dir="languageStore.dir"
                  @blur="saveEditingName"
                  @keydown="handleEditKeydown"
                  @click.stop
                />
                <template v-else>
                  <span
                    class="text-sm font-medium flex-1 min-w-0 truncate"
                    :dir="languageStore.dir"
                    >{{ t(provider.name) }}</span
                  >
                  <Icon
                    v-if="provider.custom"
                    icon="lucide:pencil"
                    class="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-60 hover:opacity-100! shrink-0"
                    @click="startEditingName(provider, $event)"
                  />
                </template>
                <Switch
                  :model-value="provider.enable"
                  @click.stop="toggleProviderStatus(provider)"
                />
              </div>
            </template>
          </draggable>
        </div>

        <div class="sticky bottom-4 z-10" :dir="languageStore.dir">
          <Button
            data-testid="provider-add-button"
            variant="outline"
            class="w-full flex flex-row items-center gap-2 rounded-lg p-2 backdrop-blur-lg hover:bg-accent"
            @click="openAddProviderDialog"
          >
            <Icon icon="lucide:plus" class="w-4 h-4 text-muted-foreground" />
            <span class="text-sm font-medium">{{ t('settings.provider.addCustomProvider') }}</span>
          </Button>
        </div>
      </div>
    </ScrollArea>
    <div v-if="activeProvider" ref="providerDetailRef" class="flex min-w-0 flex-1">
      <OllamaProviderSettingsDetail
        v-if="activeProvider.apiType === 'ollama'"
        :key="`ollama-${activeProvider.id}`"
        :provider="activeProvider"
        class="flex-1"
        @provider-configured="handleProviderConfigured"
        @provider-model-enabled="handleProviderModelEnabled"
      />
      <BedrockProviderSettingsDetail
        v-else-if="activeProvider.apiType === 'aws-bedrock'"
        :key="`bedrock-${activeProvider.id}`"
        :provider="activeProvider as AWS_BEDROCK_PROVIDER"
        class="flex-1"
        @provider-configured="handleProviderConfigured"
        @provider-model-enabled="handleProviderModelEnabled"
      />
      <ModelProviderSettingsDetail
        v-else
        :key="`standard-${activeProvider.id}`"
        :provider="activeProvider"
        :active-onboarding-step-id="detailGuideStepId"
        class="flex-1"
        @provider-configured="handleProviderConfigured"
        @provider-model-enabled="handleProviderModelEnabled"
      />
    </div>
    <AddCustomProviderDialog
      v-model:open="isAddProviderDialogOpen"
      @provider-added="handleProviderAdded"
    />
  </div>

  <GuidedOnboardingOverlay
    :visible="showSelectProviderGuide"
    :container-el="guideRootRef"
    :target-el="providerListGuideTargetRef"
    :eyebrow="t('welcome.page.guide.title')"
    :title="t('welcome.provider.select')"
    :description="t('settings.provider.center.description')"
    :step-index="selectProviderGuide.stepIndex.value"
    :total-steps="selectProviderGuide.totalSteps.value"
    :close-label="t('common.close')"
    :back-label="selectProviderGuide.canGoPrevious?.value ? t('common.back') : undefined"
    :expert-label="t('settings.skills.sync.skipAll')"
    :primary-label="t('common.next')"
    :primary-disabled="!canAdvanceProviderSelection"
    @close="selectProviderGuide.dismissGuide"
    @back="handleSelectProviderGuideBack"
    @expert="handleSelectProviderGuideExpert"
    @primary="handleSelectProviderGuidePrimary"
  />

  <GuidedOnboardingOverlay
    :visible="showProviderApiKeyGuide"
    :container-el="guideRootRef"
    :target-el="providerApiKeyTargetRef"
    :eyebrow="t('welcome.page.guide.title')"
    :title="t('welcome.provider.apiKey')"
    :description="t('settings.provider.center.description')"
    :step-index="providerApiKeyGuide.stepIndex.value"
    :total-steps="providerApiKeyGuide.totalSteps.value"
    :close-label="t('common.close')"
    :back-label="providerApiKeyGuide.canGoPrevious?.value ? t('common.back') : undefined"
    :secondary-label="t('settings.skills.syncPrompt.skip')"
    :expert-label="t('settings.skills.sync.skipAll')"
    :primary-label="t('common.next')"
    :primary-disabled="!canAdvanceProviderApiKey"
    @close="providerApiKeyGuide.dismissGuide"
    @back="handleProviderApiKeyGuideBack"
    @secondary="handleProviderApiKeyGuideSkip"
    @expert="handleProviderApiKeyGuideExpert"
    @primary="handleProviderApiKeyGuidePrimary"
  />

  <GuidedOnboardingOverlay
    :visible="showProviderModelGuide"
    :container-el="guideRootRef"
    :target-el="providerModelTargetRef"
    :eyebrow="t('welcome.page.guide.title')"
    :title="t('settings.provider.center.tabs.models')"
    :description="t('settings.provider.center.description')"
    :step-index="providerModelGuide.stepIndex.value"
    :total-steps="providerModelGuide.totalSteps.value"
    :close-label="t('common.close')"
    :back-label="providerModelGuide.canGoPrevious?.value ? t('common.back') : undefined"
    :secondary-label="t('settings.skills.syncPrompt.skip')"
    :expert-label="t('settings.skills.sync.skipAll')"
    :primary-label="t('common.next')"
    :primary-disabled="!canAdvanceProviderModel"
    @close="providerModelGuide.dismissGuide"
    @back="handleProviderModelGuideBack"
    @secondary="handleProviderModelGuideSkip"
    @expert="handleProviderModelGuideExpert"
    @primary="handleProviderModelGuidePrimary"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
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
import { Switch } from '@shadcn/components/ui/switch'
import { Input } from '@shadcn/components/ui/input'
import { Button } from '@shadcn/components/ui/button'
import draggable from 'vuedraggable'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { useThemeStore } from '@/stores/theme'
import { useLanguageStore } from '@/stores/language'
import { useStartupWorkloadStore } from '@/stores/startupWorkloadStore'
import GuidedOnboardingOverlay from '@/components/onboarding/GuidedOnboardingOverlay.vue'
import { useGuidedOnboardingStep } from '@/composables/useGuidedOnboardingStep'
import { createWindowClient } from '@api/WindowClient'
import { continueGuidedOnboardingFromSettings } from '../lib/guidedOnboardingSettings'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const windowClient = createWindowClient()
const languageStore = useLanguageStore()
const providerStore = useProviderStore()
const modelStore = useModelStore()
const themeStore = useThemeStore()
const guideRootRef = ref<HTMLElement | null>(null)
const providerDetailRef = ref<HTMLElement | null>(null)
const providerListGuideTargetRef = ref<HTMLElement | null>(null)
const providerApiKeyTargetRef = ref<HTMLElement | null>(null)
const providerModelTargetRef = ref<HTMLElement | null>(null)
const selectProviderGuide = useGuidedOnboardingStep('select-provider')
const providerApiKeyGuide = useGuidedOnboardingStep('provider-api-key')
const providerModelGuide = useGuidedOnboardingStep('provider-model')
const showSelectProviderGuide = computed(
  () => selectProviderGuide.showGuide.value && Boolean(providerListGuideTargetRef.value)
)
const showProviderApiKeyGuide = computed(
  () => providerApiKeyGuide.showGuide.value && Boolean(providerApiKeyTargetRef.value)
)
const showProviderModelGuide = computed(
  () => providerModelGuide.showGuide.value && Boolean(providerModelTargetRef.value)
)
const detailGuideStepId = computed(() => {
  if (providerModelGuide.currentStepId.value === 'provider-model') {
    return 'provider-model'
  }

  if (providerApiKeyGuide.currentStepId.value === 'provider-api-key') {
    return 'provider-api-key'
  }

  return null
})
const startupWorkloadStore = (() => {
  try {
    return useStartupWorkloadStore()
  } catch {
    return null
  }
})()
const isAddProviderDialogOpen = ref(false)

const continueProviderGuide = async (
  state: Awaited<ReturnType<typeof selectProviderGuide.completeStep>> | null | undefined
) => {
  await continueGuidedOnboardingFromSettings({
    state,
    router,
    currentRoute: route,
    windowClient
  })
}

const handleSelectProviderGuidePrimary = async () => {
  const firstProviderId = visibleProviders.value[0]?.id
  if (firstProviderId && activeProvider.value?.id !== firstProviderId) {
    await setActiveProvider(firstProviderId)
    await nextTick()
  }

  const state = await selectProviderGuide.completeStep()
  await continueProviderGuide(state)
}

const handleSelectProviderGuideBack = async () => {
  const state = await selectProviderGuide.activatePreviousStep()
  await continueProviderGuide(state)
}

const handleSelectProviderGuideExpert = async () => {
  const state = await selectProviderGuide.forceComplete()
  await continueProviderGuide(state)
}

const handleProviderApiKeyGuidePrimary = async () => {
  const state = await providerApiKeyGuide.completeStep()
  await continueProviderGuide(state)
}

const handleProviderApiKeyGuideBack = async () => {
  const state = await providerApiKeyGuide.activatePreviousStep()
  await continueProviderGuide(state)
}

const handleProviderApiKeyGuideSkip = async () => {
  const skippedApiKeyState = await providerApiKeyGuide.skipStep()
  if (skippedApiKeyState?.currentStepId === 'provider-model') {
    const skippedModelState = await providerModelGuide.skipStep()
    await continueProviderGuide(skippedModelState)
    return
  }

  await continueProviderGuide(skippedApiKeyState)
}

const handleProviderApiKeyGuideExpert = async () => {
  const state = await providerApiKeyGuide.forceComplete()
  await continueProviderGuide(state)
}

const handleProviderModelGuidePrimary = async () => {
  const state = await providerModelGuide.completeStep()
  await continueProviderGuide(state)
}

const handleProviderModelGuideBack = async () => {
  const state = await providerModelGuide.activatePreviousStep()
  await continueProviderGuide(state)
}

const handleProviderModelGuideSkip = async () => {
  const state = await providerModelGuide.skipStep()
  await continueProviderGuide(state)
}

const handleProviderModelGuideExpert = async () => {
  const state = await providerModelGuide.forceComplete()
  await continueProviderGuide(state)
}

const handleProviderConfigured = async () => {
  if (providerApiKeyGuide.currentStepId.value !== 'provider-api-key') {
    return
  }

  const stepStatus = providerApiKeyGuide.stepState.value?.status
  if (stepStatus === 'completed' || stepStatus === 'skipped') {
    return
  }

  const state = await providerApiKeyGuide.completeStep()
  await continueProviderGuide(state)
}

const handleProviderModelEnabled = async () => {
  if (providerModelGuide.currentStepId.value !== 'provider-model') {
    return
  }

  const stepStatus = providerModelGuide.stepState.value?.status
  if (stepStatus === 'completed' || stepStatus === 'skipped') {
    return
  }

  const state = await providerModelGuide.completeStep()
  await continueProviderGuide(state)
}

const searchQueryBase = ref('')
const searchQuery = refDebounced(searchQueryBase, 150)
const showClearButton = computed(() => searchQueryBase.value.trim().length > 0)

const editingProviderId = ref<string | null>(null)
const editingName = ref('')
const editInputRef = ref<HTMLInputElement | null>(null)

const startEditingName = (provider: LLM_PROVIDER, event: Event) => {
  event.stopPropagation()
  editingProviderId.value = provider.id
  editingName.value = provider.name
  nextTick(() => {
    editInputRef.value?.focus()
    editInputRef.value?.select()
  })
}

const saveEditingName = async () => {
  if (!editingProviderId.value || !editingName.value.trim()) {
    cancelEditingName()
    return
  }
  const trimmedName = editingName.value.trim()
  const providerId = editingProviderId.value
  editingProviderId.value = null
  await providerStore.updateProviderConfig(providerId, { name: trimmedName })
}

const cancelEditingName = () => {
  editingProviderId.value = null
  editingName.value = ''
}

const handleEditKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    saveEditingName()
  } else if (event.key === 'Escape') {
    cancelEditingName()
  }
}

const clearSearch = () => {
  searchQueryBase.value = ''
}

const filterProviders = (providers: LLM_PROVIDER[]) => {
  if (!searchQuery.value.trim()) {
    return providers
  }
  const query = searchQuery.value.toLowerCase().trim()
  return providers.filter((provider) => t(provider.name).toLowerCase().includes(query))
}

const visibleProviders = computed(() =>
  providerStore.sortedProviders.filter((provider) => provider.id !== 'acp')
)
const canAdvanceProviderSelection = computed(() =>
  Boolean(activeProvider.value ?? visibleProviders.value[0])
)
const canAdvanceProviderApiKey = computed(() => Boolean(activeProvider.value?.apiKey?.trim()))
const getCurrentProviderModels = () => {
  const providerId = typeof route.params.providerId === 'string' ? route.params.providerId : null
  if (!providerId) {
    return []
  }

  const providerModels =
    modelStore.allProviderModels.find((provider) => provider.providerId === providerId)?.models ??
    []
  const customModels =
    modelStore.customModels?.find((provider) => provider.providerId === providerId)?.models ?? []

  return [...providerModels, ...customModels]
}
const canAdvanceProviderModel = computed(() => {
  return getCurrentProviderModels().some((model) => model.enabled)
})
const currentProviderModelGuideSignature = computed(() => {
  const providerId = typeof route.params.providerId === 'string' ? route.params.providerId : ''
  if (!providerId) {
    return ''
  }

  return getCurrentProviderModels()
    .map((model) => `${model.id}:${model.enabled ? '1' : '0'}`)
    .join('|')
})
const showProviderSkeleton = computed(
  () =>
    (!providerStore.initialized ||
      startupWorkloadStore?.isTaskRunning('settings.providers.summary')) &&
    visibleProviders.value.length === 0
)

let guideTargetSyncPending = false
let providerDetailMutationObserver: MutationObserver | null = null

const scheduleGuideTargetSync = () => {
  if (guideTargetSyncPending) {
    return
  }

  guideTargetSyncPending = true
  void nextTick(() => {
    const runSync = () => {
      guideTargetSyncPending = false
      syncGuideTargets()
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => runSync())
      return
    }

    runSync()
  })
}

const stopObservingProviderDetail = () => {
  providerDetailMutationObserver?.disconnect()
  providerDetailMutationObserver = null
}

const observeProviderDetailGuideTargets = () => {
  stopObservingProviderDetail()

  if (
    typeof MutationObserver === 'undefined' ||
    (!providerApiKeyGuide.showGuide.value && !providerModelGuide.showGuide.value) ||
    !providerDetailRef.value
  ) {
    return
  }

  providerDetailMutationObserver = new MutationObserver(() => {
    scheduleGuideTargetSync()
  })

  providerDetailMutationObserver.observe(providerDetailRef.value, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'data-state', 'hidden', 'style']
  })
}

const syncGuideTargets = () => {
  const activeProviderId =
    typeof route.params.providerId === 'string' ? route.params.providerId : null
  const firstProviderId = visibleProviders.value[0]?.id
  const detailRoot = providerDetailRef.value

  providerListGuideTargetRef.value = firstProviderId
    ? (document.querySelector(`[data-provider-id="${firstProviderId}"]`) as HTMLElement | null)
    : null
  providerApiKeyTargetRef.value =
    (detailRoot?.querySelector('[data-testid="provider-api-key-input"]') as HTMLElement | null) ??
    (document.querySelector('[data-testid="provider-api-key-input"]') as HTMLElement | null)
  providerModelTargetRef.value =
    (activeProviderId
      ? ((detailRoot?.querySelector(
          `[data-testid^="provider-model-toggle-${activeProviderId}-"]`
        ) as HTMLElement | null) ??
        (document.querySelector(
          `[data-testid^="provider-model-toggle-${activeProviderId}-"]`
        ) as HTMLElement | null))
      : null) ??
    (detailRoot?.querySelector(
      '[data-testid="provider-models-tab-trigger"]'
    ) as HTMLElement | null) ??
    (document.querySelector('[data-testid="provider-models-tab-trigger"]') as HTMLElement | null)
}

const allEnabledProviders = computed(() => visibleProviders.value.filter((p) => p.enable))
const allDisabledProviders = computed(() => visibleProviders.value.filter((p) => !p.enable))

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
      providerStore.updateProvidersOrder(allProviders)
    } else {
      const allProviders = [...newProviders, ...allDisabledProviders.value]
      providerStore.updateProvidersOrder(allProviders)
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
      providerStore.updateProvidersOrder(allProviders)
    } else {
      const allProviders = [...allEnabledProviders.value, ...newProviders]
      providerStore.updateProvidersOrder(allProviders)
    }
  }
})

const setActiveProvider = (providerId: string) => {
  return router.push({
    name: 'settings-provider',
    params: {
      providerId
    }
  })
}

const handleProviderRowClick = async (providerId: string) => {
  await setActiveProvider(providerId)

  if (selectProviderGuide.currentStepId.value !== 'select-provider') {
    return
  }

  const stepStatus = selectProviderGuide.stepState.value?.status
  if (stepStatus === 'completed' || stepStatus === 'skipped') {
    return
  }

  const firstProviderId = visibleProviders.value[0]?.id
  if (!firstProviderId || providerId !== firstProviderId) {
    return
  }

  await nextTick()
  const state = await selectProviderGuide.completeStep()
  await continueProviderGuide(state)
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
  await providerStore.updateProviderStatus(provider.id, willEnable)
  // 切换状态后，同时打开该服务商的详情页面
  setActiveProvider(provider.id)

  // 仅在开启服务商时滚动
  if (willEnable) {
    await nextTick()
    scrollToProvider(provider.id)
  }
}

const activeProvider = computed(() => {
  const provider = providerStore.providers.find((p) => p.id === route.params.providerId)
  if (provider?.id === 'acp') {
    router.replace({ name: 'settings-acp' })
    return null
  }
  return provider
})

const openAddProviderDialog = () => {
  isAddProviderDialogOpen.value = true
}

const handleProviderAdded = (provider: LLM_PROVIDER) => {
  // 添加成功后，自动选择新添加的provider
  setActiveProvider(provider.id)
}

onMounted(async () => {
  await providerStore.ensureInitialized()
  if (!route.params.providerId && visibleProviders.value.length > 0) {
    setActiveProvider(visibleProviders.value[0].id)
  }

  scheduleGuideTargetSync()
  observeProviderDetailGuideTargets()
})

onBeforeUnmount(() => {
  stopObservingProviderDetail()
})

watch(
  () => route.params.providerId,
  async (providerId) => {
    if (typeof providerId !== 'string' || providerId.length === 0) {
      return
    }

    await modelStore.ensureProviderModelsReady(providerId)
  },
  { immediate: true }
)

watch(
  () =>
    [
      route.params.providerId,
      visibleProviders.value.map((provider) => provider.id).join('|'),
      selectProviderGuide.showGuide.value,
      providerApiKeyGuide.showGuide.value,
      providerModelGuide.showGuide.value,
      activeProvider.value?.apiKey ?? '',
      currentProviderModelGuideSignature.value
    ] as const,
  () => {
    scheduleGuideTargetSync()
  },
  { flush: 'post', immediate: true }
)

watch(
  () =>
    [
      providerDetailRef.value,
      route.params.providerId,
      providerApiKeyGuide.showGuide.value,
      providerModelGuide.showGuide.value
    ] as const,
  () => {
    observeProviderDetailGuideTargets()
    scheduleGuideTargetSync()
  },
  { flush: 'post', immediate: true }
)

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
