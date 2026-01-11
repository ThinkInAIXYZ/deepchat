<template>
  <div class="divide-y">
    <!-- Header -->
    <div class="p-2 flex items-center justify-between">
      <span class="text-sm font-medium">{{ t('chat.skills.panel.title') }}</span>
      <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" @click="$emit('manage')">
        {{ t('chat.skills.panel.manage') }}
      </Button>
    </div>

    <!-- Skills List -->
    <div v-if="skills.length > 0" class="p-2 space-y-0.5">
      <TooltipProvider>
        <Tooltip v-for="skill in skills" :key="skill.name">
          <TooltipTrigger as-child>
            <label
              class="flex items-center gap-2 p-1.5 rounded hover:bg-muted transition-colors cursor-pointer"
            >
              <Checkbox
                :checked="isActive(skill.name)"
                @update:checked="$emit('toggle', skill.name)"
              />
              <Icon icon="lucide:wand-2" class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span class="text-sm truncate">{{ skill.name }}</span>
            </label>
          </TooltipTrigger>
          <TooltipContent v-if="skill.description || skill.allowedTools?.length" side="right">
            <div class="max-w-xs space-y-1">
              <p v-if="skill.description" class="text-xs">{{ skill.description }}</p>
              <p v-if="skill.allowedTools?.length" class="text-xs text-muted-foreground">
                Tools: {{ skill.allowedTools.join(', ') }}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>

    <!-- Empty State -->
    <div v-else class="p-4 text-center text-sm text-muted-foreground">
      {{ t('chat.skills.panel.empty') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import type { SkillMetadata } from '@shared/types/skill'

const props = defineProps<{
  skills: SkillMetadata[]
  activeSkills: string[]
}>()

defineEmits<{
  toggle: [skillName: string]
  manage: []
}>()

const { t } = useI18n()

// Check if a skill is active
const isActive = (skillName: string) => props.activeSkills.includes(skillName)
</script>
