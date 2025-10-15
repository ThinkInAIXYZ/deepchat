<template>
  <div class="flex flex-row items-center justify-between">
    <span class="font-medium">{{ t('promptSetting.title') }}</span>
    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" @click="emit('export')">
        <Icon icon="lucide:download" class="w-4 h-4 mr-1" />
        {{ t('promptSetting.export') }}
      </Button>
      <Button variant="outline" size="sm" @click="emit('import')">
        <Icon icon="lucide:upload" class="w-4 h-4 mr-1" />
        {{ t('promptSetting.import') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'

const emit = defineEmits<{
  (e: 'import'): void
  (e: 'export'): void
}>()

const { t } = useI18n()
</script>
