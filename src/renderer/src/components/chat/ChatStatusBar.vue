<template>
  <div class="w-full max-w-2xl flex items-center justify-between px-1 py-2">
    <div class="flex items-center gap-1">
      <!-- Model selector -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
          >
            <ModelIcon
              model-id="anthropic"
              custom-class="w-3.5 h-3.5"
              :is-dark="themeStore.isDark"
            />
            <span>Claude 4 Sonnet</span>
            <Icon icon="lucide:chevron-down" class="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="min-w-0">
          <DropdownMenuItem class="gap-2 text-xs py-1.5 px-2">
            <ModelIcon
              model-id="anthropic"
              custom-class="w-3.5 h-3.5"
              :is-dark="themeStore.isDark"
            />
            <span>Claude 4 Sonnet</span>
          </DropdownMenuItem>
          <DropdownMenuItem class="gap-2 text-xs py-1.5 px-2">
            <ModelIcon model-id="openai" custom-class="w-3.5 h-3.5" :is-dark="themeStore.isDark" />
            <span>GPT-4o</span>
          </DropdownMenuItem>
          <DropdownMenuItem class="gap-2 text-xs py-1.5 px-2">
            <ModelIcon model-id="google" custom-class="w-3.5 h-3.5" :is-dark="themeStore.isDark" />
            <span>Gemini 2.5 Pro</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- Effort selector -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
          >
            <Icon icon="lucide:gauge" class="w-3.5 h-3.5" />
            <span>High</span>
            <Icon icon="lucide:chevron-down" class="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="min-w-0">
          <DropdownMenuItem class="text-xs py-1.5 px-2">Low</DropdownMenuItem>
          <DropdownMenuItem class="text-xs py-1.5 px-2">Medium</DropdownMenuItem>
          <DropdownMenuItem class="text-xs py-1.5 px-2">High</DropdownMenuItem>
          <DropdownMenuItem class="text-xs py-1.5 px-2">Extra High</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- Permissions -->
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="sm"
          class="h-6 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground backdrop-blur-lg"
        >
          <Icon icon="lucide:shield" class="w-3.5 h-3.5" />
          <span>Default permissions</span>
          <Icon icon="lucide:chevron-down" class="w-3 h-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="min-w-0">
        <DropdownMenuItem class="text-xs py-1.5 px-2">Default permissions</DropdownMenuItem>
        <DropdownMenuItem class="text-xs py-1.5 px-2">Restricted</DropdownMenuItem>
        <DropdownMenuItem class="text-xs py-1.5 px-2">Full access</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@shadcn/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { Icon } from '@iconify/vue'
import ModelIcon from '../icons/ModelIcon.vue'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
</script>
