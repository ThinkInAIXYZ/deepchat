<template>
  <div :class="['flex items-center gap-2', compact ? 'h-7' : 'h-9']">
    <!-- Agent Icon -->
    <ModelIcon
      :model-id="agentId || 'unknown'"
      :is-dark="isDark"
      :custom-class="compact ? 'w-4 h-4' : 'w-5 h-5'"
    />

    <!-- Agent Name -->
    <span
      :class="['font-semibold text-foreground', compact ? 'text-xs' : 'text-sm']"
      :title="agentName"
    >
      {{ agentName }}
    </span>

    <!-- Status Indicator -->
    <div
      v-if="showStatus"
      :class="[
        'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
        statusClass
      ]"
      :title="statusTooltip"
    >
      <span v-if="isGenerating" :class="['w-2 h-2 rounded-full bg-current', 'animate-pulse']" />
      <Icon v-if="statusIcon" :icon="statusIcon" class="w-3 h-3" />
      <span>{{ statusText }}</span>
    </div>

    <!-- Capabilities Badges -->
    <div v-if="showCapabilities && !compact" class="flex items-center gap-1">
      <!-- Vision -->
      <Badge
        v-if="supportsVision"
        variant="secondary"
        class="h-5 px-1.5 text-[10px]"
        :title="t('chat.input.capabilities.vision')"
      >
        <Icon icon="lucide:eye" class="w-3 h-3" />
      </Badge>
      <!-- Tools -->
      <Badge
        v-if="supportsTools"
        variant="secondary"
        class="h-5 px-1.5 text-[10px]"
        :title="t('chat.input.capabilities.tools')"
      >
        <Icon icon="lucide:wrench" class="w-3 h-3" />
      </Badge>
      <!-- Modes -->
      <Badge
        v-if="supportsModes"
        variant="secondary"
        class="h-5 px-1.5 text-[10px]"
        :title="t('chat.input.capabilities.modes')"
      >
        <Icon icon="lucide:layers" class="w-3 h-3" />
      </Badge>
      <!-- Commands -->
      <Badge
        v-if="commandsCount > 0"
        variant="secondary"
        class="h-5 px-1.5 text-[10px]"
        :title="t('chat.input.capabilities.commands', { count: commandsCount })"
      >
        <Icon icon="lucide:terminal" class="w-3 h-3" />
        <span class="ml-0.5">{{ commandsCount }}</span>
      </Badge>
    </div>

    <!-- Workspace Display -->
    <div v-if="showWorkspace && hasWorkspace" class="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        :class="[
          'h-6 px-2 rounded text-xs font-medium',
          'text-muted-foreground hover:text-foreground',
          'hover:bg-muted/60'
        ]"
        :title="truncatedWorkspace"
        @click="$emit('workspace-click', truncatedWorkspace)"
      >
        <Icon icon="lucide:folder" class="w-3 h-3" />
        <span class="ml-1 truncate max-w-[120px]">{{ truncatedWorkspace }}</span>
      </Button>
    </div>

    <!-- Config Button (compact mode only) -->
    <Button
      v-if="compact"
      variant="ghost"
      size="sm"
      class="h-6 w-6 p-0 rounded"
      :title="t('chat.input.config')"
      @click="$emit('config-click')"
    >
      <Icon icon="lucide:settings" class="w-3 h-3" />
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Button } from '@shadcn/components/ui/button'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { useAgenticSession } from '@/composables/agentic/useAgenticSession'

interface Props {
  sessionId: string
  compact?: boolean
  showStatus?: boolean
  showCapabilities?: boolean
  showWorkspace?: boolean
  isDark?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  compact: false,
  showStatus: true,
  showCapabilities: true,
  showWorkspace: true,
  isDark: false
})

defineEmits<{
  'config-click': []
  'workspace-click': [path: string]
}>()

const { t } = useI18n()

// Use agentic session composable for data
const {
  agentId,
  status,
  workspace,
  supportsVision,
  supportsTools,
  supportsModes,
  availableCommands,
  isGenerating,
  isPaused,
  hasError
} = useAgenticSession(props.sessionId)

// Computed properties
const agentName = computed(() => {
  return agentId.value || t('chat.input.unknownAgent')
})

const hasWorkspace = computed(() => Boolean(workspace.value))

const truncatedWorkspace = computed(() => {
  if (!workspace.value) return ''
  // Replace home directory with ~
  const homeDir =
    window.electron.process?.env?.HOME || window.electron.process?.env?.USERPROFILE || ''
  if (homeDir && workspace.value.startsWith(homeDir)) {
    return '~' + workspace.value.slice(homeDir.length)
  }
  // Truncate if too long
  const maxLength = 30
  if (workspace.value.length > maxLength) {
    return '...' + workspace.value.slice(-(maxLength - 3))
  }
  return workspace.value
})

const commandsCount = computed(() => availableCommands.value.length)

// Status computed
const statusClass = computed(() => {
  switch (status.value) {
    case 'generating':
      return 'bg-primary/10 text-primary'
    case 'error':
      return 'bg-destructive/10 text-destructive'
    case 'paused':
      return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
    default:
      return 'bg-muted text-muted-foreground'
  }
})

const statusIcon = computed(() => {
  if (hasError.value) return 'lucide:alert-circle'
  if (isPaused.value) return 'lucide:pause'
  return ''
})

const statusText = computed(() => {
  if (isGenerating.value) return t('chat.input.status.generating')
  if (hasError.value) return t('chat.input.status.error')
  if (isPaused.value) return t('chat.input.status.paused')
  return t('chat.input.status.idle')
})

const statusTooltip = computed(() => {
  if (isGenerating.value) return t('chat.input.status.generatingTooltip')
  if (hasError.value) return t('chat.input.status.errorTooltip')
  if (isPaused.value) return t('chat.input.status.pausedTooltip')
  return t('chat.input.status.idleTooltip')
})
</script>
