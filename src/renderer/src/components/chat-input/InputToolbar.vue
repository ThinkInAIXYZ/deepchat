<template>
  <div class="flex gap-1.5 text-muted-foreground">
    <!-- File Select Button -->
    <Tooltip>
      <TooltipTrigger>
        <Button variant="ghost" size="icon-sm" :class="['w-7 h-7']" @click="$emit('file-select')">
          <Icon icon="lucide:plus" class="w-4 h-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ t('chat.input.fileSelect') }}</TooltipContent>
    </Tooltip>

    <!-- MCP Tools List -->
    <McpToolsList />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@shadcn/components/ui/tooltip'
import McpToolsList from '../McpToolsList.vue'

defineProps<{
  conversationId: string | null
}>()

defineEmits<{
  'file-select': []
}>()

const { t } = useI18n()
</script>
