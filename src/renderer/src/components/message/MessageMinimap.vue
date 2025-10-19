<template>
  <div
    class="absolute top-0 right-0 w-14 min-h-[148px] box-border rounded-[6px] py-4 px-3 flex flex-col items-stretch gap-0 pointer-events-none z-[5] overflow-hidden"
    :style="containerStyle"
  >
    <div
      class="relative flex-none flex justify-end overflow-hidden w-full pointer-events-auto"
      :style="trackStyle"
    >
      <div
        class="flex flex-col items-end gap-1 w-full relative z-[2]"
        role="list"
        :style="barsWrapperStyle"
      >
        <button
          v-for="bar in bars"
          :key="bar.id"
          type="button"
          class="h-1.5 rounded-xs transition-[transform,opacity,background-color] duration-200 ease-out opacity-30 outline-none border-0 cursor-pointer focus-visible:outline-none"
          :class="[
            bar.role === 'assistant'
              ? 'bg-[rgba(37,37,37,0.65)] dark:bg-[rgba(255,255,255,0.9)]'
              : 'bg-[rgba(37,37,37,0.25)] dark:bg-[rgba(255,255,255,0.6)]',
            hoveredMessageId === bar.id || activeMessageId === bar.id
              ? 'opacity-100 scale-x-110 -translate-x-0.5'
              : ''
          ]"
          :style="{ width: `${bar.width}px` }"
          :aria-label="bar.ariaLabel"
          role="listitem"
          @mouseenter="handleBarEnter(bar.id)"
          @mouseleave="handleBarLeave"
          @focus="handleBarEnter(bar.id)"
          @blur="handleBarLeave"
          @click="handleBarClick(bar.id)"
        />
      </div>
    </div>
    <div
      v-if="overallContextUsage !== null"
      class="font-['Geist\\ Mono',ui-monospace,SFMono-Regular,SFMono,Menlo,Monaco,Consolas,'Liberation\\ Mono','Courier\\ New',monospace] text-[11px] leading-none text-[rgba(37,37,37,0.6)] mt-[6px] self-end dark:text-[rgba(255,255,255,0.6)]"
    >
      {{ overallContextUsage.toFixed(0) }}%
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AssistantMessage, Message, UserMessage } from '@shared/chat'

interface ScrollInfo {
  viewportHeight: number
  contentHeight: number
  scrollTop: number
}

interface Props {
  messages: Message[]
  hoveredMessageId?: string | null
  activeMessageId?: string | null
  scrollInfo?: ScrollInfo
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'bar-hover', messageId: string | null): void
  (e: 'bar-click', messageId: string): void
}>()

const localHoveredId = ref<string | null>(null)

const MIN_WIDTH = 8
const MAX_WIDTH = 20
const DEFAULT_VIEWPORT_HEIGHT = 220
const BAR_HEIGHT = 6
const BAR_GAP = 4
const MIN_TRACK_HEIGHT = BAR_HEIGHT
const USAGE_LABEL_HEIGHT = 24
const USAGE_SECTION_GAP = 6

const getMessageContentLength = (message: Message) => {
  if (message.role === 'assistant') {
    const assistantMessage = message as AssistantMessage
    const blocks = assistantMessage.content ?? []
    const combined = blocks
      .filter((block) => block.type === 'content' || block.type === 'reasoning_content')
      .map((block) => block.content ?? '')
      .join(' ')
    const usageTokens = assistantMessage.usage?.total_tokens ?? 0
    return usageTokens > 0 ? usageTokens : combined.length
  }

  const userMessage = message as UserMessage
  const content = userMessage.content
  const textParts: string[] = []
  if (content?.text) {
    textParts.push(content.text)
  }
  content?.content?.forEach((block) => {
    if ('content' in block && typeof block.content === 'string') {
      textParts.push(block.content)
    }
  })
  if (content?.files?.length) {
    textParts.push(content.files.map((file) => file.name ?? '').join(' '))
  }
  return textParts.join(' ').length || (userMessage.usage?.input_tokens ?? 0)
}

const bars = computed(() => {
  if (!props.messages?.length) {
    return []
  }

  const messageLengths = props.messages.map((message) => ({
    id: message.id,
    role: message.role,
    length: getMessageContentLength(message),
    contextUsage: message.usage?.context_usage ?? 0
  }))

  const maxLength = Math.max(...messageLengths.map((item) => item.length), 1)

  return messageLengths.map((item, index) => {
    const normalized = maxLength === 0 ? 0 : item.length / maxLength
    const width = MIN_WIDTH + normalized * (MAX_WIDTH - MIN_WIDTH)
    return {
      id: item.id,
      role: item.role,
      width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)),
      ariaLabel: `Message ${index + 1}, ${item.role}`,
      contextUsage: item.contextUsage
    }
  })
})

const totalBarsHeight = computed(() => {
  if (!bars.value.length) return 0
  return bars.value.length * BAR_HEIGHT + (bars.value.length - 1) * BAR_GAP
})

const containerHeight = computed(() => {
  const viewportHeight = props.scrollInfo?.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT
  return Math.max(viewportHeight, DEFAULT_VIEWPORT_HEIGHT)
})

const overallContextUsage = computed(() => {
  const usageValues = props.messages
    ?.map((message) => message.usage?.context_usage)
    .filter((value): value is number => typeof value === 'number' && !Number.isNaN(value))

  if (!usageValues?.length) {
    return null
  }

  return Math.max(...usageValues)
})

const usageSectionHeight = computed(() => {
  if (overallContextUsage.value === null) {
    return 0
  }
  return USAGE_LABEL_HEIGHT + USAGE_SECTION_GAP
})

const maxTrackHeight = computed(() =>
  Math.max(containerHeight.value - usageSectionHeight.value, MIN_TRACK_HEIGHT)
)

const trackHeight = computed(() => {
  if (!totalBarsHeight.value) {
    return maxTrackHeight.value
  }
  return Math.min(totalBarsHeight.value, maxTrackHeight.value)
})

const scaleRatio = computed(() => {
  if (!totalBarsHeight.value) return 1
  if (totalBarsHeight.value <= trackHeight.value) return 1
  return trackHeight.value / totalBarsHeight.value
})

const barsWrapperStyle = computed(() => {
  const style: Record<string, string> = {
    height: `${Math.max(totalBarsHeight.value, 0)}px`,
    width: '100%'
  }
  if (scaleRatio.value < 0.999) {
    style.transform = `scaleY(${scaleRatio.value})`
    style.transformOrigin = 'top right'
  }
  return style
})

const containerStyle = computed(() => ({
  height: `${containerHeight.value}px`
}))

const trackStyle = computed(() => ({
  height: `${Math.max(trackHeight.value, MIN_TRACK_HEIGHT)}px`
}))

watch(
  () => props.hoveredMessageId,
  (value) => {
    localHoveredId.value = value as string | null
  }
)

const hoveredMessageId = computed(() => props.hoveredMessageId ?? localHoveredId.value)
const activeMessageId = computed(() => props.activeMessageId ?? null)

const handleBarEnter = (messageId: string) => {
  localHoveredId.value = messageId
  emit('bar-hover', messageId)
}

const handleBarLeave = () => {
  localHoveredId.value = null
  emit('bar-hover', null)
}

const handleBarClick = (messageId: string) => {
  emit('bar-click', messageId)
}
</script>
