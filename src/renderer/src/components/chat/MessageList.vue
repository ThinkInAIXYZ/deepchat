<template>
  <div class="flex-1 overflow-y-auto">
    <div class="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div v-for="msg in messages" :key="msg.id">
        <!-- User message -->
        <div v-if="msg.role === 'user'" class="flex justify-end mb-6">
          <div class="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5">
            <p class="text-sm whitespace-pre-wrap">{{ getUserText(msg) }}</p>
          </div>
        </div>

        <!-- Assistant message -->
        <div v-else-if="msg.role === 'assistant'" class="flex gap-3 mb-6">
          <div class="shrink-0 mt-1">
            <div class="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
              <ModelIcon
                :model-id="msg.model_provider || 'anthropic'"
                custom-class="w-4 h-4"
                :is-dark="themeStore.isDark"
              />
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-xs text-muted-foreground mb-1">{{ msg.model_name || 'Assistant' }}</p>
            <div class="text-sm leading-relaxed whitespace-pre-wrap">
              {{ getAssistantText(msg) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Message, UserMessageContent, AssistantMessageBlock } from '@shared/chat'
import ModelIcon from '../icons/ModelIcon.vue'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()

defineProps<{
  messages: Message[]
}>()

function getUserText(msg: Message): string {
  const content = msg.content as UserMessageContent
  return content?.text || ''
}

function getAssistantText(msg: Message): string {
  const blocks = msg.content as AssistantMessageBlock[]
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((b) => b.type === 'content' || b.type === 'reasoning_content')
    .map((b) => b.content || '')
    .join('\n')
}
</script>
