<template>
  <!-- Only render when commands are available -->
  <div v-if="commands.length > 0" class="flex flex-col gap-2">
    <!-- Header -->
    <div class="flex items-center justify-between px-2">
      <div class="flex items-center gap-2">
        <Icon icon="lucide:terminal" class="w-4 h-4 text-muted-foreground" />
        <span class="text-xs font-semibold text-foreground">
          {{ t('chat.input.commands.title') }}
        </span>
        <Badge variant="secondary" class="h-5 px-1.5 text-[10px]">
          {{ commands.length }}
        </Badge>
      </div>
      <Button
        variant="ghost"
        size="sm"
        class="h-6 w-6 p-0 rounded"
        @click="isExpanded = !isExpanded"
      >
        <Icon :icon="isExpanded ? 'lucide:chevron-up' : 'lucide:chevron-down'" class="w-4 h-4" />
      </Button>
    </div>

    <!-- Commands List (collapsible) -->
    <div v-if="isExpanded" class="flex flex-col gap-1">
      <div
        v-for="command in visibleCommands"
        :key="command.name"
        :class="[
          'flex items-start gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors',
          'hover:bg-muted/60'
        ]"
        :title="command.description || command.name"
        @click="handleCommandClick(command)"
      >
        <Icon icon="lucide:code" class="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        <div class="flex flex-col min-w-0 flex-1">
          <span class="text-xs font-medium text-foreground">
            {{ command.name }}
          </span>
          <span v-if="command.description" class="text-[10px] text-muted-foreground truncate">
            {{ command.description }}
          </span>
          <span v-if="command.inputHint" class="text-[10px] text-muted-foreground/70">
            {{ t('chat.input.commands.inputHint') }}: {{ command.inputHint }}
          </span>
        </div>
      </div>

      <!-- Show More/Less indicator -->
      <div v-if="commands.length > maxVisible" class="flex items-center justify-center px-2 py-1">
        <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" @click="showAll = !showAll">
          <Icon
            :icon="showAll ? 'lucide:chevron-up' : 'lucide:chevron-down'"
            class="w-3 h-3 mr-1"
          />
          {{
            showAll
              ? t('chat.input.commands.showLess')
              : t('chat.input.commands.showMore', { count: commands.length - maxVisible })
          }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import { useAgenticSession } from '@/composables/agentic/useAgenticSession'

export interface CommandInfo {
  name: string
  description?: string
  inputHint?: string
}

interface Props {
  sessionId: string
  maxVisible?: number
}

const props = withDefaults(defineProps<Props>(), {
  maxVisible: 5
})

const emit = defineEmits<{
  'command-insert': [template: string]
}>()

const { t } = useI18n()

// Use agentic session composable for data
const { availableCommands } = useAgenticSession(props.sessionId)

// Local state
const isExpanded = ref(true)
const showAll = ref(false)

const commands = computed(() => availableCommands.value)

const visibleCommands = computed(() => {
  if (showAll.value || commands.value.length <= props.maxVisible) {
    return commands.value
  }
  return commands.value.slice(0, props.maxVisible)
})

const handleCommandClick = (command: CommandInfo) => {
  // Generate command invocation template
  let template = `/${command.name}`

  if (command.inputHint) {
    // Add placeholder for input
    template += ` ${command.inputHint}`
  }

  emit('command-insert', template)
}
</script>
