<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span class="inline-flex">
        <Popover v-model:open="open">
          <PopoverTrigger as-child>
            <Button
              variant="ghost"
              :class="['w-auto h-7 text-xs px-3']"
              size="icon"
              :title="t('chat.mode.current', { mode: currentLabel })"
            >
              <ModelIcon
                v-if="selectedAcpAgentId"
                :model-id="selectedAcpAgentId"
                custom-class="w-4 h-4"
              />
              <Icon v-else :icon="currentIcon" class="w-4 h-4" />
              {{ currentMode }}
              <Icon icon="lucide:chevron-right" class="w-4 h-4 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" class="w-64 border-none bg-transparent p-0 shadow-none">
            <div class="rounded-lg border bg-card p-1 shadow-md">
              <!-- Agent Mode -->
              <div
                :class="[
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
                  isAgentModeSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                ]"
                @click="handleModeSelect('agent')"
              >
                <Icon icon="lucide:bot" class="w-4 h-4" />
                <span class="flex-1">{{ t('chat.mode.agent') }}</span>
                <Icon v-if="isAgentModeSelected" icon="lucide:check" class="w-4 h-4" />
              </div>

              <!-- ACP Agent Section -->
              <div
                v-if="acpAgentOptions.length"
                class="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
              >
                {{ t('chat.mode.acpAgent') }}
              </div>

              <div
                v-for="agent in acpAgentOptions"
                :key="agent.id"
                :class="[
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
                  selectedAcpAgentId === agent.id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                ]"
                @click="handleAcpAgentSelect(agent)"
              >
                <ModelIcon :model-id="agent.id" custom-class="w-4 h-4" />
                <span class="flex-1">{{ agent.name }}</span>
                <Icon v-if="selectedAcpAgentId === agent.id" icon="lucide:check" class="w-4 h-4" />
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </span>
    </TooltipTrigger>
    <TooltipContent>
      {{ t('chat.mode.current', { mode: currentLabel }) }}
    </TooltipContent>
  </Tooltip>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import ModelIcon from '../icons/ModelIcon.vue'
import type { ChatMode } from './composables/useChatMode'

interface AcpAgentOption {
  id: string
  name: string
  providerId: string
  type?: any
}

const props = defineProps<{
  currentMode: ChatMode
  currentLabel: string
  currentIcon: string
  acpAgentOptions: AcpAgentOption[]
  selectedAcpAgentId: string | null
}>()

const emit = defineEmits<{
  'mode-select': [mode: ChatMode]
  'acp-agent-select': [agent: AcpAgentOption]
}>()

const { t } = useI18n()
const open = ref(false)

const isAgentModeSelected = computed(() => props.currentMode === 'agent')

const handleModeSelect = (mode: ChatMode) => {
  emit('mode-select', mode)
  open.value = false
}

const handleAcpAgentSelect = (agent: AcpAgentOption) => {
  emit('acp-agent-select', agent)
  open.value = false
}
</script>
