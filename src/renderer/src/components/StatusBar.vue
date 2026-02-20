<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger
} from '@shadcn/components/ui/select'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Icon } from '@iconify/vue'
import { useNewThreadStatusBar } from '@/composables/useNewThreadStatusBar'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { useThemeStore } from '@/stores/theme'
import { useChatStore } from '@/stores/chat'
import { useProviderStore } from '@/stores/providerStore'
import ScrollablePopover from '@/components/ScrollablePopover.vue'
import ChatConfig from '@/components/ChatConfig.vue'

const { t } = useI18n()
const themeStore = useThemeStore()
const chatStore = useChatStore()
const providerStore = useProviderStore()

const {
  isAcpAgent,
  acpAgentInfo,
  enabledModels,
  activeModel,
  modelDisplayName,
  selectModel,
  selectedEffort,
  effortOptions,
  selectEffort,
  selectedVerbosity,
  showVerbosity,
  verbosityOptions,
  selectVerbosity,
  selectedPermission,
  selectPermission,
  configSystemPrompt,
  configTemperature,
  configContextLength,
  configMaxTokens,
  configArtifacts,
  configThinkingBudget,
  configReasoningEffort,
  configVerbosity,
  configContextLengthLimit,
  configMaxTokensLimit,
  configModelType
} = useNewThreadStatusBar()

const acpAgentIconId = computed(() => {
  if (!acpAgentInfo.value) return ''
  return acpAgentInfo.value.builtinId || acpAgentInfo.value.id
})

const displayModelName = computed(() => modelDisplayName.value || t('newThread.noModels'))
const modelSearchKeyword = ref('')
const modelValueSeparator = '::'

const activeModelValue = computed(() => {
  if (!activeModel.value.providerId || !activeModel.value.id) return ''
  return `${activeModel.value.providerId}${modelValueSeparator}${activeModel.value.id}`
})

const modelGroups = computed(() => {
  const keyword = modelSearchKeyword.value.trim().toLowerCase()
  const grouped = new Map<string, { providerName: string; models: typeof enabledModels.value }>()

  const providerNameMap = new Map(
    providerStore.sortedProviders.map((provider) => [provider.id, provider.name])
  )
  const providerOrderMap = new Map(
    providerStore.sortedProviders.map((provider, index) => [provider.id, index])
  )

  for (const model of enabledModels.value) {
    if (!model.providerId || model.providerId === 'acp') continue

    const providerName = providerNameMap.get(model.providerId) ?? model.providerId
    const searchText = `${providerName} ${model.name} ${model.id}`.toLowerCase()
    if (keyword && !searchText.includes(keyword)) continue

    if (!grouped.has(model.providerId)) {
      grouped.set(model.providerId, {
        providerName,
        models: []
      })
    }
    grouped.get(model.providerId)!.models.push(model)
  }

  return Array.from(grouped.entries())
    .map(([providerId, entry]) => ({
      providerId,
      providerName: entry.providerName,
      models: entry.models.sort((a, b) => a.name.localeCompare(b.name))
    }))
    .sort((a, b) => {
      const orderA = providerOrderMap.get(a.providerId) ?? Number.MAX_SAFE_INTEGER
      const orderB = providerOrderMap.get(b.providerId) ?? Number.MAX_SAFE_INTEGER
      if (orderA !== orderB) return orderA - orderB
      return a.providerName.localeCompare(b.providerName)
    })
})

const toModelValue = (providerId: string, modelId: string) =>
  `${providerId}${modelValueSeparator}${modelId}`

function handleModelChange(value: string) {
  const separatorIndex = value.indexOf(modelValueSeparator)
  if (separatorIndex < 0) return

  const providerId = value.slice(0, separatorIndex)
  const modelId = value.slice(separatorIndex + modelValueSeparator.length)
  const model = enabledModels.value.find(
    (item) => item.providerId === providerId && item.id === modelId
  )
  if (!model) return
  void selectModel(model)
}

const activeModelIconId = computed(() => {
  if (activeModel.value.providerId) return activeModel.value.providerId
  if (activeModel.value.id) return activeModel.value.id
  return 'default'
})

const hasMatchedModels = computed(() => {
  return modelGroups.value.length > 0
})

const modelEmptyText = computed(() => {
  return t('newThread.noModels')
})

const onModelSearchKeydown = (event: KeyboardEvent) => {
  // Prevent select from hijacking keyboard while typing in search input.
  event.stopPropagation()
}

const clearModelSearch = () => {
  if (modelSearchKeyword.value) {
    modelSearchKeyword.value = ''
  }
}

const formatEffortLabel = (effort?: 'minimal' | 'low' | 'medium' | 'high') => {
  if (!effort) return '-'
  return t(`settings.model.modelConfig.reasoningEffort.options.${effort}`)
}

const formatVerbosityLabel = (verbosity?: 'low' | 'medium' | 'high') => {
  if (!verbosity) return '-'
  return t(`settings.model.modelConfig.verbosity.options.${verbosity}`)
}
</script>

<template>
  <div class="flex items-center gap-4 py-3 px-4 border-t border-border/50">
    <div class="flex items-center gap-2 min-w-0">
      <div
        v-if="isAcpAgent && acpAgentInfo"
        class="flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent/50 text-sm"
      >
        <ModelIcon :model-id="acpAgentIconId" custom-class="size-4" :is-dark="themeStore.isDark" />
        <span class="font-medium truncate max-w-[180px]">{{ acpAgentInfo.name }}</span>
      </div>

      <template v-else>
        <Select
          :model-value="activeModelValue"
          @update:model-value="(v) => handleModelChange(v as string)"
        >
          <SelectTrigger
            class="h-8 w-auto min-w-0 border-none bg-transparent hover:bg-accent/50 text-sm gap-1 px-2"
          >
            <ModelIcon
              :model-id="activeModelIconId"
              custom-class="size-4"
              :is-dark="themeStore.isDark"
            />
            <span class="truncate max-w-[120px]">{{ displayModelName }}</span>
          </SelectTrigger>
          <SelectContent class="w-72">
            <div class="sticky top-0 z-10 border-b border-border/50 bg-popover p-2">
              <Input
                v-model="modelSearchKeyword"
                class="h-8 text-xs"
                :placeholder="t('model.search.placeholder')"
                @keydown="onModelSearchKeydown"
              />
            </div>

            <template v-if="hasMatchedModels">
              <SelectGroup
                v-for="group in modelGroups"
                :key="group.providerId"
                class="pt-1 first:pt-0"
              >
                <SelectLabel class="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  {{ group.providerName }}
                </SelectLabel>
                <SelectItem
                  v-for="model in group.models"
                  :key="`${model.providerId}-${model.id}`"
                  :value="toModelValue(model.providerId, model.id)"
                  class="cursor-pointer"
                >
                  <div class="flex min-w-0 items-center gap-2">
                    <ModelIcon
                      :model-id="model.providerId || model.id"
                      custom-class="size-4"
                      :is-dark="themeStore.isDark"
                    />
                    <span class="truncate">{{ model.name.split('/').pop() ?? model.name }}</span>
                  </div>
                </SelectItem>
              </SelectGroup>
            </template>

            <div v-else class="px-2 py-3 text-xs text-muted-foreground">
              {{ modelEmptyText }}
            </div>

            <div
              v-if="modelSearchKeyword.trim()"
              class="sticky bottom-0 border-t border-border/50 bg-popover px-2 py-1.5 text-right"
            >
              <button
                class="text-[11px] text-muted-foreground hover:text-foreground"
                @click="clearModelSearch"
              >
                {{ t('common.clear') }}
              </button>
            </div>
          </SelectContent>
        </Select>

        <Select
          :model-value="selectedEffort"
          @update:model-value="(v) => selectEffort(v as 'minimal' | 'low' | 'medium' | 'high')"
        >
          <SelectTrigger
            class="h-8 w-auto min-w-0 border-none bg-transparent hover:bg-accent/50 text-sm gap-1 px-2"
          >
            <Icon icon="lucide:zap" class="size-4 text-muted-foreground" />
            <span class="truncate max-w-[140px]">{{ formatEffortLabel(selectedEffort) }}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="effort in effortOptions"
              :key="effort"
              :value="effort"
              class="cursor-pointer"
            >
              {{ formatEffortLabel(effort) }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select
          v-if="showVerbosity"
          :model-value="selectedVerbosity"
          @update:model-value="(v) => selectVerbosity(v as 'low' | 'medium' | 'high')"
        >
          <SelectTrigger
            class="h-8 w-auto min-w-0 border-none bg-transparent hover:bg-accent/50 text-sm gap-1 px-2"
          >
            <Icon icon="lucide:message-square-text" class="size-4 text-muted-foreground" />
            <span class="truncate max-w-[140px]">{{
              formatVerbosityLabel(selectedVerbosity)
            }}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="verbosity in verbosityOptions"
              :key="verbosity"
              :value="verbosity"
              class="cursor-pointer"
            >
              {{ formatVerbosityLabel(verbosity) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </template>
    </div>

    <div class="ml-auto flex items-center gap-2">
      <Select
        :model-value="selectedPermission"
        @update:model-value="(v) => selectPermission(v as 'default' | 'restricted' | 'full')"
      >
        <SelectTrigger
          class="h-8 w-auto min-w-0 border-none bg-transparent hover:bg-accent/50 text-sm gap-1 px-2"
        >
          <Icon icon="lucide:shield" class="size-4 text-muted-foreground" />
          <span class="capitalize">{{ selectedPermission }}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default" class="cursor-pointer">Default</SelectItem>
          <SelectItem value="restricted" class="cursor-pointer">Restricted</SelectItem>
          <SelectItem value="full" class="cursor-pointer">Full Access</SelectItem>
        </SelectContent>
      </Select>

      <ScrollablePopover
        v-if="!isAcpAgent"
        align="end"
        content-class="w-80"
        :enable-scrollable="true"
      >
        <template #trigger>
          <Button
            class="h-8 w-8 rounded-md border border-border/60 hover:border-border"
            size="icon"
            variant="outline"
          >
            <Icon icon="lucide:settings-2" class="w-4 h-4" />
          </Button>
        </template>
        <ChatConfig
          v-model:system-prompt="configSystemPrompt"
          v-model:temperature="configTemperature"
          v-model:context-length="configContextLength"
          v-model:max-tokens="configMaxTokens"
          v-model:artifacts="configArtifacts"
          v-model:thinking-budget="configThinkingBudget"
          v-model:reasoning-effort="configReasoningEffort"
          v-model:verbosity="configVerbosity"
          :context-length-limit="configContextLengthLimit"
          :max-tokens-limit="configMaxTokensLimit"
          :model-id="chatStore.chatConfig.modelId"
          :provider-id="chatStore.chatConfig.providerId"
          :model-type="configModelType"
          :show-system-prompt="false"
        />
      </ScrollablePopover>
    </div>
  </div>
</template>
