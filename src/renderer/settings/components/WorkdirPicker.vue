<template>
  <Dialog :open="open" @update:open="(next) => emit('update:open', next)">
    <DialogContent class="sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>{{ t('settings.agents.workdirPicker.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.agents.workdirPicker.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <div class="space-y-2">
          <div class="text-sm font-medium text-foreground">
            {{ t('settings.agents.workdirPicker.recent') }}
          </div>

          <div
            v-if="recentWorkdirs.length === 0"
            class="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground"
          >
            {{ t('settings.agents.workdirPicker.emptyRecent') }}
          </div>

          <div v-else class="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
            <button
              v-for="dir in recentWorkdirs"
              :key="dir"
              type="button"
              :class="[
                'flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                dir === localSelectedPath
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/60'
              ]"
              @click="localSelectedPath = dir"
            >
              <Icon icon="lucide:folder" class="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <span class="truncate" :title="dir">{{ dir }}</span>
            </button>
          </div>
        </div>

        <div class="rounded-md border p-3">
          <div class="text-xs text-muted-foreground">
            {{ t('settings.agents.workdirPicker.selected') }}
          </div>
          <div class="mt-1 break-all text-sm">
            {{ localSelectedPath || t('settings.agents.workdirPicker.notSelected') }}
          </div>
        </div>

        <div class="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" :disabled="browsing" @click="handleBrowse">
            <Icon icon="lucide:folder-open" class="mr-2 h-4 w-4" />
            {{ t('settings.agents.workdirPicker.browse') }}
          </Button>
          <Button
            type="button"
            variant="ghost"
            :disabled="!localSelectedPath"
            @click="localSelectedPath = ''"
          >
            {{ t('settings.agents.workdirPicker.clear') }}
          </Button>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" @click="emit('update:open', false)">
          {{ t('common.cancel') }}
        </Button>
        <Button type="button" :disabled="!localSelectedPath" @click="handleSelect">
          {{ t('settings.agents.workdirPicker.select') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { usePresenter } from '@/composables/usePresenter'
import { Button } from '@shadcn/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'

const props = defineProps<{
  open: boolean
  selectedPath: string
  recentWorkdirs: string[]
}>()

const { open, recentWorkdirs } = toRefs(props)

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'select', path: string): void
}>()

const { t } = useI18n()
const devicePresenter = usePresenter('devicePresenter')
const browsing = ref(false)
const localSelectedPath = ref(props.selectedPath)

watch(
  () => props.selectedPath,
  (next) => {
    localSelectedPath.value = next
  }
)

watch(
  () => props.open,
  (next) => {
    if (next) {
      localSelectedPath.value = props.selectedPath
    }
  }
)

const handleBrowse = async () => {
  browsing.value = true
  try {
    const result = await devicePresenter.selectDirectory()
    if (!result?.canceled && Array.isArray(result?.filePaths) && result.filePaths.length > 0) {
      localSelectedPath.value = result.filePaths[0]
    }
  } finally {
    browsing.value = false
  }
}

const handleSelect = () => {
  const next = localSelectedPath.value.trim()
  if (!next) return
  emit('select', next)
  emit('update:open', false)
}
</script>
