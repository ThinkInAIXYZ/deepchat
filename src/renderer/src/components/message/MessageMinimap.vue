<template>
  <div class="message-minimap-container">
    <div class="message-minimap-bars" role="list">
      <button
        v-for="bar in bars"
        :key="bar.id"
        type="button"
        class="message-minimap-bar"
        :class="[
          bar.role === 'assistant' ? 'assistant-bar' : 'user-bar',
          hoveredMessageId === bar.id ? 'is-hovered' : '',
          activeMessageId === bar.id ? 'is-active' : ''
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
    <div v-if="overallContextUsage !== null" class="message-minimap-usage">
      {{ overallContextUsage.toFixed(0) }}%
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AssistantMessage, Message, UserMessage } from '@shared/chat'

interface Props {
  messages: Message[]
  hoveredMessageId?: string | null
  activeMessageId?: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'bar-hover', messageId: string | null): void
  (e: 'bar-click', messageId: string): void
}>()

const localHoveredId = ref<string | null>(null)

const MIN_WIDTH = 8
const MAX_WIDTH = 24

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

const overallContextUsage = computed(() => {
  const usageValues = props.messages
    ?.map((message) => message.usage?.context_usage)
    .filter((value): value is number => typeof value === 'number' && !Number.isNaN(value))

  if (!usageValues?.length) {
    return null
  }

  return Math.max(...usageValues)
})

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

<style scoped>
.message-minimap-container {
  box-sizing: border-box;
  position: absolute;
  top: 8px;
  right: 12px;
  width: 56px;
  min-height: 148px;
  border: 1px dashed #9747ff;
  border-radius: 6px;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  background-color: transparent;
  backdrop-filter: none;
  pointer-events: auto;
  z-index: 5;
}

.dark .message-minimap-container {
  border-color: rgba(151, 71, 255, 0.6);
}

.message-minimap-bars {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  width: 100%;
}

.message-minimap-bar {
  height: 6px;
  border-radius: 2px;
  transition:
    transform 0.2s ease,
    opacity 0.2s ease,
    background-color 0.2s ease;
  opacity: 0.55;
  outline: none;
  border: none;
  cursor: pointer;
}

.message-minimap-bar:focus-visible {
  box-shadow: 0 0 0 2px rgba(151, 71, 255, 0.35);
}

.assistant-bar {
  background: rgba(37, 37, 37, 0.65);
}

.dark .assistant-bar {
  background: rgba(255, 255, 255, 0.85);
}

.user-bar {
  background: rgba(37, 37, 37, 0.25);
}

.dark .user-bar {
  background: rgba(255, 255, 255, 0.4);
}

.message-minimap-bar.is-hovered,
.message-minimap-bar.is-active {
  opacity: 1;
  transform: scaleX(1.05);
}

.message-minimap-bar.is-active {
  box-shadow: 0 0 0 1px rgba(151, 71, 255, 0.4);
}

.message-minimap-usage {
  font-family:
    'Geist Mono', ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
  font-size: 11px;
  line-height: 1;
  color: rgba(37, 37, 37, 0.6);
}

.dark .message-minimap-usage {
  color: rgba(255, 255, 255, 0.6);
}
</style>
