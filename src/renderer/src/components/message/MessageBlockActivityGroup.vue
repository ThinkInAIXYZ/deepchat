<template>
  <div class="flex flex-col w-full gap-1.5" data-testid="activity-group">
    <button
      type="button"
      data-testid="activity-group-toggle"
      class="inline-flex max-w-full min-w-0 items-center gap-[10px] self-start text-xs leading-4 text-[rgba(37,37,37,0.5)] dark:text-white/50 select-none rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      :aria-expanded="isExpanded"
      :aria-label="toggleLabel"
      @click="toggleExpanded"
    >
      <Icon
        :icon="isExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'"
        class="w-[14px] h-[14px] shrink-0 text-[rgba(37,37,37,0.5)] dark:text-white/50"
      />
      <span class="min-w-0 truncate">
        {{ titleText }}
      </span>
    </button>

    <div v-show="isExpanded" class="flex flex-col w-full gap-1.5" data-testid="activity-group-body">
      <template v-for="(block, index) in blocks" :key="buildActivityBlockKey(block, index)">
        <MessageBlockThink
          v-if="
            (block.type === 'reasoning_content' || block.type === 'artifact-thinking') &&
            block.content
          "
          :block="block"
          :usage="usage"
          @toggle-collapse="handleChildCollapseToggle"
        />
        <MessageBlockToolCall
          v-else-if="block.type === 'tool_call'"
          :block="block"
          :message-id="messageId"
          :thread-id="threadId"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import type {
  DisplayAssistantMessageBlock,
  DisplayMessageUsage
} from '@/components/chat/messageListItems'
import { formatActivityDuration } from './messageActivityGroups'
import MessageBlockThink from './MessageBlockThink.vue'
import MessageBlockToolCall from './MessageBlockToolCall.vue'

const props = defineProps<{
  blocks: DisplayAssistantMessageBlock[]
  messageId: string
  threadId: string
  usage: DisplayMessageUsage
  durationMs: number
  reasoningCount: number
  toolCallCount: number
}>()

const emit = defineEmits<{
  'toggle-collapse': [isCollapsed: boolean]
}>()

const { t, locale } = useI18n()
const isExpanded = ref(false)

const currentLocale = computed(() => {
  const value = typeof locale === 'string' ? locale : locale.value
  return value || 'en-US'
})

const durationText = computed(() => formatActivityDuration(props.durationMs, currentLocale.value))

const countSegments = computed(() => {
  const segments: string[] = []
  if (props.reasoningCount > 0) {
    segments.push(t('chat.activityCollapse.reasoningCount', { count: props.reasoningCount }))
  }
  if (props.toolCallCount > 0) {
    segments.push(t('chat.activityCollapse.toolCallCount', { count: props.toolCallCount }))
  }
  return segments
})

const titleText = computed(() =>
  [t('chat.activityCollapse.workedFor', { duration: durationText.value }), ...countSegments.value]
    .filter(Boolean)
    .join(' · ')
)

const toggleLabel = computed(() =>
  isExpanded.value
    ? t('chat.activityCollapse.collapseLabel', { title: titleText.value })
    : t('chat.activityCollapse.expandLabel', { title: titleText.value })
)

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value
  emit('toggle-collapse', !isExpanded.value)
}

const handleChildCollapseToggle = (isCollapsed: boolean) => {
  emit('toggle-collapse', isCollapsed)
}

const buildActivityBlockKey = (block: DisplayAssistantMessageBlock, index: number): string =>
  block.id ?? block.tool_call?.id ?? `${block.type}:${block.timestamp}:${index}`
</script>
