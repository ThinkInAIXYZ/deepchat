<template>
  <Empty class="border border-dashed">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Icon :icon="enabled ? 'lucide:notebook-tabs' : 'lucide:power'" />
      </EmptyMedia>
      <EmptyTitle>
        {{
          enabled
            ? t('settings.memory.redesign.emptyTitle')
            : t('settings.memory.redesign.disabledTitle')
        }}
      </EmptyTitle>
      <EmptyDescription>
        {{
          enabled
            ? t('settings.memory.redesign.emptyDescription')
            : t('settings.memory.redesign.disabledDescription')
        }}
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button size="sm" @click="handleClick">
        <Icon :icon="enabled ? 'lucide:plus' : 'lucide:power'" data-icon="inline-start" />
        {{
          enabled
            ? t('settings.memory.redesign.addMemory')
            : t('settings.memory.redesign.enableMemory')
        }}
      </Button>
    </EmptyContent>
  </Empty>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@shadcn/components/ui/empty'

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
