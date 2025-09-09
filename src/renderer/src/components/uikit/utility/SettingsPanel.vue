<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import type { BaseComponentProps } from '../types'

interface SettingsSection {
  id: string
  title: string
  description?: string
  icon?: string
}

interface Props extends BaseComponentProps {
  sections?: SettingsSection[]
  activeSection?: string
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  sections: () => []
})

const emit = defineEmits<{
  sectionChange: [sectionId: string]
}>()

const containerClasses = computed(() => cn('flex gap-6 h-full', props.class))

const sidebarClasses = computed(() => cn('w-64 shrink-0', 'border-r border-border'))

const contentClasses = computed(() => cn('flex-1 min-w-0'))

const getSectionClasses = (section: SettingsSection) =>
  cn(
    'flex items-center gap-3 w-full p-3 rounded-md text-left',
    'hover:bg-accent hover:text-accent-foreground',
    'transition-colors duration-200',
    {
      'bg-accent text-accent-foreground': props.activeSection === section.id
    }
  )

const handleSectionClick = (sectionId: string) => {
  emit('sectionChange', sectionId)
}
</script>

<template>
  <div :class="containerClasses">
    <!-- Sidebar Navigation -->
    <div v-if="sections.length > 0" :class="sidebarClasses">
      <div class="p-4">
        <h2 class="text-lg font-semibold text-foreground mb-4">Settings</h2>

        <nav class="space-y-1">
          <button
            v-for="section in sections"
            :key="section.id"
            :class="getSectionClasses(section)"
            @click="handleSectionClick(section.id)"
          >
            <span v-if="section.icon" class="text-lg">{{ section.icon }}</span>

            <div class="flex flex-col items-start text-left min-w-0">
              <span class="font-medium text-sm">{{ section.title }}</span>
              <span v-if="section.description" class="text-xs text-muted-foreground line-clamp-1">
                {{ section.description }}
              </span>
            </div>
          </button>
        </nav>
      </div>
    </div>

    <!-- Main Content -->
    <div :class="contentClasses">
      <div class="p-6">
        <slot name="header" :activeSection="activeSection" :sections="sections" />

        <Separator v-if="$slots.header" class="my-6" />

        <!-- Settings Content -->
        <div class="space-y-6">
          <slot :activeSection="activeSection" :sections="sections" />
        </div>
      </div>
    </div>
  </div>
</template>
