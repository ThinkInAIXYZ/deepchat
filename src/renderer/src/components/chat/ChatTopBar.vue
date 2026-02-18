<template>
  <div
    class="sticky top-0 z-10 flex items-center justify-between h-12 px-4 bg-background/60 backdrop-blur-lg window-drag-region"
  >
    <div class="flex items-center gap-2 min-w-0">
      <div v-if="project" class="flex items-center gap-1.5 text-muted-foreground">
        <Icon icon="lucide:folder" class="w-3.5 h-3.5 shrink-0" />
        <span class="text-xs truncate">{{ projectName }}</span>
        <Icon icon="lucide:chevron-right" class="w-3 h-3 shrink-0" />
      </div>
      <h2 class="text-sm font-medium truncate">{{ title }}</h2>
    </div>

    <div class="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <Icon icon="lucide:share" class="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Share</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <Icon icon="lucide:ellipsis" class="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@shadcn/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import { Icon } from '@iconify/vue'

const props = defineProps<{
  title: string
  project: string
}>()

const projectName = computed(() => props.project.split('/').pop() ?? props.project)
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

button {
  -webkit-app-region: no-drag;
}
</style>
