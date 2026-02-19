<template>
  <TooltipProvider :delay-duration="200">
    <div class="h-full overflow-y-auto">
      <ChatTopBar :title="sessionTitle" :project="sessionProject" />
      <MessageList :messages="displayMessages" />

      <!-- Input area (sticky bottom, messages scroll under) -->
      <div class="sticky bottom-0 z-10 px-6 pt-3 pb-3">
        <div class="flex flex-col items-center">
          <ChatInputBox v-model="message" @submit="onSubmit">
            <template #toolbar>
              <ChatInputToolbar @send="onSubmit" />
            </template>
          </ChatInputBox>
          <ChatStatusBar />
        </div>
      </div>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import ChatTopBar from '@/components/chat/ChatTopBar.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatInputBox from '@/components/chat/ChatInputBox.vue'
import ChatInputToolbar from '@/components/chat/ChatInputToolbar.vue'
import ChatStatusBar from '@/components/chat/ChatStatusBar.vue'
import { useSessionStore } from '@/stores/ui/session'
import { useMessageStore } from '@/stores/ui/message'
import type { Message } from '@shared/chat'
import type { ChatMessageRecord, AssistantMessageBlock } from '@shared/types/agent-interface'

const props = defineProps<{
  sessionId: string
}>()

const sessionStore = useSessionStore()
const messageStore = useMessageStore()

const sessionTitle = computed(() => sessionStore.activeSession?.title ?? 'New Chat')
const sessionProject = computed(() => sessionStore.activeSession?.projectDir ?? '')

// Load messages when sessionId changes
watch(
  () => props.sessionId,
  (id) => {
    if (id) messageStore.loadMessages(id)
  },
  { immediate: true }
)

// Map ChatMessageRecord → old Message format for MessageList
function toDisplayMessage(record: ChatMessageRecord): Message {
  const parsed = JSON.parse(record.content)
  return {
    id: record.id,
    content: parsed,
    role: record.role,
    timestamp: record.createdAt,
    avatar: '',
    name: record.role === 'user' ? 'You' : 'Assistant',
    model_name: '',
    model_id: sessionStore.activeSession?.modelId ?? '',
    model_provider: sessionStore.activeSession?.providerId ?? '',
    status: record.status,
    error: '',
    usage: {
      context_usage: 0,
      tokens_per_second: 0,
      total_tokens: 0,
      generation_time: 0,
      first_token_time: 0,
      reasoning_start_time: 0,
      reasoning_end_time: 0,
      input_tokens: 0,
      output_tokens: 0
    },
    conversationId: record.sessionId,
    is_variant: 0
  }
}

// Build a streaming assistant message from live blocks
function toStreamingMessage(blocks: AssistantMessageBlock[]): Message {
  return {
    id: '__streaming__',
    content: blocks,
    role: 'assistant',
    timestamp: Date.now(),
    avatar: '',
    name: 'Assistant',
    model_name: '',
    model_id: sessionStore.activeSession?.modelId ?? '',
    model_provider: sessionStore.activeSession?.providerId ?? '',
    status: 'pending',
    error: '',
    usage: {
      context_usage: 0,
      tokens_per_second: 0,
      total_tokens: 0,
      generation_time: 0,
      first_token_time: 0,
      reasoning_start_time: 0,
      reasoning_end_time: 0,
      input_tokens: 0,
      output_tokens: 0
    },
    conversationId: props.sessionId,
    is_variant: 0
  }
}

const displayMessages = computed(() => {
  const msgs = messageStore.messages.map(toDisplayMessage)

  // Append live streaming blocks as a virtual message
  if (messageStore.isStreaming && messageStore.streamingBlocks.length > 0) {
    msgs.push(toStreamingMessage(messageStore.streamingBlocks))
  }

  return msgs
})

const message = ref('')

async function onSubmit() {
  const text = message.value.trim()
  if (!text) return
  message.value = ''
  await sessionStore.sendMessage(props.sessionId, text)
}
</script>
