<template>
  <ThinkContent
    :label="headerText"
    :expanded="!collapse"
    :thinking="block.status === 'loading'"
    :content="block.content"
    @toggle="collapse = !collapse"
  />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ThinkContent } from '@/components/think-content'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
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
const displayedSeconds = ref(0)
const UPDATE_INTERVAL = 1000
const UPDATE_OFFSET = 80
let updateTimer: ReturnType<typeof setTimeout> | null = null

const reasoningDuration = computed(() => {
  let duration = 0
  if (props.block.reasoning_time) {
    duration = (props.block.reasoning_time.end - props.block.reasoning_time.start) / 1000
  } else {
    duration = (props.usage.reasoning_end_time - props.usage.reasoning_start_time) / 1000
  }
  // 保留小数点后最多两位，去除尾随的0
  return parseFloat(duration.toFixed(2))
})

const updateDisplayedSeconds = () => {
  const normalized = Number.isFinite(reasoningDuration.value) ? reasoningDuration.value : 0
  const value = Math.max(0, Math.floor(normalized))
  displayedSeconds.value = value
}

const stopTimer = () => {
  if (updateTimer !== null) {
    clearTimeout(updateTimer)
    updateTimer = null
  }
}

const scheduleNextUpdate = () => {
  stopTimer()
  if (props.block.status !== 'loading') return

  const fallbackDuration = Number.isFinite(reasoningDuration.value)
    ? reasoningDuration.value * 1000
    : 0
  const startTimestamp = props.block.reasoning_time?.start ?? Date.now() - fallbackDuration
  const now = Date.now()
  const elapsed = Math.max(0, now - startTimestamp)
  const remainder = elapsed % UPDATE_INTERVAL
  const delay = Math.max(UPDATE_INTERVAL - remainder, 0) + UPDATE_OFFSET

  updateTimer = setTimeout(() => {
    updateDisplayedSeconds()
    scheduleNextUpdate()
  }, delay)
}

const headerText = computed(() => {
  const seconds = displayedSeconds.value
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

watch(
  () => [props.block.status, props.block.reasoning_time?.start],
  () => {
    updateDisplayedSeconds()
    if (props.block.status === 'loading') {
      scheduleNextUpdate()
    } else {
      stopTimer()
    }
  },
  { immediate: true }
)

watch(
  () => reasoningDuration.value,
  () => {
    if (props.block.status !== 'loading') {
      updateDisplayedSeconds()
    }
  }
)

onMounted(async () => {
  collapse.value = Boolean(await configPresenter.getSetting('think_collapse'))
})

onBeforeUnmount(() => {
  stopTimer()
})
</script>
