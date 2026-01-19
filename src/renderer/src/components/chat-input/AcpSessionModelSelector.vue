<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        class="flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
        size="sm"
      >
        <ModelIcon :model-id="activeModel.id" :is-dark="isDark" custom-class="w-4 h-4" />
        <span
          class="text-xs font-semibold truncate max-w-[140px] text-foreground"
          :title="modelSelectorLabel"
        >
          {{ modelSelectorLabel }}
        </span>
        <Icon icon="lucide:chevron-right" class="w-4 h-4 text-muted-foreground" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-80 border-none bg-transparent p-0 shadow-none">
      <div class="rounded-lg border bg-card p-1 shadow-md max-h-72 overflow-y-auto">
        <div class="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {{ t('settings.model.acpSession.model.label') }}
        </div>
        <div v-if="!acpSessionModel.hasModels" class="px-2 py-2 text-xs text-muted-foreground">
          {{ t('settings.model.acpSession.model.empty') }}
        </div>
        <div
          v-for="model in acpSessionModel.availableModels"
          :key="model.id"
          :class="[
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
            acpSessionModel.currentModelId === model.id
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted',
            acpSessionModel.loading ? 'opacity-60 cursor-not-allowed' : ''
          ]"
          @click="handleAcpSessionModelSelect(model.id)"
        >
          <Icon icon="lucide:cpu" class="w-4 h-4" />
          <span class="flex-1">{{ model.name || model.id }}</span>
          <Icon
            v-if="acpSessionModel.currentModelId === model.id"
            icon="lucide:check"
            class="w-4 h-4"
          />
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
import ModelIcon from '../icons/ModelIcon.vue'

interface ModelInfo {
  id: string
  providerId: string
}

interface AcpSessionModelState {
  hasModels: boolean
  availableModels: Array<{ id: string; name: string }>
  currentModelId: string | null
  currentModelName: string | null
  loading: boolean
}

const props = defineProps<{
  activeModel: ModelInfo
  acpSessionModel: AcpSessionModelState
  isDark: boolean
}>()

const emit = defineEmits<{
  'acp-session-model-select': [modelId: string]
}>()

const { t } = useI18n()
const open = ref(false)

const modelSelectorLabel = computed(() => {
  if (props.acpSessionModel.currentModelName) {
    return props.acpSessionModel.currentModelName
  }
  return props.acpSessionModel.hasModels
    ? t('settings.model.acpSession.model.placeholder')
    : t('settings.model.acpSession.model.empty')
})

const handleAcpSessionModelSelect = (modelId: string) => {
  if (props.acpSessionModel.loading) return
  emit('acp-session-model-select', modelId)
  open.value = false
}
</script>
