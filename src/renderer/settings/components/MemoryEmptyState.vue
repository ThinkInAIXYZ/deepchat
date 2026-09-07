<template>
  <DcEmpty
    :icon="enabled ? 'lucide:notebook-tabs' : 'lucide:power'"
    :title="
      enabled
        ? t('settings.memory.redesign.emptyTitle')
        : t('settings.memory.redesign.disabledTitle')
    "
    :description="
      enabled
        ? t('settings.memory.redesign.emptyDescription')
        : t('settings.memory.redesign.disabledDescription')
    "
  >
    <template #action>
      <DcButton size="sm" @click="handleClick">
        <Icon :icon="enabled ? 'lucide:plus' : 'lucide:power'" data-icon="inline-start" />
        {{
          enabled
            ? t('settings.memory.redesign.addMemory')
            : t('settings.memory.redesign.enableMemory')
        }}
      </DcButton>
    </template>
  </DcEmpty>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { DcEmpty } from '@dc-ui/components/empty'

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
