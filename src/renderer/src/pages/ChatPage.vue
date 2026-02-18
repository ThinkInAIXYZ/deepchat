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
import { ref, computed } from 'vue'
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import ChatTopBar from '@/components/chat/ChatTopBar.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatInputBox from '@/components/chat/ChatInputBox.vue'
import ChatInputToolbar from '@/components/chat/ChatInputToolbar.vue'
import ChatStatusBar from '@/components/chat/ChatStatusBar.vue'
import { useSessionStore } from '@/stores/ui/session'
import { useChatStore } from '@/stores/chat'

defineProps<{
  sessionId: string
}>()

const sessionStore = useSessionStore()
const chatStore = useChatStore()

const sessionTitle = computed(() => sessionStore.activeSession?.title ?? 'New Chat')
const sessionProject = computed(() => sessionStore.activeSession?.projectDir ?? '')

// Use the existing chat store's messages (loaded via ACTIVATED event)
const displayMessages = computed(() => chatStore.variantAwareMessages)

const message = ref('')

async function onSubmit() {
  const text = message.value.trim()
  if (!text) return
  message.value = ''
  await chatStore.sendMessage({
    text,
    files: [],
    links: [],
    search: false,
    think: false
  })
}
</script>
