<template>
  <div
    class="border rounded-md px-3 py-2 bg-card hover:bg-accent/50 transition-colors group grid grid-cols-[auto_1fr_auto] items-center gap-3"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
  >
    <!-- Name -->
    <div class="flex items-center gap-1.5 max-w-[180px]">
      <Icon icon="lucide:wand-sparkles" class="w-4 h-4 text-primary shrink-0" />
      <span class="font-medium text-sm truncate">{{ skill.name }}</span>
    </div>

    <!-- Description -->
    <p class="text-xs text-muted-foreground truncate">
      {{ skill.description }}
    </p>

    <!-- Actions -->
    <div
      class="flex items-center gap-0.5 transition-opacity"
      :class="{ 'opacity-0 group-hover:opacity-100': !hovering }"
    >
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="$emit('edit')">
        <Icon icon="lucide:edit" class="w-3.5 h-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 w-7 p-0 text-destructive"
        @click="$emit('delete')"
      >
        <Icon icon="lucide:trash-2" class="w-3.5 h-3.5" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import type { SkillMetadata } from '@shared/types/skill'

defineProps<{
  skill: SkillMetadata
}>()

defineEmits<{
  edit: []
  delete: []
}>()

const hovering = ref(false)
</script>
