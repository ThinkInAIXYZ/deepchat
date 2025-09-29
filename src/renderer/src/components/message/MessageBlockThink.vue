<template>
  <ThinkContent
    :label="headerText"
    :expanded="!collapse"
    :thinking="block.status === 'loading'"
    :content-html="renderedContent"
    @toggle="collapse = !collapse"
  />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ThinkContent } from '@/components/think-content'
import { computed, onMounted, ref, watch } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { renderMarkdown, getCommonMarkdown } from 'vue-renderer-markdown'
import { AssistantMessageBlock } from '@shared/chat'
const props = defineProps<{
  block: AssistantMessageBlock
  usage: {
    reasoning_start_time: number
    reasoning_end_time: number
  }
}>()
const { t } = useI18n()

const configPresenter = usePresenter('configPresenter')

// kept for potential future scroll anchoring; currently unused

const collapse = ref(false)
const reasoningDuration = computed(() => {
  let duration: number
  if (props.block.reasoning_time) {
    duration = (props.block.reasoning_time.end - props.block.reasoning_time.start) / 1000
  } else {
    duration = (props.usage.reasoning_end_time - props.usage.reasoning_start_time) / 1000
  }
  // 保留小数点后最多两位，去除尾随的0
  return parseFloat(duration.toFixed(2))
})

const md = getCommonMarkdown()
const renderedContent = computed(() => {
  return renderMarkdown(md, props.block.content || '')
})

const headerText = computed(() => {
  // Format: "Thought for 20s" (localized)
  const seconds = Math.max(0, Math.floor(reasoningDuration.value))
  return props.block.status === 'loading'
    ? t('chat.features.thoughtForSecondsLoading', { seconds })
    : t('chat.features.thoughtForSeconds', { seconds })
})

watch(
  () => collapse.value,
  () => {
    configPresenter.setSetting('think_collapse', collapse.value)
  }
)

onMounted(async () => {
  collapse.value = Boolean(await configPresenter.getSetting('think_collapse'))
})
</script>
