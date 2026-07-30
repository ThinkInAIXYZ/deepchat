<template>
  <div class="flex h-full min-h-0 w-full flex-col">
    <div class="mx-auto w-full max-w-7xl shrink-0 px-4 pt-4 lg:px-6">
      <Button variant="ghost" size="sm" @click="router.push({ name: 'plugins' })">
        <Icon icon="lucide:arrow-left" class="mr-2 size-4" />
        {{ t('common.back') }}
      </Button>
    </div>
    <div class="min-h-0 flex-1">
      <OcrSettings />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import OcrSettings from '../../../settings/components/OcrSettings.vue'

const { t } = useI18n()
const router = useRouter()
</script>
