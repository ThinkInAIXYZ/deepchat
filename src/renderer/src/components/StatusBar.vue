<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@shadcn/components/ui/select'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'
import { useNewThreadStatusBar } from '@/composables/useNewThreadStatusBar'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { useThemeStore } from '@/stores/theme'
import { useChatStore } from '@/stores/chat'
import ScrollablePopover from '@/components/ScrollablePopover.vue'
import ChatConfig from '@/components/ChatConfig.vue'

const { t } = useI18n()
const themeStore = useThemeStore()
const chatStore = useChatStore()

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

const getModelIcon = (model: { id: string }) => {
  const modelId = model.id.toLowerCase()
  if (modelId.includes('claude')) return 'simple-icons:anthropic'
  if (modelId.includes('gpt') || modelId.includes('o1') || modelId.includes('o3'))
    return 'simple-icons:openai'
  if (modelId.includes('gemini')) return 'simple-icons:googlegemini'
  if (modelId.includes('deepseek')) return 'simple-icons:deepseek'
  return 'lucide:bot'
}

function handleModelChange(id: string) {
  const model = enabledModels.value.find((item) => item.id === id)
  if (model) {
    void selectModel(model)
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
          :model-value="activeModel.id"
          @update:model-value="(v) => handleModelChange(v as string)"
        >
          <SelectTrigger
            class="h-8 w-auto min-w-0 border-none bg-transparent hover:bg-accent/50 text-sm gap-1 px-2"
          >
            <Icon :icon="getModelIcon(activeModel)" class="size-4 text-muted-foreground" />
            <span class="truncate max-w-[120px]">{{ displayModelName }}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="model in enabledModels"
              :key="model.id"
              :value="model.id"
              class="cursor-pointer"
            >
              <div class="flex items-center gap-2">
                <Icon :icon="getModelIcon(model)" class="size-4 text-muted-foreground" />
                <span>{{ model.name.split('/').pop() ?? model.name }}</span>
              </div>
            </SelectItem>
            <div v-if="enabledModels.length === 0" class="px-2 py-4 text-sm text-muted-foreground">
              {{ t('newThread.noModels') }}
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
