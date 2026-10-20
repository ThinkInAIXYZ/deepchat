<script setup lang="ts">
import type { UnifiedSkillItem } from '@shared/types/skillManagement'

withDefaults(
  defineProps<{
    skill: UnifiedSkillItem
    disabled?: boolean
  }>(),
  {
    disabled: false
  }
)

const emit = defineEmits<{
  view: []
}>()
</script>

<template>
  <button
    :data-testid="`plugin-skill-${skill.name}`"
    type="button"
    :disabled="disabled"
    class="flex min-h-24 w-full min-w-0 flex-col justify-center gap-2 overflow-hidden rounded-lg border border-transparent bg-background px-4 py-4 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
    @click="emit('view')"
  >
    <span class="block w-full truncate text-sm font-medium">
      {{ skill.name }}
    </span>
    <span class="line-clamp-2 w-full text-sm leading-5 text-muted-foreground">
      {{ skill.description }}
    </span>
  </button>
</template>
