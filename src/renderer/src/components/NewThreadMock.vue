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
        <h1 class="text-3xl font-semibold text-foreground mb-4">Build and explore</h1>

        <!-- Project selector -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-2.5 gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6"
            >
              <Icon icon="lucide:folder" class="w-3.5 h-3.5" />
              <span>{{ selectedProject }}</span>
              <Icon icon="lucide:chevron-down" class="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" class="min-w-[200px]">
            <DropdownMenuLabel class="text-xs">Recent Projects</DropdownMenuLabel>
            <DropdownMenuItem
              v-for="project in recentProjects"
              :key="project.path"
              class="gap-2 text-xs py-1.5 px-2"
              @click="selectedProject = project.name"
            >
              <Icon icon="lucide:folder" class="w-3.5 h-3.5 text-muted-foreground" />
              <div class="flex flex-col min-w-0">
                <span class="truncate">{{ project.name }}</span>
                <span class="text-[10px] text-muted-foreground truncate">{{ project.path }}</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="gap-2 text-xs py-1.5 px-2" @click="selectCustomProject">
              <Icon icon="lucide:folder-open" class="w-3.5 h-3.5 text-muted-foreground" />
              <span>Open folder...</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

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
import { ref } from 'vue'
import { TooltipProvider } from '@shadcn/components/ui/tooltip'
import { Button } from '@shadcn/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { Icon } from '@iconify/vue'
import MockInputBox from './mock/MockInputBox.vue'
import MockInputToolbar from './mock/MockInputToolbar.vue'
import MockStatusBar from './mock/MockStatusBar.vue'

const recentProjects = [
  { name: 'deepchat', path: '~/Code/deepchat' },
  { name: 'api-server', path: '~/Code/api-server' },
  { name: 'infra', path: '~/Code/infra' },
  { name: 'personal-site', path: '~/Projects/personal-site' }
]

const selectedProject = ref('deepchat')

const selectCustomProject = () => {
  // Mock: would open a native folder picker
  selectedProject.value = 'Custom folder'
}
</script>
