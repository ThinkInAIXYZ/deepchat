<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span class="inline-flex">
        <Popover v-model:open="open">
          <PopoverTrigger as-child>
            <Button
              variant="ghost"
              class="flex items-center gap-1 h-7 px-2 rounded-md text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
              :disabled="loading"
            >
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
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
                  currentMode === mode.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                  loading ? 'opacity-60 cursor-not-allowed' : ''
                ]"
                @click="handleModeSelect(mode.id)"
              >
                <Icon icon="lucide:shield" class="w-4 h-4" />
                <span class="flex-1">{{ mode.name || mode.id }}</span>
                <Icon v-if="currentMode === mode.id" icon="lucide:check" class="w-4 h-4" />
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </span>
    </TooltipTrigger>
    <TooltipContent class="max-w-xs">
      <p class="text-xs font-semibold">{{ t('chat.input.acpMode') }}</p>
      <p class="text-xs text-muted-foreground mt-1">
        {{ t('chat.input.acpModeTooltip', { mode: currentModeName }) }}
      </p>
      <p v-if="currentModeInfo" class="text-xs text-muted-foreground mt-1">
        {{ currentModeInfo.description }}
      </p>
    </TooltipContent>
  </Tooltip>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'

interface AcpModeInfo {
  id: string
  name: string
  description?: string
}

defineProps<{
  currentMode: string
  currentModeName: string
  currentModeInfo: AcpModeInfo | null
  availableModes: AcpModeInfo[]
  loading: boolean
}>()

const emit = defineEmits<{
  'mode-select': [modeId: string]
}>()

const { t } = useI18n()
const open = ref(false)

const handleModeSelect = (modeId: string) => {
  emit('mode-select', modeId)
  open.value = false
}
</script>
