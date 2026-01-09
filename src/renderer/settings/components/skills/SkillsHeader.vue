<template>
  <div class="shrink-0 px-4 pt-4">
    <div class="flex items-center justify-between">
      <div :dir="languageStore.dir" class="flex-1">
        <div class="font-medium">
          {{ t('settings.skills.title') }}
        </div>
        <p class="text-xs text-muted-foreground">
          {{ t('settings.skills.description') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <div class="relative">
          <Icon
            icon="lucide:search"
            class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
          />
          <Input
            :model-value="searchQuery"
            @update:model-value="$emit('update:searchQuery', String($event))"
            :placeholder="t('settings.skills.search')"
            class="pl-8 h-8 w-48"
          />
        </div>
        <Button size="sm" @click="$emit('install')">
          <Icon icon="lucide:plus" class="w-4 h-4 mr-1" />
          {{ t('settings.skills.addSkill') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { useLanguageStore } from '@/stores/language'

defineProps<{
  searchQuery: string
}>()

defineEmits<{
  'update:searchQuery': [value: string]
  install: []
}>()

const { t } = useI18n()
const languageStore = useLanguageStore()
</script>
