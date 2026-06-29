<template>
  <TooltipProvider>
    <Popover v-model:open="panelOpen">
      <PopoverTrigger>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              id="skills-btn"
              variant="outline"
              :class="[
                'flex text-accent-foreground rounded-lg shadow-sm items-center gap-1.5 h-7 text-xs px-1.5 w-auto',
                composerActiveCount > 0 ? 'text-primary border-primary/50' : ''
              ]"
              size="icon"
            >
              <Icon v-if="loading" icon="lucide:loader" class="w-4 h-4 animate-spin" />
              <Icon v-else icon="lucide:sparkles" class="w-4 h-4" />
              <span v-if="composerActiveCount > 0" class="text-sm">{{ composerActiveCount }}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p v-if="composerActiveCount > 0">
              {{ t('chat.skills.indicator.active', { count: composerActiveCount }) }}
            </p>
            <p v-else>{{ t('chat.skills.indicator.none') }}</p>
          </TooltipContent>
        </Tooltip>
      </PopoverTrigger>

      <PopoverContent class="w-72 p-0" align="start">
        <SkillsPanel
          :skills="skills"
          :active-skills="composerActiveSkills"
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
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@shadcn/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { Button } from '@shadcn/components/ui/button'
import { useSkillsData } from './composables/useSkillsData'
import SkillsPanel from './SkillsPanel.vue'

const props = defineProps<{
  conversationId: string | null
}>()

const { t } = useI18n()
const router = useRouter()

// Panel open state
const panelOpen = ref(false)

// Use skills data composable
const { skills, composerActiveSkills, composerActiveCount, loading, toggleSkill, pendingSkills } =
  useSkillsData(computed(() => props.conversationId))

// Handle skill toggle
const handleToggle = async (skillName: string) => {
  await toggleSkill(skillName)
}

// Open settings page at Skills section
const openSettings = () => {
  void router.push({ name: 'plugins-skills' })
  panelOpen.value = false
}

// Expose pending skills for parent component to consume when creating thread
defineExpose({
  pendingSkills
})
</script>
