<template>
  <div
    class="absolute top-0 right-0 w-14 min-h-[148px] box-border rounded-md py-4 px-3 flex flex-col items-stretch gap-0 pointer-events-none z-[5] overflow-hidden"
  >
    <div
      class="map-list relative max-h-[70vh] flex-1 flex justify-end w-full pointer-events-auto overflow-y-auto"
    >
      <TooltipProvider :delay-duration="80">
        <div class="flex flex-col items-end gap-1 w-full relative z-2" role="list">
          <TooltipRoot v-for="bar in bars" :key="bar.id">
            <TooltipTrigger>
              <button
                type="button"
                class="w-full h-2.5 pl-2 pr-1.5 flex items-center justify-end gap-1 rounded-sm transition-[transform,opacity] duration-200 ease-out outline-none border-0 cursor-pointer focus-visible:outline-none"
                :class="[
                  isActiveBar(bar.id) ? 'opacity-100' : 'opacity-60',
                  bar.isStreamingPlaceholder ? 'pointer-events-none' : ''
                ]"
                :aria-label="bar.ariaLabel"
                role="listitem"
                @mouseenter="handleBarEnter(bar.id)"
                @mouseleave="handleBarLeave"
                @focus="handleBarEnter(bar.id)"
                @blur="handleBarLeave"
                @click.stop="handleBarClick(bar.id)"
              >
                <span
                  class="block h-1.5 rounded-xs transition-[transform,background-color] duration-200 ease-out pointer-events-none"
                  :class="[
                    bar.role === 'assistant'
                      ? isActiveBar(bar.id)
                        ? 'bg-[rgba(37,37,37,0.75)] dark:bg-[rgba(255,255,255,0.95)]'
                        : 'bg-[rgba(37,37,37,0.3)] dark:bg-[rgba(255,255,255,0.5)]'
                      : isActiveBar(bar.id)
                        ? 'bg-[rgba(37,37,37,0.55)] dark:bg-[rgba(255,255,255,0.8)]'
                        : 'bg-[rgba(37,37,37,0.2)] dark:bg-[rgba(255,255,255,0.35)]',
                    isActiveBar(bar.id) ? 'scale-x-110 -translate-x-0.5' : '',
                    bar.isStreamingPlaceholder ? 'animate-pulse' : ''
                  ]"
                  :style="{ width: `${bar.width}px` }"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent
              v-if="getPreviewData(bar.id)"
              class="max-w-64 border border-border/60 bg-background/95 dark:bg-base-900/90 text-[11px] leading-snug rounded-md shadow-sm px-3 py-2"
              side="left"
              :side-offset="6"
              align="end"
            >
              <div class="text-[11px] font-medium text-muted-foreground mb-1 leading-none">
                #{{ getPreviewData(bar.id)?.index }} · {{ getPreviewData(bar.id)?.role }}
              </div>
              <div class="text-[11px] text-foreground/85 whitespace-pre-line">
                {{ getPreviewData(bar.id)?.preview }}
              </div>
            </TooltipContent>
          </TooltipRoot>
        </div>
      </TooltipProvider>
    </div>
    <div
      v-if="overallContextUsage !== null"
      class="font-['Geist\\ Mono',ui-monospace,SFMono-Regular,SFMono,Menlo,Monaco,Consolas,'Liberation\\ Mono','Courier\\ New',monospace] text-[11px] leading-none text-[rgba(37,37,37,0.6)] mt-[6px] self-end pointer-events-auto dark:text-[rgba(255,255,255,0.6)]"
    >
      {{ overallContextUsage.toFixed(0) }}%
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AssistantMessage, Message, UserMessage } from '@shared/chat'
import { TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'

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

type LengthCacheEntry = {
  length: number
  usageTokens: number
  blockCount: number
  lastCountedType: string
  lastCountedLength: number
  userSignature: string
}

const lengthCache = new Map<string, LengthCacheEntry>()

const sumPartsLength = (parts: string[]) => {
  if (parts.length === 0) return 0
  return parts.reduce((sum, part, index) => sum + part.length + (index > 0 ? 1 : 0), 0)
}

const resolveUserBlockText = (block: {
  type?: string
  content?: string
  category?: string
  id?: string
}) => {
  if (block?.type === 'mention' && block?.category === 'context') {
    const label = block.id?.trim() || 'context'
    return `@${label}`
  }
  return typeof block?.content === 'string' ? block.content : ''
}

const getAssistantLength = (assistantMessage: AssistantMessage) => {
  const blocks = assistantMessage.content ?? []
  const usageTokens = assistantMessage.usage?.total_tokens ?? 0
  const blockCount = blocks.length
  let lastCountedType = ''
  let lastCountedLength = 0
  for (let i = blockCount - 1; i >= 0; i -= 1) {
    const block = blocks[i]
    if (block.type === 'content' || block.type === 'reasoning_content') {
      lastCountedType = block.type
      lastCountedLength = typeof block.content === 'string' ? block.content.length : 0
      break
    }
  }
  const cached = lengthCache.get(assistantMessage.id)

  if (usageTokens > 0) {
    if (cached?.usageTokens === usageTokens) {
      return cached.length
    }
    const length = usageTokens
    lengthCache.set(assistantMessage.id, {
      length,
      usageTokens,
      blockCount,
      lastCountedType,
      lastCountedLength,
      userSignature: ''
    })
    return length
  }

  if (
    cached &&
    cached.usageTokens === 0 &&
    cached.blockCount === blockCount &&
    cached.lastCountedType === lastCountedType
  ) {
    if (cached.lastCountedLength === lastCountedLength) {
      return cached.length
    }
    const nextLength = Math.max(
      0,
      cached.length + (lastCountedLength - cached.lastCountedLength)
    )
    lengthCache.set(assistantMessage.id, {
      ...cached,
      length: nextLength,
      lastCountedLength
    })
    return nextLength
  }

  const parts = blocks
    .filter((block) => block.type === 'content' || block.type === 'reasoning_content')
    .map((block) => (typeof block.content === 'string' ? block.content : ''))
  const length = sumPartsLength(parts)
  lengthCache.set(assistantMessage.id, {
    length,
    usageTokens,
    blockCount,
    lastCountedType,
    lastCountedLength,
    userSignature: ''
  })
  return length
}

const getUserLength = (userMessage: UserMessage) => {
  const content = userMessage.content
  const textParts: string[] = []

  if (content?.text) {
    textParts.push(content.text)
  } else if (content?.content) {
    content.content.forEach((block) => {
      textParts.push(resolveUserBlockText(block))
    })
  }
  if (content?.files?.length) {
    textParts.push(...content.files.map((file) => file.name ?? ''))
  }

  const signature = `${textParts.length}:${textParts.reduce((sum, part) => sum + part.length, 0)}`
  const cached = lengthCache.get(userMessage.id)
  if (cached?.userSignature === signature) {
    return cached.length
  }

  const length = sumPartsLength(textParts) || (userMessage.usage?.input_tokens ?? 0)
  lengthCache.set(userMessage.id, {
    length,
    usageTokens: 0,
    blockCount: 0,
    lastCountedType: '',
    lastCountedLength: 0,
    userSignature: signature
  })
  return length
}

const getMessageContentLength = (message: Message) => {
  if (message.role === 'assistant') {
    return getAssistantLength(message as AssistantMessage)
  }
  return getUserLength(message as UserMessage)
}

const bars = computed(() => {
  if (!props.messages?.length) {
    return []
  }

  const activeIds = new Set<string>()
  const messageLengths = props.messages.map((message) => {
    activeIds.add(message.id)
    const isStreamingPlaceholder =
      'isStreamingPlaceholder' in message && message.isStreamingPlaceholder
    return {
      id: message.id,
      role: message.role,
      length: isStreamingPlaceholder ? 0 : getMessageContentLength(message),
      contextUsage: message.usage?.context_usage ?? 0,
      isStreamingPlaceholder
    }
  })
  for (const cachedId of lengthCache.keys()) {
    if (!activeIds.has(cachedId)) {
      lengthCache.delete(cachedId)
    }
  }

  const maxLength = Math.max(...messageLengths.map((item) => item.length), 1)

  return messageLengths.map((item, index) => {
    if (item.isStreamingPlaceholder) {
      // Streaming placeholder: use min width with pulsing animation
      return {
        id: item.id,
        role: item.role,
        width: MIN_WIDTH,
        ariaLabel: `Streaming message ${index + 1}`,
        contextUsage: item.contextUsage,
        isStreamingPlaceholder: true
      }
    }

    const normalized = maxLength === 0 ? 0 : item.length / maxLength
    const width = MIN_WIDTH + normalized * (MAX_WIDTH - MIN_WIDTH)
    return {
      id: item.id,
      role: item.role,
      width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)),
      ariaLabel: `Message ${index + 1}, ${item.role}`,
      contextUsage: item.contextUsage,
      isStreamingPlaceholder: false
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

const formatUserBlock = (block: {
  type?: string
  content?: string
  category?: string
  id?: string
}) => {
  if (block?.type === 'mention' && block?.category === 'context') {
    const label = block.id?.trim() || 'context'
    return `@${label}`
  }
  return typeof block?.content === 'string' ? block.content : ''
}

const buildPreview = (message: Message) => {
  if (message.role === 'assistant') {
    const assistant = message as AssistantMessage
    const text = (assistant.content ?? [])
      .filter((block) => block.type === 'content' || block.type === 'reasoning_content')
      .map((block) => block.content ?? '')
      .join(' ')
    return text || 'assistant'
  }
  const user = message as UserMessage
  const parts: string[] = []
  if (user.content?.text) parts.push(user.content.text)
  if (Array.isArray(user.content?.content)) {
    parts.push(...user.content.content.map((block) => formatUserBlock(block)))
  }
  if (user.content?.files?.length) {
    parts.push(user.content.files.map((file) => file.name ?? '').join(' '))
  }
  return parts.join(' ').trim() || 'user'
}

const getPreviewData = (messageId: string) => {
  const messageIndex = props.messages.findIndex((msg) => msg.id === messageId)
  if (messageIndex === -1) return null
  const message = props.messages[messageIndex]

  // Don't show tooltip for streaming placeholders
  if ('isStreamingPlaceholder' in message && message.isStreamingPlaceholder) {
    return null
  }

  const previewText = buildPreview(message)
  const roleLabel = message.role === 'assistant' ? 'assistant' : 'user'
  const truncated =
    previewText.length > 30 ? `${previewText.slice(0, 27).trimEnd()}...` : previewText
  return {
    index: messageIndex + 1,
    role: roleLabel,
    preview: truncated
  }
}

const isActiveBar = (messageId: string) => {
  return hoveredMessageId.value === messageId || activeMessageId.value === messageId
}

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
/* 自定义滚动条样式，不占用布局空间 */
.map-list::-webkit-scrollbar {
  width: 4px;
}

.map-list::-webkit-scrollbar-track {
  background: transparent;
}

.map-list::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 2px;
}

.dark .map-list::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.2);
}

.map-list::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.3);
}

.dark .map-list::-webkit-scrollbar-thumb:hover {
  background-color: rgba(255, 255, 255, 0.3);
}

/* Firefox */
.map-list {
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
}

.dark .map-list {
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}
</style>
