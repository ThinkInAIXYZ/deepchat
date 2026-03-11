<template>
  <div
    class="border rounded-md px-3 py-3 bg-card hover:bg-accent/50 transition-colors group grid grid-cols-[minmax(0,1fr)_auto] gap-3"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
  >
    <div class="min-w-0 space-y-2">
      <div class="flex items-center gap-1.5 min-w-0">
        <Icon icon="lucide:wand-sparkles" class="w-4 h-4 text-primary shrink-0" />
        <span class="font-medium text-sm truncate">{{ skill.name }}</span>
      </div>

      <p class="text-xs text-muted-foreground line-clamp-2">
        {{ skill.description }}
      </p>

      <div class="flex flex-wrap gap-1.5">
        <Badge variant="secondary" class="text-[11px]">
          {{ t('settings.skills.card.scripts', { count: scripts.length }) }}
        </Badge>
        <Badge variant="outline" class="text-[11px]">
          {{ t('settings.skills.card.env', { count: envCount }) }}
        </Badge>
        <Badge variant="outline" class="text-[11px]">
          {{ runtimeSummary }}
        </Badge>
      </div>
    </div>

    <div
      class="flex items-start gap-0.5 transition-opacity"
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
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import type {
  SkillExtensionConfig,
  SkillMetadata,
  SkillRuntimePreference,
  SkillScriptDescriptor
} from '@shared/types/skill'

const props = defineProps<{
  skill: SkillMetadata
  extension?: SkillExtensionConfig
  scripts?: SkillScriptDescriptor[]
}>()

defineEmits<{
  edit: []
  delete: []
}>()

const { t } = useI18n()
const hovering = ref(false)

const envCount = computed(() => Object.keys(props.extension?.env ?? {}).length)
const scripts = computed(() => props.scripts ?? [])

const runtimeLabel = (value: SkillRuntimePreference | undefined) => {
  const normalized = value ?? 'auto'
  return t(`settings.skills.edit.runtime.${normalized}`)
}

const runtimeSummary = computed(
  () =>
    `${t('settings.skills.card.pythonShort')}:${runtimeLabel(props.extension?.runtimePolicy?.python)} / ${t('settings.skills.card.nodeShort')}:${runtimeLabel(props.extension?.runtimePolicy?.node)}`
)
</script>
