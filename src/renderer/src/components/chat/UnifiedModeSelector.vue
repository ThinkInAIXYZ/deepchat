<template>
  <!-- Only render when agent supports modes -->
  <div v-if="supportsModes && availableModes.length > 0">
    <Tooltip>
      <TooltipTrigger as-child>
        <span class="inline-flex">
          <Popover v-model:open="open">
            <PopoverTrigger as-child>
              <Button
                variant="ghost"
                :disabled="loading"
                class="flex items-center gap-1 h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <Icon icon="lucide:shield" class="w-4 h-4" />
                <span class="truncate max-w-[120px] text-foreground" :title="currentModeName">
                  {{ currentModeName }}
                </span>
                <Icon icon="lucide:chevron-down" class="w-4 h-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" class="w-64 border-none bg-transparent p-0 shadow-none">
              <div class="rounded-lg border bg-card p-1 shadow-md max-h-56 overflow-y-auto">
                <div
                  v-for="mode in availableModes"
                  :key="mode.id"
                  :class="[
                    'flex flex-col rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
                    currentModeId === mode.id
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted',
                    loading ? 'opacity-60 cursor-not-allowed' : ''
                  ]"
                  @click="handleModeSelect(mode.id)"
                >
                  <div class="flex items-center gap-2">
                    <Icon icon="lucide:shield" class="w-4 h-4" />
                    <span class="flex-1 font-medium">{{ mode.name || mode.id }}</span>
                    <Icon v-if="currentModeId === mode.id" icon="lucide:check" class="w-4 h-4" />
                  </div>
                  <p
                    v-if="showDescription && mode.description"
                    :class="[
                      'text-xs mt-1 ml-6',
                      currentModeId === mode.id
                        ? 'text-primary-foreground/70'
                        : 'text-muted-foreground'
                    ]"
                  >
                    {{ mode.description }}
                  </p>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </span>
      </TooltipTrigger>
      <TooltipContent class="max-w-xs">
        <p class="text-xs font-semibold">{{ modeTypeLabel }}</p>
        <p class="text-xs text-muted-foreground mt-1">
          {{ modeTypeTooltip }}
        </p>
        <p v-if="currentModeInfo?.description" class="text-xs text-muted-foreground mt-1">
          {{ currentModeInfo.description }}
        </p>
      </TooltipContent>
    </Tooltip>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { useAgenticSession } from '@/composables/agentic/useAgenticSession'
import { usePresenter } from '@/composables/usePresenter'

interface Props {
  sessionId: string
  showDescription?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showDescription: false
})

const emit = defineEmits<{
  'mode-select': [modeId: string]
}>()

const { t } = useI18n()
const open = ref(false)
const agenticP = usePresenter('agenticPresenter')

// Use agentic session composable for data
const { agentId, availableModes, currentModeId, isGenerating, supportsModes } = useAgenticSession(
  props.sessionId
)

const loading = computed(() => isGenerating.value)

// Determine if this is an ACP agent (agentId doesn't contain provider prefix)
const isAcpAgent = computed(() => {
  return !agentId.value?.includes(':')
})

const currentModeInfo = computed(() => {
  return availableModes.value.find((m) => m.id === currentModeId.value)
})

const currentModeName = computed(() => {
  return currentModeInfo.value?.name || currentModeId.value || t('chat.input.modeSelector.default')
})

// Different labels for ACP vs DeepChat agents
const modeTypeLabel = computed(() => {
  return isAcpAgent.value
    ? t('chat.input.modeSelector.acpModeLabel')
    : t('chat.input.modeSelector.policyLabel')
})

const modeTypeTooltip = computed(() => {
  return isAcpAgent.value
    ? t('chat.input.modeSelector.acpModeTooltip', { mode: currentModeName.value })
    : t('chat.input.modeSelector.policyTooltip', { policy: currentModeName.value })
})

const handleModeSelect = async (modeId: string) => {
  if (loading.value) return

  try {
    await agenticP.setMode(props.sessionId, modeId)
    emit('mode-select', modeId)
    open.value = false
  } catch (error) {
    console.error('[UnifiedModeSelector] Failed to set mode:', error)
  }
}
</script>
