<template>
  <div class="my-1 flex flex-col gap-2">
    <p class="text-sm text-foreground whitespace-pre-wrap break-words">
      {{ questionText }}
    </p>

    <div v-if="options.length" class="flex flex-wrap gap-1.5">
      <span
        v-for="option in options"
        :key="option.label"
        class="inline-flex h-7 items-center rounded-full border bg-muted/30 px-3 text-xs text-muted-foreground"
      >
        {{ option.label }}
      </span>
    </div>

    <div v-if="answerText" class="flex flex-col gap-1">
      <span class="text-[10px] uppercase tracking-wide text-muted-foreground">
        {{ t('components.messageBlockQuestionRequest.answerLabel') }}
      </span>
      <p class="text-xs whitespace-pre-wrap break-words">
        {{ answerText }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'
import type { QuestionOption } from '@shared/types/core/question'

const props = defineProps<{
  block: DisplayAssistantMessageBlock
}>()

const { t } = useI18n()

const questionText = computed(() => {
  const raw = props.block.extra?.questionText
  if (typeof raw === 'string' && raw.trim()) return raw
  return props.block.content || ''
})

const answerText = computed(() => {
  const raw = props.block.extra?.answerText
  return typeof raw === 'string' ? raw : ''
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

const options = computed<QuestionOption[]>(() =>
  Array.isArray(props.block.extra?.questionOptions)
    ? props.block.extra.questionOptions
        .map((option) => normalizeOption(option))
        .filter((option): option is QuestionOption => Boolean(option))
    : []
)
</script>

<style scoped></style>
