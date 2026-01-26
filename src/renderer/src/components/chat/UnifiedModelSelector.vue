<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        :disabled="disabled || loading"
        class="flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
        size="sm"
      >
        <ModelIcon
          :model-id="(isAcpAgent ? agentId : currentModelId) ?? ''"
          :is-dark="isDark"
          custom-class="w-4 h-4"
        />
        <span
          class="text-xs font-semibold truncate max-w-[140px] text-foreground"
          :title="modelDisplayName"
        >
          {{ modelDisplayName }}
        </span>
        <Icon icon="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      :portal="false"
      class="border-none bg-transparent p-0 shadow-none w-80"
    >
      <div class="rounded-lg border bg-card p-1 shadow-md max-h-72 overflow-y-auto">
        <div class="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {{ t('chat.input.modelSelector.label') }}
        </div>
        <div v-if="!hasModels" class="px-2 py-2 text-xs text-muted-foreground">
          {{ t('chat.input.modelSelector.empty') }}
        </div>
        <div
          v-for="model in availableModels"
          :key="model.id"
          :class="[
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
            currentModelId === model.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
            loading ? 'opacity-60 cursor-not-allowed' : ''
          ]"
          @click="handleModelSelect(model.id)"
        >
          <Icon :icon="isAcpAgent ? 'lucide:cpu' : 'lucide:sparkles'" class="w-4 h-4" />
          <span class="flex-1 truncate" :title="model.name || model.id">
            {{ displayModelName(model) }}
          </span>
          <Icon v-if="currentModelId === model.id" icon="lucide:check" class="w-4 h-4" />
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { useAgenticSession } from '@/composables/agentic/useAgenticSession'
import { usePresenter } from '@/composables/usePresenter'

interface ModelInfo {
  id: string
  name: string
  description?: string
}

interface Props {
  sessionId: string
  disabled?: boolean
  showProvider?: boolean
  isDark?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  showProvider: true,
  isDark: false
})

const emit = defineEmits<{
  'model-select': [modelId: string]
}>()

const { t } = useI18n()
const open = ref(false)
const agenticP = usePresenter('agenticPresenter')

// Use agentic session composable for data
const { agentId, availableModels, currentModelId, isGenerating } = useAgenticSession(
  props.sessionId
)

const loading = computed(() => isGenerating.value)

const hasModels = computed(() => availableModels.value.length > 0)

// Detect if this is an ACP agent (agentId doesn't contain provider prefix like 'anthropic:')
const isAcpAgent = computed(() => {
  return !agentId.value?.includes(':')
})

const modelDisplayName = computed(() => {
  const current = availableModels.value.find((m) => m.id === currentModelId.value)
  if (current) {
    return displayModelName(current)
  }
  return hasModels.value
    ? t('chat.input.modelSelector.placeholder')
    : t('chat.input.modelSelector.empty')
})

// Display model name with provider prefix for DeepChat models
const displayModelName = (model: ModelInfo): string => {
  if (isAcpAgent.value) {
    // ACP models don't have provider prefix
    return model.name || model.id
  }
  // DeepChat models: add provider prefix if showProvider is true
  if (props.showProvider && model.name && !model.name.includes(':')) {
    const provider = model.id.split(':')[0]
    return `${provider}:${model.name}`
  }
  return model.name || model.id
}

const handleModelSelect = async (modelId: string) => {
  if (loading.value) return

  try {
    await agenticP.setModel(props.sessionId, modelId)
    emit('model-select', modelId)
    open.value = false
  } catch (error) {
    console.error('[UnifiedModelSelector] Failed to set model:', error)
  }
}
</script>
