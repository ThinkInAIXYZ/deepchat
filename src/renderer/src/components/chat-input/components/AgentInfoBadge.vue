<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 px-2 gap-1 text-xs rounded-md text-muted-foreground hover:text-foreground max-w-[220px]"
      >
        <Icon :icon="agentIcon" class="w-3.5 h-3.5" />
        <span class="truncate">{{ agentName }}</span>
        <Icon icon="lucide:info" class="w-3 h-3 opacity-80" />
      </Button>
    </PopoverTrigger>

    <PopoverContent align="start" class="w-72 p-3 space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">{{ t('chat.input.agentInfo') }}</span>
        <Icon :icon="agentIcon" class="w-3.5 h-3.5 text-muted-foreground" />
      </div>

      <div class="space-y-1 text-xs">
        <div class="flex items-start justify-between gap-2">
          <span class="text-muted-foreground">{{ t('chat.input.agentLabel') }}</span>
          <span class="font-medium text-right break-all">{{ agentName }}</span>
        </div>

        <div v-if="providerLabel" class="flex items-start justify-between gap-2">
          <span class="text-muted-foreground">{{ t('chat.input.providerLabel') }}</span>
          <span class="font-medium text-right break-all">{{ providerLabel }}</span>
        </div>

        <div v-if="modelLabel" class="flex items-start justify-between gap-2">
          <span class="text-muted-foreground">{{ t('chat.input.modelLabel') }}</span>
          <span class="font-medium text-right break-all">{{ modelLabel }}</span>
        </div>

        <div v-if="commandLabel" class="flex items-start justify-between gap-2">
          <span class="text-muted-foreground">{{ t('chat.input.commandLabel') }}</span>
          <span class="font-medium text-right break-all">{{ commandLabel }}</span>
        </div>
      </div>

      <div class="pt-1 border-t border-border/60">
        <Button
          variant="ghost"
          size="sm"
          class="h-7 px-2 text-xs w-full justify-start"
          @click="emit('open-settings')"
        >
          {{ t('chat.input.viewAgentSettings') }}
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import type { Agent } from '@shared/types/presenters/agentConfig.presenter'
import type { LocalAgentEntry } from '@/stores/agent'

type CurrentAgent = Agent | LocalAgentEntry | null

const props = defineProps<{
  agent: CurrentAgent
  activeModel?: {
    id?: string
    providerId?: string
  } | null
}>()

const emit = defineEmits<{
  'open-settings': []
}>()

const { t } = useI18n()

const agentName = computed(() => {
  if (!props.agent) return t('chat.input.unknownAgent')
  if (props.agent.type === 'local') return t('common.sidebar.localAgent')
  return props.agent.name
})

const agentIcon = computed(() => {
  if (!props.agent) return 'lucide:bot'
  if (props.agent.type === 'acp') return 'lucide:bot-message-square'
  if (props.agent.type === 'local') return 'lucide:laptop'
  return 'lucide:bot'
})

const providerLabel = computed(() => {
  if (!props.agent) return ''
  if (props.agent.type === 'template') return props.agent.providerId
  if (props.agent.type === 'local') return props.activeModel?.providerId || 'local'
  return 'acp'
})

const modelLabel = computed(() => {
  if (!props.agent) return ''
  if (props.agent.type === 'template') return props.agent.modelId
  if (props.agent.type === 'local') return props.activeModel?.id || ''
  return ''
})

const commandLabel = computed(() => {
  if (props.agent?.type !== 'acp') return ''
  return props.agent.command
})
</script>
