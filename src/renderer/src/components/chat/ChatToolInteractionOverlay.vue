<template>
  <div class="w-full max-w-2xl rounded-xl border bg-card/95 shadow-lg backdrop-blur-lg p-4">
    <div class="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon :icon="headerIcon" class="h-4 w-4" />
      <span>{{ headerText }}</span>
    </div>

    <p class="mt-3 text-sm whitespace-pre-wrap break-words">
      {{ bodyText }}
    </p>

    <div v-if="isPermission" class="mt-3 space-y-2">
      <div class="rounded-md border bg-muted/50 px-3 py-2">
        <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Tool</div>
        <div class="text-xs font-medium break-all">{{ interaction.toolName || '-' }}</div>
      </div>
      <div v-if="formattedToolArgs" class="rounded-md border bg-background/50 px-3 py-2">
        <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Arguments</div>
        <pre class="mt-1 text-xs leading-5 whitespace-pre-wrap break-words">{{
          formattedToolArgs
        }}</pre>
      </div>
    </div>

    <div v-if="isQuestion" class="mt-4 flex flex-wrap gap-2">
      <Button
        v-for="option in questionOptions"
        :key="option.label"
        :disabled="processing"
        variant="outline"
        size="sm"
        class="h-auto min-h-8 px-3 py-1.5 text-left"
        @click="onQuestionOption(option.label)"
      >
        <span class="flex flex-col items-start gap-0.5">
          <span class="text-xs font-medium">{{ option.label }}</span>
          <span v-if="option.description" class="text-[11px] text-muted-foreground">
            {{ option.description }}
          </span>
        </span>
      </Button>
      <Button
        v-if="allowOther"
        :disabled="processing"
        variant="outline"
        size="sm"
        class="h-8 px-3 text-xs"
        @click="onQuestionOther"
      >
        Other
      </Button>
    </div>

    <div v-else class="mt-4 flex gap-2">
      <Button
        :disabled="processing"
        variant="outline"
        size="sm"
        class="h-8 flex-1 text-xs"
        @click="onPermission(false)"
      >
        {{ t('components.messageBlockPermissionRequest.deny') }}
      </Button>
      <Button
        :disabled="processing"
        size="sm"
        class="h-8 flex-1 text-xs"
        @click="onPermission(true)"
      >
        {{ t('components.messageBlockPermissionRequest.allow') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'
import type { AssistantMessageBlock, ToolInteractionResponse } from '@shared/types/agent-interface'

type PendingInteractionView = {
  messageId: string
  toolCallId: string
  actionType: 'question_request' | 'tool_call_permission'
  toolName: string
  toolArgs: string
  block: AssistantMessageBlock
}

const props = defineProps<{
  interaction: PendingInteractionView
  processing?: boolean
}>()

const emit = defineEmits<{
  respond: [response: ToolInteractionResponse]
}>()

const { t } = useI18n()

const isQuestion = computed(() => props.interaction.actionType === 'question_request')
const isPermission = computed(() => props.interaction.actionType === 'tool_call_permission')

const headerIcon = computed(() =>
  isQuestion.value ? 'lucide:message-circle-question' : 'lucide:shield'
)
const headerText = computed(() =>
  isQuestion.value
    ? t('components.messageBlockQuestionRequest.title')
    : t('components.messageBlockPermissionRequest.title')
)

const questionText = computed(() => {
  const raw = props.interaction.block.extra?.questionText
  if (typeof raw === 'string' && raw.trim()) {
    return raw
  }
  return props.interaction.block.content || ''
})

const parseQuestionOption = (value: unknown): { label: string; description?: string } | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { label?: unknown; description?: unknown }
  if (typeof candidate.label !== 'string') return null
  const label = candidate.label.trim()
  if (!label) return null
  if (typeof candidate.description === 'string' && candidate.description.trim()) {
    return { label, description: candidate.description.trim() }
  }
  return { label }
}

const questionOptions = computed(() => {
  const raw = props.interaction.block.extra?.questionOptions
  if (Array.isArray(raw)) {
    return raw
      .map((item) => parseQuestionOption(item))
      .filter((item): item is { label: string; description?: string } => Boolean(item))
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => parseQuestionOption(item))
          .filter((item): item is { label: string; description?: string } => Boolean(item))
      }
    } catch (error) {
      console.error('[ChatToolInteractionOverlay] parse question options failed:', error)
    }
  }
  return []
})

const allowOther = computed(() => props.interaction.block.extra?.questionCustom !== false)

const parsedPermissionRequest = computed(() => {
  const raw = props.interaction.block.extra?.permissionRequest
  if (typeof raw !== 'string' || !raw.trim()) {
    return null
  }
  try {
    return JSON.parse(raw) as {
      toolName?: string
      serverName?: string
      command?: string
      permissionType?: 'read' | 'write' | 'all' | 'command'
    }
  } catch (error) {
    console.error('[ChatToolInteractionOverlay] parse permission request failed:', error)
    return null
  }
})

const permissionText = computed(() => {
  const content = props.interaction.block.content || ''
  if (!content.startsWith('components.messageBlockPermissionRequest.description.')) {
    return content
  }

  const permissionType = parsedPermissionRequest.value?.permissionType || 'write'
  const command = parsedPermissionRequest.value?.command || ''
  const toolName = parsedPermissionRequest.value?.toolName || props.interaction.toolName || ''
  const serverName = parsedPermissionRequest.value?.serverName || ''

  if (permissionType === 'command') {
    return t('components.messageBlockPermissionRequest.description.command', { command })
  }

  return t(content, { toolName, serverName })
})

const bodyText = computed(() => (isQuestion.value ? questionText.value : permissionText.value))

const formattedToolArgs = computed(() => {
  const raw = props.interaction.toolArgs || ''
  if (!raw.trim()) return ''
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2)
  } catch {
    return raw
  }
})

const onPermission = (granted: boolean) => {
  emit('respond', { kind: 'permission', granted })
}

const onQuestionOption = (optionLabel: string) => {
  emit('respond', { kind: 'question_option', optionLabel })
}

const onQuestionOther = () => {
  emit('respond', { kind: 'question_other' })
}
</script>
