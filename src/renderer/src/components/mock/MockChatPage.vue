<template>
  <TooltipProvider :delay-duration="200">
    <div class="h-full overflow-y-auto">
      <MockTopBar :title="title" :project="project" />
      <MockMessageList />

      <!-- Input area (sticky bottom, messages scroll under) -->
      <div class="sticky bottom-0 z-10 px-6 pt-3 pb-3">
        <div class="flex flex-col items-center">
          <MockInputBox>
            <template #toolbar>
              <MockInputToolbar />
            </template>
          </MockInputBox>
          <MockStatusBar />
        </div>
      </div>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import MockTopBar from './MockTopBar.vue'
import MockMessageList from './MockMessageList.vue'
import MockInputBox from './MockInputBox.vue'
import MockInputToolbar from './MockInputToolbar.vue'
import MockStatusBar from './MockStatusBar.vue'

defineProps<{
  title: string
  project: string
}>()
</script>
