<template>
  <div
    class="flex h-full w-full flex-col items-center justify-center bg-background text-muted-foreground"
  >
    <Icon icon="lucide:globe" class="mb-4 h-16 w-16 opacity-30" />
    <p class="text-lg font-medium">{{ t('common.browser.enterUrlToStart') }}</p>
    <p class="mt-2 text-sm opacity-60">{{ t('common.browser.enterUrlDescription') }}</p>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>
