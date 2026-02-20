<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 px-2 gap-1 text-xs rounded-md text-muted-foreground hover:text-foreground max-w-[280px]"
        :class="isModified ? 'text-primary' : ''"
        :disabled="loading"
      >
        <Icon icon="lucide:folder" class="w-3.5 h-3.5" />
        <span class="truncate">{{ displayPath }}</span>
        <Icon icon="lucide:chevron-down" class="w-3 h-3" />
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent align="start" class="w-80">
      <DropdownMenuLabel class="text-xs">{{ t('chat.input.workdir') }}</DropdownMenuLabel>
      <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">
        {{ t('chat.input.workdirRecent') }}
      </DropdownMenuLabel>

      <DropdownMenuItem
        v-for="dir in recentWorkdirs"
        :key="dir"
        :class="['gap-2 text-xs py-1.5 px-2', { 'bg-accent': dir === workdir }]"
        @click="emit('select', dir)"
      >
        <Icon icon="lucide:folder" class="w-3.5 h-3.5 text-muted-foreground" />
        <span class="truncate">{{ formatPath(dir) }}</span>
        <Icon v-if="dir === workdir" icon="lucide:check" class="w-3 h-3 ml-auto" />
      </DropdownMenuItem>

      <div v-if="recentWorkdirs.length === 0" class="px-2 py-2 text-xs text-muted-foreground">
        {{ t('chat.input.workdirNoRecent') }}
      </div>

      <DropdownMenuSeparator />

      <DropdownMenuItem class="gap-2 text-xs py-1.5 px-2" @click="emit('browse')">
        <Icon icon="lucide:folder-open" class="w-3.5 h-3.5 text-muted-foreground" />
        <span>{{ t('chat.input.workdirBrowse') }}</span>
      </DropdownMenuItem>

      <DropdownMenuItem
        v-if="isModified"
        class="gap-2 text-xs py-1.5 px-2 text-destructive"
        @click="emit('reset')"
      >
        <Icon icon="lucide:rotate-ccw" class="w-3.5 h-3.5" />
        <span>{{ t('chat.input.workdirReset') }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'

const props = withDefaults(
  defineProps<{
    workdir: string
    sessionDefault: string
    recentWorkdirs: string[]
    loading?: boolean
  }>(),
  {
    loading: false
  }
)

const emit = defineEmits<{
  select: [path: string]
  browse: []
  reset: []
}>()

const { t } = useI18n()

const normalizePath = (path: string) => (path || '').trim()

const isModified = computed(() => {
  return normalizePath(props.workdir) !== normalizePath(props.sessionDefault)
})

const displayPath = computed(() => {
  if (!props.workdir) return t('chat.input.workdirNoDirectory')
  return formatPath(props.workdir)
})

function formatPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  const parts = normalized.split('/')
  if (parts.length > 4) {
    return '.../' + parts.slice(-3).join('/')
  }
  return path
}
</script>
