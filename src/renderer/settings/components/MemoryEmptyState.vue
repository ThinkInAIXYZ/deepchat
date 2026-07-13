<template>
  <div class="rounded-lg border border-dashed border-border px-6 py-12 text-center">
    <Icon
      :icon="enabled ? 'lucide:notebook-tabs' : 'lucide:power'"
      class="mx-auto mb-3 h-9 w-9 text-muted-foreground"
    />
    <h3 class="text-sm font-semibold">
      {{
        enabled
          ? t('settings.memory.redesign.emptyTitle')
          : t('settings.memory.redesign.disabledTitle')
      }}
    </h3>
    <p class="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
      {{
        enabled
          ? t('settings.memory.redesign.emptyDescription')
          : t('settings.memory.redesign.disabledDescription')
      }}
    </p>
    <Button class="mt-4" size="sm" @click="handleClick">
      <Icon :icon="enabled ? 'lucide:plus' : 'lucide:power'" class="mr-1.5 h-3.5 w-3.5" />
      {{
        enabled
          ? t('settings.memory.redesign.addMemory')
          : t('settings.memory.redesign.enableMemory')
      }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'

const props = defineProps<{ enabled: boolean }>()
const emit = defineEmits<{
  add: []
  enable: []
}>()

const { t } = useI18n()

function handleClick(): void {
  if (props.enabled) emit('add')
  else emit('enable')
}
</script>
