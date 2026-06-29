<template>
  <div
    class="border rounded-md px-3 py-3 bg-card hover:bg-accent/50 transition-colors grid grid-cols-[minmax(0,1fr)_auto] gap-3 cursor-pointer"
    role="button"
    tabindex="0"
    @click="$emit('view')"
    @keydown.enter.prevent="$emit('view')"
    @keydown.space.prevent="$emit('view')"
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
          {{ t('settings.skills.card.scripts', { count: scriptsList.length }) }}
        </Badge>
        <Badge variant="outline" class="text-[11px]">
          {{ t('settings.skills.card.env', { count: envCount }) }}
        </Badge>
        <Badge variant="outline" class="text-[11px]">
          {{ runtimeSummary }}
        </Badge>
        <Badge :variant="skill.deepchatDisabled ? 'secondary' : 'outline'" class="text-[11px]">
          {{
            skill.deepchatDisabled
              ? t('settings.skills.card.disabled')
              : t('settings.skills.card.enabled')
          }}
        </Badge>
      </div>
    </div>

    <div class="flex items-start gap-2" @click.stop @keydown.stop>
      <Button
        variant="outline"
        size="sm"
        class="h-8 px-3 text-xs whitespace-nowrap"
        :title="t('settings.skills.card.installToAgent')"
        :aria-label="t('settings.skills.card.installToAgent')"
        @click="$emit('install-to-agent')"
      >
        {{ t('settings.skills.card.installToAgent') }}
      </Button>
      <Switch
        class="mt-1"
        :model-value="!skill.deepchatDisabled"
        :aria-label="
          skill.deepchatDisabled
            ? t('settings.skills.card.enable')
            : t('settings.skills.card.disable')
        "
        @update:model-value="handleEnabledChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Badge } from '@shadcn/components/ui/badge'
import { Switch } from '@shadcn/components/ui/switch'
import type {
  SkillExtensionConfig,
  SkillRuntimePreference,
  SkillScriptDescriptor
} from '@shared/types/skill'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'

const props = defineProps<{
  skill: UnifiedSkillItem
  extension?: SkillExtensionConfig
  scripts?: SkillScriptDescriptor[]
}>()

const emit = defineEmits<{
  'toggle-disabled': [disabled: boolean]
  view: []
  'install-to-agent': []
}>()

const { t } = useI18n()

const envCount = computed(() => Object.keys(props.extension?.env ?? {}).length)
const scriptsList = computed(() => props.scripts ?? [])

const handleEnabledChange = (value: boolean | string) => {
  const enabled = typeof value === 'string' ? value === 'true' : Boolean(value)
  emit('toggle-disabled', !enabled)
}

const runtimeLabel = (value: SkillRuntimePreference | undefined) => {
  const normalized = value ?? 'auto'
  return t(`settings.skills.edit.runtime.${normalized}`)
}

const runtimeSummary = computed(
  () =>
    `${t('settings.skills.card.pythonShort')}:${runtimeLabel(props.extension?.runtimePolicy?.python)} / ${t('settings.skills.card.nodeShort')}:${runtimeLabel(props.extension?.runtimePolicy?.node)}`
)
</script>
