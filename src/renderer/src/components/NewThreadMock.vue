<template>
  <TooltipProvider :delay-duration="200">
    <div class="h-full w-full flex flex-col">
      <!-- Main content area (centered) -->
      <div class="flex-1 flex flex-col items-center justify-center px-6">
        <!-- Logo -->
        <div class="mb-4">
          <img src="@/assets/logo-dark.png" class="w-14 h-14" loading="lazy" />
        </div>

        <!-- Heading -->
        <h1 class="text-3xl font-semibold text-foreground mb-8">Build and explore</h1>

        <!-- Input area -->
        <MockInputBox>
          <template #toolbar>
            <MockInputToolbar />
          </template>
        </MockInputBox>

        <!-- Status bar -->
        <MockStatusBar />
      </div>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import MockInputBox from './mock/MockInputBox.vue'
import MockInputToolbar from './mock/MockInputToolbar.vue'
import MockStatusBar from './mock/MockStatusBar.vue'
</script>
