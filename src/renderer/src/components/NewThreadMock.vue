<template>
  <TooltipProvider :delay-duration="200">
    <div class="h-full w-full flex flex-col">
      <!-- Main content area (centered) -->
      <div class="flex-1 flex flex-col items-center justify-center px-4">
        <!-- Logo -->
        <div class="mb-4">
          <img src="@/assets/logo-dark.png" class="w-14 h-14" loading="lazy" />
        </div>

        <!-- Heading -->
        <h1 class="text-3xl font-semibold text-foreground mb-8">Build and explore</h1>

        <!-- Input area -->
        <div
          class="w-full max-w-2xl rounded-xl border border-input bg-background shadow-sm overflow-hidden"
        >
          <Textarea
            placeholder="Ask DeepChat anything, @ to mention files, / for commands"
            class="min-h-[80px] resize-none border-0 shadow-none focus-visible:ring-0 focus-visible:border-0 bg-transparent placeholder:text-muted-foreground px-4 pt-4 pb-2 text-sm"
            :model-value="''"
          />

          <!-- Toolbar -->
          <div class="flex items-center justify-between px-3 py-2">
            <div class="flex items-center gap-1">
              <!-- Attach button -->
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    <Icon icon="lucide:plus" class="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Attach</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div class="flex items-center gap-1">
              <!-- Mic button -->
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    <Icon icon="lucide:mic" class="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Voice input</p>
                </TooltipContent>
              </Tooltip>

              <!-- Send button -->
              <Button size="icon" class="h-7 w-7 rounded-full">
                <Icon icon="lucide:arrow-up" class="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
        <!-- Status bar -->
        <div class="w-full max-w-2xl flex items-center justify-between px-1 py-2">
          <div class="flex items-center gap-1">
            <!-- Model selector -->
            <Popover>
              <PopoverTrigger as-child>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Icon icon="lucide:sparkles" class="w-3.5 h-3.5" />
                  <span>Claude 4 Sonnet</span>
                  <Icon icon="lucide:chevron-down" class="w-3 h-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" class="w-64 p-3">
                <div class="space-y-1">
                  <p class="text-xs font-medium text-muted-foreground mb-2">Models</p>
                  <div
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 bg-accent text-accent-foreground"
                  >
                    <Icon icon="lucide:sparkles" class="w-4 h-4" />
                    <span class="text-sm">Claude 4 Sonnet</span>
                  </div>
                  <div
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground cursor-pointer"
                  >
                    <Icon icon="lucide:zap" class="w-4 h-4" />
                    <span class="text-sm">GPT-4o</span>
                  </div>
                  <div
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground cursor-pointer"
                  >
                    <Icon icon="lucide:flame" class="w-4 h-4" />
                    <span class="text-sm">Gemini 2.5 Pro</span>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <!-- Effort selector -->
            <Popover>
              <PopoverTrigger as-child>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Icon icon="lucide:gauge" class="w-3.5 h-3.5" />
                  <span>High</span>
                  <Icon icon="lucide:chevron-down" class="w-3 h-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" class="w-48 p-3">
                <div class="space-y-1">
                  <p class="text-xs font-medium text-muted-foreground mb-2">Reasoning Effort</p>
                  <div
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground cursor-pointer"
                  >
                    <span class="text-sm">Low</span>
                  </div>
                  <div
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground cursor-pointer"
                  >
                    <span class="text-sm">Medium</span>
                  </div>
                  <div
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 bg-accent text-accent-foreground"
                  >
                    <span class="text-sm">High</span>
                  </div>
                  <div
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent hover:text-accent-foreground cursor-pointer"
                  >
                    <span class="text-sm">Extra High</span>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <!-- Permissions -->
          <Button
            variant="ghost"
            size="sm"
            class="h-6 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Icon icon="lucide:shield" class="w-3.5 h-3.5" />
            <span>Default permissions</span>
            <Icon icon="lucide:chevron-down" class="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { Button } from '@shadcn/components/ui/button'
import { Textarea } from '@shadcn/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { Icon } from '@iconify/vue'
</script>
