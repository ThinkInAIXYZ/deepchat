<template>
  <div
    class="flex flex-col items-center justify-center h-full w-full bg-background text-muted-foreground"
  >
    <Icon icon="lucide:globe" class="w-16 h-16 mb-4 opacity-30" />
    <p class="text-lg font-medium">{{ t('common.browser.enterUrlToStart') }}</p>
    <p class="text-sm mt-2 opacity-60">{{ t('common.browser.enterUrlDescription') }}</p>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>
