<template>
  <div class="flex-1 overflow-y-auto">
    <div class="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div v-for="msg in messages" :key="msg.id">
        <!-- User message -->
        <div v-if="msg.role === 'user'" class="flex justify-end mb-6">
          <div class="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5">
            <p class="text-sm whitespace-pre-wrap">{{ msg.content }}</p>
          </div>
        </div>

        <!-- Assistant message -->
        <div v-else class="flex gap-3 mb-6">
          <div class="shrink-0 mt-1">
            <div class="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
              <ModelIcon model-id="anthropic" custom-class="w-4 h-4" :is-dark="themeStore.isDark" />
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-xs text-muted-foreground mb-1">Claude 4 Sonnet</p>
            <div class="text-sm leading-relaxed whitespace-pre-wrap">{{ msg.content }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ModelIcon from '../icons/ModelIcon.vue'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()

defineProps<{
  messages: { id: string; role: 'user' | 'assistant'; content: string }[]
}>()
</script>
