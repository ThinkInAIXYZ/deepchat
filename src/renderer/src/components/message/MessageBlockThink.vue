<template>
  <ThinkContent
    :label="headerText"
    :expanded="!collapse"
    :thinking="isThinking"
    :content="block.content"
    @toggle="toggleExpanded"
  />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ThinkContent } from '@/components/think-content'
import { computed, onMounted, ref, watch } from 'vue'
import { createConfigClient } from '@api/ConfigClient'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
const props = withDefaults(
  defineProps<{
    block: DisplayAssistantMessageBlock
    initiallyExpanded?: boolean
    usage: {
      reasoning_start_time: number
      reasoning_end_time: number
    }
  }>(),
  { initiallyExpanded: undefined }
)

const emit = defineEmits<{
  (e: 'toggle-collapse', isCollapsed: boolean): void
  (e: 'manual-toggle', expanded: boolean): void
}>()
const { t } = useI18n()

const configClient = createConfigClient()

const collapse = ref(props.initiallyExpanded !== true)
let hasManualToggle = props.initiallyExpanded !== undefined

const toggleExpanded = () => {
  hasManualToggle = true
  collapse.value = !collapse.value
  void configClient.setSetting('think_collapse', collapse.value)
  emit('manual-toggle', !collapse.value)
}

const isThinking = computed(() => props.block.status === 'loading')
const now = ref(Date.now())
const displayedSeconds = computed(() => {
  const time = props.block.reasoning_time
  const range =
    time && typeof time === 'object' && Number.isFinite(time.start) && Number.isFinite(time.end)
      ? time
      : undefined
  const start = range?.start ?? props.block.timestamp
  const duration = range
    ? range.end - range.start
    : props.usage.reasoning_end_time - props.usage.reasoning_start_time
  const elapsed = isThinking.value ? Math.max(duration, now.value - start) : duration
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 1000)) : 0
})

watch(
  isThinking,
  (thinking, _, onCleanup) => {
    if (!thinking) return
    now.value = Date.now()
    const timer = setInterval(() => (now.value = Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  },
  { immediate: true }
)

const isModeChange = computed(() => {
  return props.block.extra?.mode_change !== undefined
})

const modeChangeId = computed(() => {
  return props.block.extra?.mode_change as string
})

const headerText = computed(() => {
  if (isModeChange.value) {
    return t('chat.features.modeChanged', { mode: modeChangeId.value })
  }
  const seconds = displayedSeconds.value
  if (isThinking.value) {
    return seconds === 0
      ? t('chat.messages.thinking')
      : t('chat.features.thoughtForSecondsLoading', { seconds })
  }
  return seconds === 0
    ? t('chat.features.thoughtForLessThanOneSecond')
    : t('chat.features.thoughtForSeconds', { seconds })
})

watch(
  () => collapse.value,
  (newValue) => {
    emit('toggle-collapse', !newValue)
  }
)

onMounted(async () => {
  const savedCollapse = Boolean(await configClient.getSetting('think_collapse'))
  if (!hasManualToggle) collapse.value = savedCollapse
})
</script>
