<template>
  <div class="space-y-4">
    <!-- Select all / Deselect all -->
    <div class="flex items-center justify-between">
      <div class="text-sm text-muted-foreground">
        {{
          t('settings.skills.sync.selectedCount', {
            count: selectedSkills.length,
            total: skills.length
          })
        }}
      </div>
      <Button variant="ghost" size="sm" @click="toggleAll">
        {{
          allSelected ? t('settings.skills.sync.deselectAll') : t('settings.skills.sync.selectAll')
        }}
      </Button>
    </div>

    <!-- Skills list -->
    <ScrollArea class="h-[300px] pr-4">
      <div class="space-y-2">
        <div
          v-for="skill in skills"
          :key="skill.name"
          class="flex items-start gap-3 p-3 border rounded-lg hover:bg-accent/50 transition-colors"
        >
          <Checkbox
            :checked="skillCheckedState[skill.name]"
            @update:checked="(value) => updateSkillChecked(skill.name, Boolean(value))"
            class="mt-0.5"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium truncate">{{ skill.name }}</span>
              <Badge v-if="hasConflict(skill.name)" variant="destructive" class="text-xs">
                {{ t('settings.skills.sync.conflict') }}
              </Badge>
            </div>
            <p v-if="skill.description" class="text-xs text-muted-foreground line-clamp-2 mt-1">
              {{ skill.description }}
            </p>
            <div class="text-xs text-muted-foreground/70 mt-1">
              {{ formatDate(skill.lastModified) }}
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import type { ExternalSkillInfo } from '@shared/types/skillSync'

const props = defineProps<{
  skills: ExternalSkillInfo[]
  selectedSkills: string[]
  conflicts: string[]
}>()

const emit = defineEmits<{
  'update:selectedSkills': [value: string[]]
}>()

const { t, d } = useI18n()

// Local state for checkbox bindings
const skillCheckedState = ref<Record<string, boolean>>({})

// Initialize from props
watch(
  () => props.selectedSkills,
  (selected) => {
    const newState: Record<string, boolean> = {}
    for (const skill of props.skills) {
      newState[skill.name] = selected.includes(skill.name)
    }
    skillCheckedState.value = newState
  },
  { immediate: true }
)

// Also reinitialize when skills change
watch(
  () => props.skills,
  (skills) => {
    const newState: Record<string, boolean> = {}
    for (const skill of skills) {
      newState[skill.name] = props.selectedSkills.includes(skill.name)
    }
    skillCheckedState.value = newState
  },
  { immediate: true }
)

const updateSkillChecked = (skillName: string, checked: boolean) => {
  skillCheckedState.value[skillName] = checked
  // Directly emit updated selections
  const newSelected = checked
    ? [...props.selectedSkills.filter((n) => n !== skillName), skillName]
    : props.selectedSkills.filter((n) => n !== skillName)
  emit('update:selectedSkills', newSelected)
}

const allSelected = computed(() => {
  return props.skills.length > 0 && props.selectedSkills.length === props.skills.length
})

const toggleAll = () => {
  const newState: Record<string, boolean> = {}
  const selectAll = !allSelected.value
  for (const skill of props.skills) {
    newState[skill.name] = selectAll
  }
  skillCheckedState.value = newState
}

const hasConflict = (name: string): boolean => {
  return props.conflicts.includes(name)
}

const formatDate = (date: Date): string => {
  return d(new Date(date), 'short')
}
</script>
