<template>
  <div class="space-y-4">
    <!-- Summary -->
    <div class="flex items-center justify-center gap-4 py-6">
      <div v-if="result.success" class="flex flex-col items-center">
        <div
          class="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-2"
        >
          <Icon icon="lucide:check" class="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <span class="text-lg font-medium text-green-600 dark:text-green-400">
          {{ t('settings.skills.sync.resultSuccess') }}
        </span>
      </div>
      <div v-else class="flex flex-col items-center">
        <div
          class="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-2"
        >
          <Icon icon="lucide:alert-triangle" class="w-8 h-8 text-amber-600 dark:text-amber-400" />
        </div>
        <span class="text-lg font-medium text-amber-600 dark:text-amber-400">
          {{ t('settings.skills.sync.resultPartial') }}
        </span>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-3 gap-4">
      <div class="text-center p-4 bg-muted/50 rounded-lg">
        <div class="text-2xl font-bold text-green-600 dark:text-green-400">
          {{ mode === 'import' ? result.imported : result.exported }}
        </div>
        <div class="text-xs text-muted-foreground">
          {{
            mode === 'import'
              ? t('settings.skills.sync.imported')
              : t('settings.skills.sync.exported')
          }}
        </div>
      </div>
      <div class="text-center p-4 bg-muted/50 rounded-lg">
        <div class="text-2xl font-bold text-muted-foreground">
          {{ result.skipped }}
        </div>
        <div class="text-xs text-muted-foreground">
          {{ t('settings.skills.sync.skipped') }}
        </div>
      </div>
      <div class="text-center p-4 bg-muted/50 rounded-lg">
        <div
          class="text-2xl font-bold"
          :class="
            result.failed.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
          "
        >
          {{ result.failed.length }}
        </div>
        <div class="text-xs text-muted-foreground">
          {{ t('settings.skills.sync.failed') }}
        </div>
      </div>
    </div>

    <!-- Failed items -->
    <div v-if="result.failed.length > 0" class="space-y-2">
      <div class="text-sm font-medium text-red-600 dark:text-red-400">
        {{ t('settings.skills.sync.failedItems') }}
      </div>
      <ScrollArea class="h-[150px]">
        <div class="space-y-2">
          <div
            v-for="(item, index) in result.failed"
            :key="index"
            class="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-sm"
          >
            <Icon icon="lucide:x-circle" class="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div>
              <span class="font-medium">{{ item.skill }}</span>
              <span class="text-red-600 dark:text-red-400">: {{ item.reason }}</span>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import type { SyncResult } from '@shared/types/skillSync'

defineProps<{
  result: SyncResult
  mode: 'import' | 'export'
}>()

const { t } = useI18n()
</script>
