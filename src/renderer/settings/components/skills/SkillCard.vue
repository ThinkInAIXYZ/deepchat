<template>
  <div
    class="border rounded-lg p-4 bg-card hover:bg-accent/50 transition-colors group"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
  >
    <div class="flex items-start justify-between">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <Icon icon="lucide:wand-sparkles" class="w-4 h-4 text-primary shrink-0" />
          <span class="font-medium truncate">{{ skill.name }}</span>
        </div>
        <p class="text-sm text-muted-foreground mt-1 line-clamp-2">
          {{ skill.description }}
        </p>
        <div
          v-if="skill.allowedTools && skill.allowedTools.length > 0"
          class="flex items-center gap-1 mt-2 flex-wrap"
        >
          <span
            v-for="tool in skill.allowedTools.slice(0, 3)"
            :key="tool"
            class="text-xs px-1.5 py-0.5 bg-muted rounded"
          >
            {{ tool }}
          </span>
          <span v-if="skill.allowedTools.length > 3" class="text-xs text-muted-foreground">
            +{{ skill.allowedTools.length - 3 }}
          </span>
        </div>
      </div>
      <div
        class="flex items-center gap-1 ml-2 shrink-0 transition-opacity"
        :class="{ 'opacity-0 group-hover:opacity-100': !hovering }"
      >
        <Button variant="ghost" size="sm" class="h-8 w-8 p-0" @click="$emit('edit')">
          <Icon icon="lucide:edit" class="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-8 w-8 p-0 text-destructive"
          @click="$emit('delete')"
        >
          <Icon icon="lucide:trash-2" class="w-4 h-4" />
        </Button>
      </div>
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
