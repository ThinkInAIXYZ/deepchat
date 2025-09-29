<template>
  <ThinkContent
    :title="headerTitle"
    :header-label="t('chat.features.deepThinking')"
    :content="block.content || ''"
    :meta="durationLabel"
    :progress-label="t('chat.features.deepThinkingProgress')"
    :loading="block.status === 'loading'"
    :collapsed="collapse"
    @update:collapsed="handleCollapseChange"
  />
</template>

<script setup lang="ts">
import { usePresenter } from '@/composables/usePresenter'
import { AssistantMessageBlock } from '@shared/chat'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ThinkContent from '@/components/think-content'

const props = defineProps<{
  block: AssistantMessageBlock
  usage: {
    reasoning_start_time: number
    reasoning_end_time: number
  }
}>()
const { t } = useI18n()

const configPresenter = usePresenter('configPresenter')

const collapse = ref(false)

const reasoningDuration = computed(() => {
  let duration: number
  if (props.block.reasoning_time) {
    duration = (props.block.reasoning_time.end - props.block.reasoning_time.start) / 1000
  } else {
    duration = (props.usage.reasoning_end_time - props.usage.reasoning_start_time) / 1000
  }
  return parseFloat(duration.toFixed(2))
})

const durationLabel = computed(() =>
  reasoningDuration.value > 0 ? t('chat.features.thinkingDuration', [reasoningDuration.value]) : undefined
)

const headerTitle = computed(() =>
  props.block.status === 'loading'
    ? t('chat.features.deepThinkingProgress')
    : t('chat.features.deepThinking')
)

const handleCollapseChange = (value: boolean) => {
  collapse.value = value
}

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
