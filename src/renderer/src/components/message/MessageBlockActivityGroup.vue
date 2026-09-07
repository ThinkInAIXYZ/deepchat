<template>
  <div class="flex min-w-0 flex-col w-full" data-testid="activity-group">
    <button
      type="button"
      data-testid="activity-group-toggle"
      class="inline-flex max-w-full min-w-0 min-h-7 items-center gap-2 self-start py-1 text-sm leading-5 text-foreground/60 select-none rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
      :aria-expanded="isExpanded"
      :aria-controls="bodyId"
      :aria-label="toggleLabel"
      @click="toggleExpanded"
    >
      <Icon
        :icon="toolCallCount > 0 ? 'lucide:wrench' : 'lucide:message-circle'"
        class="w-4 h-4 shrink-0"
        aria-hidden="true"
      />
      <span class="min-w-0 truncate">
        {{ titleText }}
      </span>
      <Icon
        icon="lucide:chevron-right"
        class="w-3.5 h-3.5 shrink-0 transition-transform duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)] motion-reduce:transition-none"
        :class="isExpanded ? 'rotate-90' : 'rotate-0'"
        aria-hidden="true"
      />
    </button>

    <div
      :id="bodyId"
      class="grid w-full overflow-hidden transition-[grid-template-rows,opacity,margin-top] duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)] motion-reduce:transition-none"
      :class="
        isExpanded
          ? 'mt-1.5 grid-rows-[1fr] opacity-100'
          : 'mt-0 grid-rows-[0fr] opacity-0 pointer-events-none'
      "
      :aria-hidden="!isExpanded"
      :inert="isExpanded ? undefined : true"
      data-testid="activity-group-body-shell"
    >
      <div
        v-if="shouldRenderBody"
        class="min-h-0 min-w-0 flex flex-col w-full gap-0.5 overflow-hidden"
        data-testid="activity-group-body"
      >
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
            :read-only="readOnly"
            render-mode="tool-only"
            :permission-status="
              block.tool_call?.id ? permissionStatusByToolCallId?.[block.tool_call.id] : undefined
            "
          />
          <MessageBlockSearch
            v-else-if="block.type === 'search'"
            :block="block"
            :thread-id="threadId"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import type {
  DisplayAssistantMessageBlock,
  DisplayMessageUsage,
  ResolvedPermissionStatus
} from '@/features/chat-page/model/displayMessage'
import { formatActivityDuration } from './messageActivityGroups'
import MessageBlockThink from './MessageBlockThink.vue'
import MessageBlockToolCall from './MessageBlockToolCall.vue'
import MessageBlockSearch from './MessageBlockSearch.vue'

const props = defineProps<{
  blocks: DisplayAssistantMessageBlock[]
  messageId: string
  threadId: string
  usage: DisplayMessageUsage
  durationMs: number
  reasoningCount: number
  toolCallCount: number
  readOnly?: boolean
  permissionStatusByToolCallId?: Record<string, ResolvedPermissionStatus>
}>()

const emit = defineEmits<{
  'toggle-collapse': [isCollapsed: boolean]
}>()

const { t } = useI18n()
const isExpanded = ref(false)
const bodyId = `activity-group-${useId()}`
const shouldRenderBody = ref(false)
// Slightly past --dc-motion-default (220ms) so the collapse transition finishes first.
const BODY_UNMOUNT_DELAY_MS = 240
let bodyUnmountTimer: number | null = null

const cancelBodyUnmount = () => {
  if (bodyUnmountTimer !== null) {
    window.clearTimeout(bodyUnmountTimer)
    bodyUnmountTimer = null
  }
}

const scheduleBodyUnmount = () => {
  cancelBodyUnmount()
  bodyUnmountTimer = window.setTimeout(() => {
    bodyUnmountTimer = null
    if (!isExpanded.value) {
      shouldRenderBody.value = false
    }
  }, BODY_UNMOUNT_DELAY_MS)
}

const durationLabels = computed(() => ({
  day: t('chat.activityCollapse.duration.day'),
  hour: t('chat.activityCollapse.duration.hour'),
  minute: t('chat.activityCollapse.duration.minute'),
  second: t('chat.activityCollapse.duration.second')
}))

const durationText = computed(() => formatActivityDuration(props.durationMs, durationLabels.value))

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
  if (!isExpanded.value) {
    cancelBodyUnmount()
    shouldRenderBody.value = true
    isExpanded.value = true
    emit('toggle-collapse', false)
    return
  }

  isExpanded.value = false
  scheduleBodyUnmount()
  emit('toggle-collapse', !isExpanded.value)
}

const handleChildCollapseToggle = (isCollapsed: boolean) => {
  emit('toggle-collapse', isCollapsed)
}

const buildActivityBlockKey = (block: DisplayAssistantMessageBlock, index: number): string => {
  const stableId = block.id ?? block.tool_call?.id
  return stableId ? `${stableId}:${index}` : `${block.type}:${block.timestamp}:${index}`
}

onBeforeUnmount(() => {
  cancelBodyUnmount()
})
</script>
