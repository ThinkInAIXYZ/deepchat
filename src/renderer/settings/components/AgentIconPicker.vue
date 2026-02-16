<template>
  <Dialog :open="open" @update:open="(next) => emit('update:open', next)">
    <DialogContent class="sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>{{ t('settings.agents.iconPicker.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.agents.iconPicker.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-3 py-2">
        <Input
          v-model="search"
          :placeholder="t('settings.agents.iconPicker.searchPlaceholder')"
          class="h-9"
        />

        <div class="grid max-h-64 grid-cols-5 gap-2 overflow-y-auto rounded-md border p-2">
          <button
            v-for="iconName in filteredIcons"
            :key="iconName"
            type="button"
            :class="[
              'flex h-10 w-full items-center justify-center rounded-md border transition-colors',
              iconName === selectedIcon
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-accent'
            ]"
            @click="emit('select', iconName)"
          >
            <Icon :icon="iconName" class="h-4 w-4" />
          </button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Input } from '@shadcn/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'

const ICONS = [
  'lucide:bot',
  'lucide:brain',
  'lucide:cpu',
  'lucide:sparkles',
  'lucide:wand-sparkles',
  'lucide:terminal',
  'lucide:command',
  'lucide:code',
  'lucide:code-xml',
  'lucide:blocks',
  'lucide:file-code-2',
  'lucide:folder-code',
  'lucide:shield',
  'lucide:rocket',
  'lucide:compass',
  'lucide:lightbulb',
  'lucide:flask-conical',
  'lucide:wrench',
  'lucide:hammer',
  'lucide:package',
  'lucide:messages-square',
  'lucide:message-circle',
  'lucide:user-round-cog',
  'lucide:star',
  'lucide:gem',
  'lucide:atom',
  'lucide:database',
  'lucide:cloud',
  'lucide:server',
  'lucide:hard-drive'
]

const props = defineProps<{
  open: boolean
  selectedIcon: string
}>()

const { open, selectedIcon } = toRefs(props)

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'select', icon: string): void
}>()

const { t } = useI18n()
const search = ref('')

const filteredIcons = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return ICONS
  return ICONS.filter((iconName) => iconName.toLowerCase().includes(keyword))
})
</script>
