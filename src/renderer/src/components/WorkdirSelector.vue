<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 px-2.5 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <Icon icon="lucide:folder" class="w-3.5 h-3.5" />
        <span>{{ displayPath }}</span>
        <Icon icon="lucide:chevron-down" class="w-3 h-3" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="center" class="min-w-[250px]">
      <!-- Recent directories -->
      <DropdownMenuLabel class="text-xs">{{ t('newThread.recentDirectories') }}</DropdownMenuLabel>
      <DropdownMenuItem
        v-for="dir in recentWorkdirs"
        :key="dir"
        :class="['gap-2 text-xs py-1.5 px-2', { 'bg-accent': dir === workdir }]"
        @click="selectWorkdir(dir)"
      >
        <Icon icon="lucide:folder" class="w-3.5 h-3.5 text-muted-foreground" />
        <span class="truncate">{{ formatPath(dir) }}</span>
        <Icon v-if="dir === workdir" icon="lucide:check" class="w-3 h-3 ml-auto" />
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <!-- Browse -->
      <DropdownMenuItem class="gap-2 text-xs py-1.5 px-2" @click="browseDirectory">
        <Icon icon="lucide:folder-open" class="w-3.5 h-3.5 text-muted-foreground" />
        <span>{{ t('newThread.browseDirectory') }}</span>
      </DropdownMenuItem>

      <!-- Clear selection -->
      <DropdownMenuItem
        v-if="workdir"
        class="gap-2 text-xs py-1.5 px-2 text-destructive"
        @click="clearWorkdir"
      >
        <Icon icon="lucide:x" class="w-3.5 h-3.5" />
        <span>{{ t('newThread.clearDirectory') }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { Icon } from '@iconify/vue'

const props = defineProps<{
  workdir: string
  recentWorkdirs: string[]
}>()

const emit = defineEmits<{
  'update:workdir': [value: string]
  browse: []
}>()

const { t } = useI18n()

const displayPath = computed(() => {
  if (!props.workdir) return t('newThread.selectDirectory')
  return formatPath(props.workdir)
})

function formatPath(path: string): string {
  const parts = path.split('/')
  if (parts.length > 4) {
    return '.../' + parts.slice(-3).join('/')
  }
  return path
}

function selectWorkdir(path: string) {
  emit('update:workdir', path)
}

function browseDirectory() {
  emit('browse')
}

function clearWorkdir() {
  emit('update:workdir', '')
}
</script>
