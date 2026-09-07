<template>
  <Popover v-model:open="panelOpen">
    <PopoverTrigger as-child>
      <DcButton
        data-testid="session-skills-indicator"
        variant="ghost"
        size="sm"
        icon="lucide:sparkles"
        icon-size="3.5"
        :loading="loading"
        :tooltip="t('chat.skills.indicator.active', { count: activeSkills.length })"
        class="h-6 gap-1 px-2 text-xs text-primary hover:text-primary"
      >
        <span>{{ t('chat.skills.indicator.active', { count: activeSkills.length }) }}</span>
      </DcButton>
    </PopoverTrigger>

    <PopoverContent class="w-72 p-0" align="start">
      <div class="border-b px-3 py-2 text-sm font-medium">
        {{ t('chat.skills.panel.title') }}
      </div>
      <div class="max-h-64 space-y-0.5 overflow-y-auto p-2">
        <div
          v-for="skillName in activeSkills"
          :key="skillName"
          class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
        >
          <span class="min-w-0 flex-1 truncate">{{ skillName }}</span>
          <DcButton
            type="button"
            variant="ghost"
            size="icon-sm"
            icon="lucide:x"
            icon-size="3.5"
            :loading="removingSkill === skillName"
            :disabled="disabled || loading || Boolean(removingSkill)"
            :label="`${t('chat.pendingInput.remove')}: ${skillName}`"
            :tooltip="t('chat.pendingInput.remove')"
            :data-skill-name="skillName"
            class="size-6 shrink-0 text-muted-foreground hover:text-destructive"
            @click="emit('remove', skillName)"
          />
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'

const props = defineProps<{
  activeSkills: string[]
  loading?: boolean
  removingSkill?: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  remove: [skillName: string]
}>()

const { t } = useI18n()
const panelOpen = ref(false)
</script>
