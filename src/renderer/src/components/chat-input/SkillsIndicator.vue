<template>
  <Popover v-model:open="panelOpen">
    <PopoverTrigger>
      <DcButton
        id="skills-btn"
        variant="outline"
        size="icon-sm"
        icon="lucide:sparkles"
        icon-size="4"
        :loading="loading"
        :tooltip="
          composerActiveCount > 0
            ? t('chat.skills.indicator.active', { count: composerActiveCount })
            : t('chat.skills.indicator.none')
        "
        :class="[
          'flex items-center gap-1.5 w-auto rounded-lg shadow-sm px-1.5 text-xs text-accent-foreground hover:text-accent-foreground',
          composerActiveCount > 0 ? 'text-primary border-primary/50' : ''
        ]"
      >
        <span v-if="composerActiveCount > 0" class="text-sm">{{ composerActiveCount }}</span>
      </DcButton>
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
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { DcButton } from '@dc-ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { useSkillsData } from './composables/useSkillsData'
import SkillsPanel from './SkillsPanel.vue'

const props = defineProps<{
  conversationId: string | null
  agentId?: string | null
}>()

const { t } = useI18n()
const router = useRouter()

// Panel open state
const panelOpen = ref(false)

// Use skills data composable
const { skills, composerActiveSkills, composerActiveCount, loading, toggleSkill, pendingSkills } =
  useSkillsData(
    computed(() => props.conversationId),
    computed(() => props.agentId?.trim() || 'deepchat')
  )

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
