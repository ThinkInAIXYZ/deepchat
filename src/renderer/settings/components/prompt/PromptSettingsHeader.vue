<template>
  <div class="flex flex-row items-center justify-between">
    <span class="font-medium">{{ t('promptSetting.title') }}</span>
    <div class="flex items-center gap-2">
      <DcButton variant="outline" size="sm" @click="emit('export')">
        <Icon icon="lucide:download" class="w-4 h-4 mr-1" />
        {{ t('promptSetting.export') }}
      </DcButton>
      <DcButton variant="outline" size="sm" @click="emit('import')">
        <Icon icon="lucide:upload" class="w-4 h-4 mr-1" />
        {{ t('promptSetting.import') }}
      </DcButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'

const emit = defineEmits<{
  (e: 'import'): void
  (e: 'export'): void
}>()

const { t } = useI18n()
</script>
