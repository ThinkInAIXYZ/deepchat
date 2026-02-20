<template>
  <TooltipProvider :delay-duration="200">
    <div class="h-full overflow-y-auto">
      <ChatPreviewTopBar :title="title" :project="project" />
      <ChatPreviewMessageList />

      <!-- Input area (sticky bottom, messages scroll under) -->
      <div class="sticky bottom-0 z-10 px-6 pt-3 pb-3">
        <div class="flex flex-col items-center">
          <InputBox variant="chat" :disabled="true" />
          <StatusBar />
        </div>
      </div>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import ChatPreviewTopBar from './ChatPreviewTopBar.vue'
import ChatPreviewMessageList from './ChatPreviewMessageList.vue'
import InputBox from './chat-input/InputBox.vue'
import StatusBar from './StatusBar.vue'

defineProps<{
  title: string
  project: string
}>()
</script>
