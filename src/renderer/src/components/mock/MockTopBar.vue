<template>
  <div
    class="sticky top-0 z-10 flex items-center justify-between h-12 px-4 bg-background/60 backdrop-blur-lg window-drag-region"
  >
    <div class="flex items-center gap-2 min-w-0">
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
import { Button } from '@shadcn/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import { Icon } from '@iconify/vue'

defineProps<{
  title: string
}>()
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

button {
  -webkit-app-region: no-drag;
}
</style>
