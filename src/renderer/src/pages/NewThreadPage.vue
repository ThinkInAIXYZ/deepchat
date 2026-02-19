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
              <span>{{ projectStore.selectedProjectName }}</span>
              <Icon icon="lucide:chevron-down" class="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" class="min-w-[200px]">
            <DropdownMenuLabel class="text-xs">Recent Projects</DropdownMenuLabel>
            <DropdownMenuItem
              v-for="project in projectStore.projects"
              :key="project.path"
              class="gap-2 text-xs py-1.5 px-2"
              @click="projectStore.selectProject(project.path)"
            >
              <Icon icon="lucide:folder" class="w-3.5 h-3.5 text-muted-foreground" />
              <div class="flex flex-col min-w-0">
                <span class="truncate">{{ project.name }}</span>
                <span class="text-[10px] text-muted-foreground truncate">{{ project.path }}</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              class="gap-2 text-xs py-1.5 px-2"
              @click="projectStore.openFolderPicker()"
            >
              <Icon icon="lucide:folder-open" class="w-3.5 h-3.5 text-muted-foreground" />
              <span>Open folder...</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Input area -->
        <ChatInputBox v-model="message" @submit="onSubmit">
          <template #toolbar>
            <ChatInputToolbar @send="onSubmit" />
          </template>
        </ChatInputBox>

        <!-- Status bar -->
        <ChatStatusBar />
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
import ChatInputBox from '@/components/chat/ChatInputBox.vue'
import ChatInputToolbar from '@/components/chat/ChatInputToolbar.vue'
import ChatStatusBar from '@/components/chat/ChatStatusBar.vue'
import { useProjectStore } from '@/stores/ui/project'
import { useSessionStore } from '@/stores/ui/session'
import { useAgentStore } from '@/stores/ui/agent'
import { useModelStore } from '@/stores/modelStore'
import { usePresenter } from '@/composables/usePresenter'

const projectStore = useProjectStore()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const modelStore = useModelStore()
const configPresenter = usePresenter('configPresenter')

const message = ref('')

async function resolveModel(): Promise<{ providerId: string; modelId: string } | null> {
  // 1. defaultModel from settings
  const defaultModel = (await configPresenter.getSetting('defaultModel')) as
    | { providerId: string; modelId: string }
    | undefined
  if (defaultModel?.providerId && defaultModel?.modelId) return defaultModel

  // 2. preferredModel (last user selection)
  const preferred = (await configPresenter.getSetting('preferredModel')) as
    | { providerId: string; modelId: string }
    | undefined
  if (preferred?.providerId && preferred?.modelId) return preferred

  // 3. First available enabled model
  for (const group of modelStore.enabledModels) {
    if (group.models.length > 0) {
      return { providerId: group.providerId, modelId: group.models[0].id }
    }
  }

  return null
}

async function onSubmit() {
  const text = message.value.trim()
  if (!text) return
  message.value = ''

  const agentId = agentStore.selectedAgentId ?? 'deepchat'
  const isAcp = agentId !== 'deepchat'

  let providerId: string | undefined
  let modelId: string | undefined

  if (isAcp) {
    providerId = 'acp'
    modelId = agentId
  } else {
    const resolved = await resolveModel()
    if (!resolved) {
      console.error('No model available. Please configure a provider and model in settings.')
      return
    }
    providerId = resolved.providerId
    modelId = resolved.modelId
  }

  await sessionStore.createSession({
    message: text,
    projectDir: projectStore.selectedProject?.path,
    agentId,
    providerId,
    modelId
  })
}
</script>
