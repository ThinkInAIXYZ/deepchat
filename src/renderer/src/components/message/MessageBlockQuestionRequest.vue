<template>
  <div class="my-1">
    <div
      class="flex flex-col h-min-[40px] overflow-hidden w-[380px] break-all shadow-sm my-2 rounded-lg border bg-card text-card-foreground p-3"
    >
      <div class="flex items-center gap-2 mb-2">
        <Icon icon="lucide:help-circle" class="w-4 h-4 text-muted-foreground" />
        <h4 class="text-xs font-medium text-accent-foreground">
          {{ headerText }}
        </h4>
        <span
          v-if="!isPending"
          class="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground"
        >
          {{
            isRejected
              ? t('components.messageBlockQuestionRequest.rejected')
              : t('components.messageBlockQuestionRequest.selected')
          }}
        </span>
      </div>

      <p class="text-xs text-muted-foreground whitespace-pre-wrap break-words">
        {{ questionText }}
      </p>

      <div v-if="isPending" class="mt-3 flex flex-col gap-2">
        <div class="flex flex-col gap-2">
          <Button
            v-for="option in options"
            :key="option.label"
            variant="outline"
            size="sm"
            class="h-auto w-full justify-start text-left"
            :class="getOptionClass(option.label)"
            :disabled="isProcessing"
            :aria-pressed="isMulti ? isSelected(option.label) : undefined"
            @click="handleOptionClick(option.label)"
          >
            <div class="flex w-full items-start justify-between gap-2">
              <div class="flex flex-col items-start gap-1">
                <span class="text-xs font-medium">{{ option.label }}</span>
                <span
                  v-if="option.description"
                  class="text-[11px] text-muted-foreground whitespace-pre-wrap break-words"
                >
                  {{ option.description }}
                </span>
              </div>
              <Icon
                v-if="isMulti"
                :icon="isSelected(option.label) ? 'lucide:check-circle' : 'lucide:circle'"
                class="w-4 h-4 shrink-0 text-muted-foreground"
                :class="isSelected(option.label) ? 'text-primary' : ''"
              />
            </div>
          </Button>
        </div>

        <div v-if="isMulti && selectedOptions.length" class="text-[11px] text-muted-foreground">
          {{ t('components.messageBlockQuestionRequest.selected') }}: {{ selectedOptions.length }}
        </div>

        <Input
          v-if="allowCustom"
          ref="customInputRef"
          v-model="customAnswer"
          class="h-8 text-xs"
          :placeholder="t('components.messageBlockQuestionRequest.customPlaceholder')"
          :disabled="isProcessing"
          @keydown="handleCustomKeydown"
        />

        <div class="flex gap-2 mt-1">
          <Button
            variant="outline"
            size="sm"
            class="flex-1 h-7 text-xs"
            :disabled="isProcessing"
            @click="rejectQuestion"
          >
            <Icon icon="lucide:x" class="w-3 h-3 mr-1" />
            {{ t('components.messageBlockQuestionRequest.reject') }}
          </Button>
          <Button
            v-if="showSendButton"
            size="sm"
            class="flex-1 h-7 text-xs"
            :disabled="!canSubmit || isProcessing"
            @click="submitSelection"
          >
            <Icon v-if="isProcessing" icon="lucide:loader-2" class="w-3 h-3 mr-1 animate-spin" />
            <Icon v-else icon="lucide:check" class="w-3 h-3 mr-1" />
            {{ t('components.messageBlockQuestionRequest.send') }}
          </Button>
        </div>
      </div>

      <div v-else class="mt-3">
        <div v-if="isRejected" class="text-xs text-muted-foreground">
          {{ t('components.messageBlockQuestionRequest.rejected') }}
        </div>
        <div v-else class="flex flex-col gap-1">
          <span class="text-[10px] uppercase tracking-wide text-muted-foreground">
            {{ t('components.messageBlockQuestionRequest.answerLabel') }}
          </span>
          <p class="text-xs whitespace-pre-wrap break-words">
            {{ answerText }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { useChatStore } from '@/stores/chat'
import { usePresenter } from '@/composables/usePresenter'
import { useChatMode } from '@/components/chat-input/composables/useChatMode'
import { useInputSettings } from '@/components/chat-input/composables/useInputSettings'
import type { AssistantMessageBlock, UserMessageContent } from '@shared/chat'
import type { QuestionOption } from '@shared/types/core/question'

const props = defineProps<{
  block: AssistantMessageBlock
  messageId: string
  conversationId: string
}>()

const { t } = useI18n()
const chatStore = useChatStore()
const agentPresenter = usePresenter('agentPresenter')
const chatMode = useChatMode()
const { settings } = useInputSettings()

const isProcessing = ref(false)
const customAnswer = ref('')
const selectedOptions = ref<string[]>([])
const customInputRef = ref<{ $el?: HTMLInputElement } | null>(null)

const isMulti = computed(() => props.block.extra?.questionMultiple === true)
const allowCustom = computed(() => props.block.extra?.questionCustom !== false)
const isPending = computed(
  () => props.block.status === 'pending' && props.block.extra?.needsUserAction !== false
)
const resolution = computed(() => {
  const raw = props.block.extra?.questionResolution
  if (raw === 'replied' || raw === 'rejected') return raw
  if (props.block.status === 'denied') return 'rejected'
  if (props.block.status === 'success') return 'replied'
  return 'asked'
})
const isRejected = computed(() => resolution.value === 'rejected')
const answerText = computed(() => {
  const raw = props.block.extra?.answerText
  return typeof raw === 'string' ? raw : ''
})

const questionText = computed(() => {
  const raw = props.block.extra?.questionText
  if (typeof raw === 'string' && raw.trim()) return raw
  return props.block.content || ''
})

const headerText = computed(() => {
  const raw = props.block.extra?.questionHeader
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return t('components.messageBlockQuestionRequest.title')
})

const normalizeOption = (option: unknown): QuestionOption | null => {
  if (!option || typeof option !== 'object') return null
  const candidate = option as { label?: unknown; description?: unknown }
  if (typeof candidate.label !== 'string') return null
  const label = candidate.label.trim()
  if (!label) return null
  if (typeof candidate.description === 'string') {
    const description = candidate.description.trim()
    if (description) {
      return { label, description }
    }
  }
  return { label }
}

const options = computed<QuestionOption[]>(() => {
  const raw = props.block.extra?.questionOptions
  if (Array.isArray(raw)) {
    return raw
      .map((option) => normalizeOption(option))
      .filter((option): option is QuestionOption => Boolean(option))
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .map((option) => normalizeOption(option))
          .filter((option): option is QuestionOption => Boolean(option))
      }
    } catch (error) {
      console.error('Failed to parse question options:', error)
    }
  }
  return []
})

const canUseWebSearch = computed(() => chatMode.currentMode.value === 'chat')
const showSendButton = computed(() => isMulti.value || allowCustom.value)
const canSubmit = computed(() => {
  const customText = customAnswer.value.trim()
  if (isMulti.value) {
    return selectedOptions.value.length > 0 || (allowCustom.value && customText.length > 0)
  }
  if (allowCustom.value) {
    return customText.length > 0
  }
  return false
})

const isSelected = (label: string) => selectedOptions.value.includes(label)

const getOptionClass = (label: string) => {
  if (!isMulti.value) return ''
  return isSelected(label) ? 'border-primary bg-primary/10' : ''
}

const handleOptionClick = async (label: string) => {
  if (isProcessing.value) return
  if (isMulti.value) {
    if (isSelected(label)) {
      selectedOptions.value = selectedOptions.value.filter((item) => item !== label)
    } else {
      selectedOptions.value = [...selectedOptions.value, label]
    }
    return
  }
  await submitMessage(label)
}

const submitMessage = async (text: string) => {
  const trimmed = text.trim()
  if (!trimmed) return
  if (isProcessing.value) return

  isProcessing.value = true
  try {
    const messageContent: UserMessageContent = {
      text: trimmed,
      files: [],
      links: [],
      search: canUseWebSearch.value ? settings.value.webSearch : false,
      think: settings.value.deepThinking,
      content: [{ type: 'text', content: trimmed }]
    }
    await chatStore.sendMessage(messageContent)
  } catch (error) {
    console.error('Failed to submit question answer:', error)
  } finally {
    isProcessing.value = false
  }
}

const submitSelection = async () => {
  if (isMulti.value) {
    const customText = allowCustom.value ? customAnswer.value.trim() : ''
    const lines = [...selectedOptions.value]
    if (customText) {
      lines.push(customText)
    }
    await submitMessage(lines.join('\n'))
    return
  }
  if (allowCustom.value) {
    await submitMessage(customAnswer.value.trim())
  }
}

const rejectQuestion = async () => {
  const toolCallId = props.block.tool_call?.id
  if (!toolCallId || isProcessing.value) return
  isProcessing.value = true
  try {
    await agentPresenter.rejectQuestion(props.messageId, toolCallId)
  } catch (error) {
    console.error('Failed to reject question:', error)
  } finally {
    isProcessing.value = false
  }
}

const handleCustomKeydown = async (event: KeyboardEvent) => {
  if (event.key !== 'Enter') return
  if (isMulti.value) {
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      await submitSelection()
    }
    return
  }
  event.preventDefault()
  await submitSelection()
}

const focusCustomInput = () => {
  if (!allowCustom.value || !isPending.value) return
  nextTick(() => {
    const inputEl = customInputRef.value?.$el
    inputEl?.focus()
  })
}

onMounted(() => {
  focusCustomInput()
})

watch(
  () => [isPending.value, allowCustom.value] as const,
  ([pending, customEnabled]) => {
    if (pending && customEnabled) {
      focusCustomInput()
    }
  }
)
</script>

<style scoped></style>
