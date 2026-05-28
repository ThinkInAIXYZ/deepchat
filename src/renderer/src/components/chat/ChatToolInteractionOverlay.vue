<template>
  <div
    :class="[
      'relative w-full overflow-hidden p-4 text-foreground',
      props.embedded ? '' : 'tool-interaction-overlay max-w-2xl rounded-xl backdrop-blur-[26px]'
    ]"
  >
    <div v-if="!props.embedded" class="tool-interaction-overlay__backdrop" aria-hidden="true" />
    <div class="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon :icon="headerIcon" class="h-4 w-4" />
      <span>{{ headerText }}</span>
    </div>

    <p class="mt-3 text-sm whitespace-pre-wrap break-words">
      {{ bodyText }}
    </p>

    <div
      v-if="isSkillDraft && skillDraftPreview"
      class="mt-3 rounded-md border bg-background/60 p-3"
    >
      <div class="text-[11px] uppercase tracking-wide text-muted-foreground">
        {{ t('chat.skillDraft.previewTitle') }}
      </div>
      <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">{{
        skillDraftPreview
      }}</pre>
    </div>

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
        @click="onQuestionOption(option)"
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
import type { ToolInteractionResponse } from '@shared/types/agent-interface'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'

type PendingInteractionView = {
  messageId: string
  toolCallId: string
  actionType: 'question_request' | 'tool_call_permission'
  toolName: string
  toolArgs: string
  block: DisplayAssistantMessageBlock
}

const props = defineProps<{
  interaction: PendingInteractionView
  processing?: boolean
  embedded?: boolean
}>()

const emit = defineEmits<{
  respond: [response: ToolInteractionResponse]
}>()

const { t } = useI18n()

const isQuestion = computed(() => props.interaction.actionType === 'question_request')
const isPermission = computed(() => props.interaction.actionType === 'tool_call_permission')
const isSkillDraft = computed(() => props.interaction.block.extra?.skillDraftAction === 'confirm')

const translateMaybeKey = (value: string, params?: Record<string, unknown>) => {
  return value.includes('.') ? t(value, params ?? {}) : value
}

const headerIcon = computed(() =>
  isQuestion.value ? 'lucide:message-circle-question' : 'lucide:shield'
)
const headerText = computed(() => {
  if (isQuestion.value) {
    const raw = props.interaction.block.extra?.questionHeader
    if (typeof raw === 'string' && raw.trim()) {
      return translateMaybeKey(raw)
    }
    return t('components.messageBlockQuestionRequest.title')
  }

  return t('components.messageBlockPermissionRequest.title')
})

const skillDraftName = computed(() => {
  const raw = props.interaction.block.extra?.skillDraftName
  return typeof raw === 'string' ? raw : ''
})

const skillDraftPreview = computed(() => {
  const raw = props.interaction.block.extra?.skillDraftPreview
  return typeof raw === 'string' ? raw : ''
})

const questionText = computed(() => {
  const raw = props.interaction.block.extra?.questionText
  if (typeof raw === 'string' && raw.trim()) {
    return translateMaybeKey(raw, { name: skillDraftName.value })
  }
  return props.interaction.block.content || ''
})

type QuestionOptionView = { label: string; rawLabel: string; description?: string }

const parseQuestionOption = (value: unknown): QuestionOptionView | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { label?: unknown; description?: unknown }
  if (typeof candidate.label !== 'string') return null
  const label = candidate.label.trim()
  if (!label) return null
  const translatedLabel = translateMaybeKey(label)
  if (typeof candidate.description === 'string' && candidate.description.trim()) {
    return {
      label: translatedLabel,
      rawLabel: label,
      description: translateMaybeKey(candidate.description.trim())
    }
  }
  return { label: translatedLabel, rawLabel: label }
}

const parseQuestionOptionsPayload = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) {
    return raw
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.error('[ChatToolInteractionOverlay] parse question options failed:', error)
    }
  }
  return []
}

const questionOptions = computed(() =>
  parseQuestionOptionsPayload(props.interaction.block.extra?.questionOptions)
    .map((item) => parseQuestionOption(item))
    .filter((item): item is QuestionOptionView => Boolean(item))
)

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

const onQuestionOption = (option: QuestionOptionView) => {
  emit('respond', {
    kind: 'question_option',
    optionLabel: isSkillDraft.value ? option.rawLabel : option.label
  })
}

const onQuestionOther = () => {
  emit('respond', { kind: 'question_other' })
}
</script>

<style scoped>
.tool-interaction-overlay {
  isolation: isolate;
  border-color: transparent;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, white 78%, hsl(var(--background)) 22%) 0%,
    color-mix(in srgb, white 58%, hsl(var(--background)) 42%) 100%
  );
  box-shadow:
    0 20px 40px -30px rgb(15 23 42 / 0.2),
    0 8px 18px -18px rgb(15 23 42 / 0.08),
    inset 0 1px 0 rgb(255 255 255 / 0.42),
    inset 0 -10px 20px -18px rgb(148 163 184 / 0.18);
}

.tool-interaction-overlay::before {
  content: '';
  position: absolute;
  inset: 1px;
  z-index: 0;
  border-radius: inherit;
  pointer-events: none;
  background:
    linear-gradient(
      160deg,
      rgb(255 255 255 / 0.58) 0%,
      transparent 36%,
      rgb(255 255 255 / 0.12) 100%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, white 88%, hsl(var(--background)) 12%) 0%,
      color-mix(in srgb, white 64%, hsl(var(--muted)) 36%) 100%
    );
  opacity: 0.92;
}

.tool-interaction-overlay::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, white 22%, hsl(var(--border)) 78%),
    inset 0 1px 0 rgb(255 255 255 / 0.24);
  opacity: 0.82;
}

.tool-interaction-overlay > :not(.tool-interaction-overlay__backdrop) {
  position: relative;
  z-index: 3;
}

.tool-interaction-overlay__backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(
      circle at 12% 14%,
      color-mix(in srgb, white 78%, hsl(var(--primary)) 22%) 0%,
      transparent 34%
    ),
    radial-gradient(circle at 88% 12%, rgb(255 255 255 / 0.62) 0%, transparent 26%),
    radial-gradient(
      circle at 72% 100%,
      color-mix(in srgb, white 44%, hsl(var(--muted)) 56%) 0%,
      transparent 42%
    );
  filter: saturate(1.06);
  opacity: 0.92;
  pointer-events: none;
}

.dark .tool-interaction-overlay {
  border-color: transparent;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, hsl(var(--background)) 88%, rgb(51 65 85) 12%) 0%,
    color-mix(in srgb, hsl(var(--background)) 94%, rgb(15 23 42) 6%) 100%
  );
  box-shadow:
    0 24px 48px -34px rgb(0 0 0 / 0.48),
    0 12px 24px -22px rgb(0 0 0 / 0.26),
    inset 0 1px 0 rgb(255 255 255 / 0.08),
    inset 0 -14px 24px -22px rgb(0 0 0 / 0.36);
}

.dark .tool-interaction-overlay::before {
  background:
    linear-gradient(
      160deg,
      rgb(255 255 255 / 0.12) 0%,
      transparent 40%,
      rgb(255 255 255 / 0.03) 100%
    ),
    linear-gradient(
      180deg,
      color-mix(in srgb, hsl(var(--background)) 82%, rgb(30 41 59) 18%) 0%,
      color-mix(in srgb, hsl(var(--background)) 92%, rgb(2 6 23) 8%) 100%
    );
  opacity: 0.88;
}

.dark .tool-interaction-overlay::after {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, white 8%, hsl(var(--border)) 92%),
    inset 0 1px 0 rgb(255 255 255 / 0.08);
  opacity: 0.74;
}

.dark .tool-interaction-overlay__backdrop {
  background:
    radial-gradient(
      circle at 14% 16%,
      color-mix(in srgb, hsl(var(--primary)) 30%, white 70%) 0%,
      transparent 34%
    ),
    radial-gradient(circle at 88% 14%, rgb(255 255 255 / 0.12) 0%, transparent 24%),
    radial-gradient(circle at 78% 100%, rgb(15 23 42 / 0.42) 0%, transparent 42%);
  filter: saturate(1.08);
  opacity: 0.84;
}
</style>
