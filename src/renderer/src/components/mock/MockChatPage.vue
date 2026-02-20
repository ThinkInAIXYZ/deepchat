<template>
  <TooltipProvider :delay-duration="200">
    <div class="h-full overflow-y-auto">
      <MockTopBar :title="title" :project="project" />
      <MockMessageList />

      <!-- Input area (sticky bottom, messages scroll under) -->
      <div class="sticky bottom-0 z-10 px-6 pt-3 pb-3">
        <div class="flex flex-col items-center">
          <InputBox>
            <template #toolbar>
              <InputToolbar />
            </template>
          </InputBox>
          <StatusBar />
        </div>
      </div>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import MockTopBar from './MockTopBar.vue'
import MockMessageList from './MockMessageList.vue'
import InputBox from './InputBox.vue'
import InputToolbar from './InputToolbar.vue'
import StatusBar from './StatusBar.vue'

defineProps<{
  title: string
  project: string
}>()
</script>
