<template>
  <TooltipProvider :delay-duration="200">
    <div class="h-full w-full flex flex-col">
      <!-- Main content area (centered) -->
      <div class="flex-1 flex flex-col items-center justify-center px-6">
        <!-- Logo -->
        <div class="mb-4">
          <img src="@/assets/logo-dark.png" class="w-14 h-14" loading="lazy" />
        </div>

        <!-- Heading - 写死英文，不使用 i18n -->
        <h1 class="text-3xl font-semibold text-foreground mb-4">Build and explore</h1>

        <!-- Workdir selector only (Agent 由左侧 sidebar 决定) -->
        <div class="flex items-center gap-2 mb-6">
          <WorkdirSelector
            :workdir="workdir"
            :recent-workdirs="recentWorkdirs"
            @update:workdir="selectWorkdir"
            @browse="browseDirectory"
          />
        </div>

        <!-- Input area -->
        <InputBox>
          <template #toolbar>
            <InputToolbar />
          </template>
        </InputBox>

        <!-- Status bar - 绑定真实逻辑 -->
        <StatusBar />
      </div>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import InputBox from './mock/InputBox.vue'
import InputToolbar from './mock/InputToolbar.vue'
import StatusBar from './mock/StatusBar.vue'
import WorkdirSelector from './mock/WorkdirSelector.vue'
import { useNewThread } from '@/composables/useNewThread'

const { workdir, recentWorkdirs, selectWorkdir, browseDirectory } = useNewThread()
</script>
