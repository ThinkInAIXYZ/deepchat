<template>
  <div
    :class="[
      'relative flex min-h-0 w-full flex-col overflow-hidden text-foreground',
      props.embedded
        ? 'px-2 pb-3 pt-2'
        : [
            'tool-interaction-overlay max-w-2xl rounded-xl p-4',
            isPermission ? 'max-h-[min(70vh,calc(100vh-12rem))]' : ''
          ]
    ]"
  >
    <div v-if="!props.embedded" class="tool-interaction-overlay__backdrop" aria-hidden="true" />
    <div v-if="!props.embedded" class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
      <Icon :icon="headerIcon" class="h-4 w-4" />
      <span>{{ headerText }}</span>
    </div>

    <!-- Embedded: indent into the dock icon column (44px) under the shared header. -->
    <div
      :class="[
        props.embedded ? 'pl-9 pr-2.5' : '',
        !props.embedded && isPermission ? 'flex min-h-0 flex-1 flex-col' : ''
      ]"
    >
      <p class="text-sm whitespace-pre-wrap break-words">
        {{ bodyText }}
      </p>

      <div
        v-if="isSkillDraft && skillDraftPreview"
        class="mt-3 rounded-md border bg-background/60 p-3"
      >
        <div class="text-[11px] uppercase tracking-wide text-muted-foreground">
          {{ t('chat.skillDraft.previewTitle') }}
        </div>
        <pre
          class="dc-overscroll-contain mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5"
          >{{ skillDraftPreview }}</pre
        >
      </div>

      <div
        v-if="isPermission"
        data-testid="tool-interaction-scroll-region"
        :class="[
          'mt-3 space-y-2',
          props.embedded
            ? ''
            : 'dc-overscroll-contain min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1'
        ]"
      >
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

      <div v-if="isQuestion" class="mt-4">
        <DcCheckboxGroup
          v-if="isMultiple"
          v-model="multiSelected"
          :options="choiceOptions"
          :disabled="processing"
        />
        <DcRadioGroup
          v-else
          :model-value="singleSelected"
          :options="choiceOptions"
          :disabled="processing"
          @update:model-value="onSingleSelect"
        />

        <div v-if="allowOther" class="mt-3 flex items-center gap-2">
          <input
            v-model="customAnswer"
            type="text"
            :disabled="processing"
            :placeholder="t('components.messageBlockQuestionRequest.customPlaceholder')"
            class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background/60 px-2.5 text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            @keydown.enter.prevent="onCustomSubmit"
          />
          <DcButton
            :disabled="processing || !customAnswer.trim()"
            variant="outline"
            size="sm"
            class="h-8 shrink-0 px-3 text-xs"
            @click="onCustomSubmit"
          >
            {{ t('components.messageBlockQuestionRequest.send') }}
          </DcButton>
        </div>

        <div v-if="isMultiple" class="mt-3 flex items-center gap-2">
          <DcButton
            :disabled="processing || multiSelected.length === 0"
            size="sm"
            class="h-8 px-4 text-xs"
            @click="onMultiConfirm"
          >
            {{ t('common.confirm') }}
          </DcButton>
        </div>
      </div>

      <div v-else data-testid="tool-interaction-actions" class="mt-4 flex shrink-0 gap-2">
        <DcButton
          :disabled="processing"
          variant="outline"
          size="sm"
          class="h-8 flex-1 text-xs"
          @click="onPermission(false)"
        >
          {{ t('components.messageBlockPermissionRequest.deny') }}
        </DcButton>
        <DcButton
          :disabled="processing"
          size="sm"
          class="h-8 flex-1 text-xs"
          @click="onPermission(true)"
        >
          {{ t('components.messageBlockPermissionRequest.allow') }}
        </DcButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { DcCheckboxGroup, DcRadioGroup } from '@dc-ui/components/choice-group'
import type { DcChoiceOption } from '@dc-ui/components/choice-group'
import { Icon } from '@iconify/vue'
import type { ToolInteractionResponse } from '@shared/types/agent-interface'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'

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

const isMultiple = computed(() => props.interaction.block.extra?.questionMultiple === true)

// Choice values are rawLabels (pre-translation) so i18n cannot split options.
const choiceOptions = computed<DcChoiceOption[]>(() =>
  questionOptions.value.map((option) => ({
    value: option.rawLabel,
    label: option.label,
    description: option.description
  }))
)

const singleSelected = ref<string | null>(null)
const multiSelected = ref<string[]>([])
const customAnswer = ref('')

watch(
  () => props.interaction.toolCallId,
  () => {
    singleSelected.value = null
    multiSelected.value = []
    customAnswer.value = ''
  }
)

const onSingleSelect = (value: string) => {
  singleSelected.value = value
  const option = questionOptions.value.find((entry) => entry.rawLabel === value)
  if (!option) return
  emit('respond', {
    kind: 'question_option',
    optionLabel: isSkillDraft.value ? option.rawLabel : option.label
  })
}

const onMultiConfirm = () => {
  const labels = questionOptions.value
    .filter((option) => multiSelected.value.includes(option.rawLabel))
    .map((option) => option.label)
  if (labels.length === 0) return
  emit('respond', { kind: 'question_option', optionLabel: labels.join(', ') })
}

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

const onCustomSubmit = () => {
  const answer = customAnswer.value.trim()
  if (!answer || props.processing) return
  emit('respond', { kind: 'question_custom', answerText: answer })
}
</script>

<style scoped>
.tool-interaction-overlay {
  isolation: isolate;
  border-color: transparent;
  backdrop-filter: blur(var(--dc-blur-overlay));
  -webkit-backdrop-filter: blur(var(--dc-blur-overlay));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, white 92%, hsl(var(--background)) 8%) 0%,
    color-mix(in srgb, white 84%, hsl(var(--background)) 16%) 100%
  );
  box-shadow:
    0 24px 48px -12px rgb(15 23 42 / 0.16),
    0 8px 20px -8px rgb(15 23 42 / 0.1),
    0 2px 6px -2px rgb(15 23 42 / 0.08),
    inset 0 1px 0 rgb(255 255 255 / 0.5);
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
      color-mix(in srgb, white 92%, hsl(var(--background)) 8%) 0%,
      color-mix(in srgb, white 72%, hsl(var(--muted)) 28%) 100%
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
    inset 0 0 0 1px color-mix(in srgb, white 10%, hsl(var(--border)) 90%),
    inset 0 1px 0 rgb(255 255 255 / 0.3);
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
  opacity: 0.7;
  pointer-events: none;
}

.dark .tool-interaction-overlay {
  border-color: transparent;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, hsl(var(--background)) 86%, rgb(51 65 85) 14%) 0%,
    color-mix(in srgb, hsl(var(--background)) 94%, rgb(15 23 42) 6%) 100%
  );
  box-shadow:
    0 24px 48px -12px rgb(0 0 0 / 0.6),
    0 10px 24px -10px rgb(0 0 0 / 0.4),
    0 2px 6px -2px rgb(0 0 0 / 0.3),
    inset 0 1px 0 rgb(255 255 255 / 0.08);
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
  opacity: 0.94;
}

.dark .tool-interaction-overlay::after {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, white 14%, hsl(var(--border)) 86%),
    inset 0 1px 0 rgb(255 255 255 / 0.1);
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
  opacity: 0.6;
}
</style>
