<template>
  <div class="my-1 flex flex-col gap-2">
    <p class="text-sm text-foreground whitespace-pre-wrap break-words">
      {{ questionText }}
    </p>

    <div v-if="isPending" class="flex flex-wrap gap-2">
      <Button
        v-for="option in options"
        :key="option.label"
        variant="outline"
        size="sm"
        class="h-auto rounded-full px-4 py-1.5 text-xs text-foreground bg-muted/40 border-border hover:bg-muted/60"
        :disabled="isProcessing"
        @click="handleOptionClick(option.label)"
      >
        <span class="flex flex-col items-start gap-0.5 text-left whitespace-pre-wrap break-words">
          <span class="text-xs font-medium">{{ option.label }}</span>
          <span v-if="option.description" class="text-[11px] text-muted-foreground">
            {{ option.description }}
          </span>
        </span>
      </Button>
    </div>

    <div v-else class="flex flex-col gap-1">
      <span v-if="isRejected" class="text-xs text-muted-foreground">
        {{ t('components.messageBlockQuestionRequest.rejected') }}
      </span>
      <template v-else>
        <span class="text-[10px] uppercase tracking-wide text-muted-foreground">
          {{ t('components.messageBlockQuestionRequest.answerLabel') }}
        </span>
        <p class="text-xs whitespace-pre-wrap break-words">
          {{ answerText }}
        </p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { useChatStore } from '@/stores/chat'
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
const chatMode = useChatMode()
const { settings } = useInputSettings()

const isProcessing = ref(false)

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

const handleOptionClick = async (label: string) => {
  if (isProcessing.value) return
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
</script>

<style scoped></style>
