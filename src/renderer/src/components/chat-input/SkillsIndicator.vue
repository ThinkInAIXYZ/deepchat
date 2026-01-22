<template>
  <TooltipProvider>
    <Popover v-model:open="panelOpen">
      <PopoverTrigger>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button id="skills-btn" variant="ghost" :class="['h-7 text-xs w-7']" size="icon">
              <Icon v-if="loading" icon="lucide:loader" class="w-4 h-4 animate-spin" />
              <Icon v-else icon="lucide:wand-sparkles" class="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p v-if="activeCount > 0">
              {{ t('chat.skills.indicator.active', { count: activeCount }) }}
            </p>
            <p v-else>{{ t('chat.skills.indicator.none') }}</p>
          </TooltipContent>
        </Tooltip>
      </PopoverTrigger>

      <PopoverContent class="w-72 p-0" align="start">
        <SkillsPanel
          :skills="skills"
          :active-skills="activeSkills"
          @toggle="handleToggle"
          @manage="openSettings"
        />
      </PopoverContent>
    </Popover>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { Button } from '@shadcn/components/ui/button'
import { useWindowAdapter } from '@/composables/window/useWindowAdapter'
import { useSkillsData } from './composables/useSkillsData'
import SkillsPanel from './SkillsPanel.vue'

const props = defineProps<{
  conversationId: string | null
}>()

const { t } = useI18n()
const windowAdapter = useWindowAdapter()

// Panel open state
const panelOpen = ref(false)

// Use skills data composable
const { skills, activeSkills, activeCount, loading, toggleSkill, pendingSkills } = useSkillsData(
  computed(() => props.conversationId)
)

// Handle skill toggle
const handleToggle = async (skillName: string) => {
  await toggleSkill(skillName)
}

// Open settings page at Skills section
const openSettings = () => {
  windowAdapter.openSettingsWindow()
  panelOpen.value = false
}

// Expose pending skills for parent component to consume when creating thread
defineExpose({
  pendingSkills
})
</script>
