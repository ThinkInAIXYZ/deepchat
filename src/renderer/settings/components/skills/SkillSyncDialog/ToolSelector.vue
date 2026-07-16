<template>
  <div class="space-y-4">
    <div v-if="loading" class="flex items-center justify-center gap-2 py-8">
      <Spinner class="size-6 text-muted-foreground" />
      <span class="text-muted-foreground">{{ t('settings.skills.sync.scanning') }}</span>
    </div>

    <Empty v-else-if="tools.length === 0" class="border-0 py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon icon="lucide:inbox" />
        </EmptyMedia>
        <EmptyDescription>{{ t('settings.skills.sync.noToolsFound') }}</EmptyDescription>
      </EmptyHeader>
    </Empty>

    <div v-else class="space-y-2">
      <div
        v-for="tool in tools"
        :key="tool.toolId"
        class="flex items-center justify-between p-3 border rounded-lg hover:bg-accent transition-colors"
        :class="{ 'border-primary bg-accent': selectedToolId === tool.toolId }"
        @click="handleSelect(tool)"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-lg flex items-center justify-center"
            :class="getToolIconBg(tool.toolId)"
          >
            <Icon :icon="getToolIcon(tool.toolId)" class="w-5 h-5" />
          </div>
          <div>
            <div class="font-medium">{{ tool.toolName }}</div>
            <div class="text-xs text-muted-foreground truncate max-w-[300px]">
              {{ tool.skillsDir }}
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Badge v-if="tool.available" variant="secondary">
            {{ t('settings.skills.sync.skillCount', { count: tool.skills.length }) }}
          </Badge>
          <Badge v-else variant="outline" class="text-muted-foreground">
            {{ t('settings.skills.sync.notInstalled') }}
          </Badge>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge } from '@shadcn/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@shadcn/components/ui/empty'
import { Spinner } from '@shadcn/components/ui/spinner'
import type { ScanResult } from '@shared/types/skillSync'
import { getSkillToolIcon as getToolIcon, getSkillToolIconBg as getToolIconBg } from '../toolIcon'

defineProps<{
  tools: ScanResult[]
  selectedToolId: string | null
  loading: boolean
}>()

const emit = defineEmits<{
  select: [tool: ScanResult]
}>()

const { t } = useI18n()

const handleSelect = (tool: ScanResult) => {
  if (tool.available && tool.skills.length > 0) {
    emit('select', tool)
  }
}
</script>
