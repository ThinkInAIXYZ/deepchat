<template>
  <div class="mt-4 space-y-4">
    <fieldset
      v-for="(question, index) in questions"
      :key="question.id"
      :disabled="processing"
      class="space-y-3"
    >
      <legend class="text-sm whitespace-pre-wrap break-words">{{ question.question }}</legend>
      <DcCheckboxGroup
        v-if="question.multiSelect"
        v-model="answers[index].selected"
        :options="question.options.map((option) => ({ ...option, value: option.label }))"
        :disabled="processing"
      />
      <DcRadioGroup
        v-else
        v-model="answers[index].single"
        :options="question.options.map((option) => ({ ...option, value: option.label }))"
        :disabled="processing"
        @update:model-value="answers[index].custom = ''"
      />
      <input
        v-if="question.allowCustom"
        v-model="answers[index].custom"
        type="text"
        :disabled="processing"
        :placeholder="t('components.messageBlockQuestionRequest.customPlaceholder')"
        :aria-label="`${question.question}: ${t('components.messageBlockQuestionRequest.customPlaceholder')}`"
        class="h-8 w-full rounded-md border border-input bg-background/60 px-2.5 text-xs"
        @input="onCustom(index)"
      />
    </fieldset>
    <DcButton size="sm" :disabled="processing || !complete" @click="submit">{{
      t('common.confirm')
    }}</DcButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { DcCheckboxGroup, DcRadioGroup } from '@dc-ui/components/choice-group'
import type { DimQuestion, DimQuestionAnswer } from '@shared/dimQuestions'

const props = defineProps<{ questions: DimQuestion[]; processing?: boolean }>()
const emit = defineEmits<{ answer: [answers: DimQuestionAnswer[]] }>()
const { t } = useI18n()
const answers = ref<Array<{ selected: string[]; single: string | null; custom: string }>>([])
watch(
  () => props.questions,
  () => {
    answers.value = props.questions.map(() => ({ selected: [], single: null, custom: '' }))
  },
  { immediate: true }
)
const selected = (index: number) =>
  props.questions[index].multiSelect
    ? answers.value[index].selected
    : answers.value[index].custom.trim()
      ? []
      : answers.value[index].single
        ? [answers.value[index].single!]
        : []
const complete = computed(() =>
  props.questions.every(
    (_question, index) =>
      selected(index).length > 0 || answers.value[index].custom.trim().length > 0
  )
)
function onCustom(index: number) {
  if (!props.questions[index].multiSelect && answers.value[index].custom.trim())
    answers.value[index].single = null
}
function submit() {
  if (!complete.value || props.processing) return
  emit(
    'answer',
    props.questions.map((question, index) => ({
      questionId: question.id,
      selected: selected(index),
      ...(answers.value[index].custom.trim() ? { custom: answers.value[index].custom.trim() } : {})
    }))
  )
}
</script>
