<template>
  <div class="flex-1 overflow-y-auto">
    <div class="max-w-3xl mx-auto px-4 py-6 space-y-1">
      <template v-for="msg in messages" :key="msg.id">
        <MessageItemUser v-if="msg.role === 'user'" :message="msg as UserMessage" />
        <MessageItemAssistant
          v-else-if="msg.role === 'assistant'"
          :message="msg as AssistantMessage"
          :is-capturing-image="false"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Message, UserMessage, AssistantMessage } from '@shared/chat'
import MessageItemAssistant from '@/components/message/MessageItemAssistant.vue'
import MessageItemUser from '@/components/message/MessageItemUser.vue'

defineProps<{
  messages: Message[]
}>()
</script>
