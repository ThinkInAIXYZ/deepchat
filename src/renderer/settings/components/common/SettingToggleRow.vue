<template>
  <div class="flex items-center gap-3 h-10">
    <span
      class="flex items-center gap-2 text-sm font-medium shrink-0 min-w-[220px]"
      :dir="langStore.dir"
    >
      <Icon :icon="icon" class="w-4 h-4 text-muted-foreground" />
      <span class="truncate">{{ label }}</span>
    </span>
    <div class="ml-auto">
      <Switch
        :id="id"
        :model-value="modelValue"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { toRefs } from 'vue'
import { Icon } from '@iconify/vue'
import { Switch } from '@shadcn/components/ui/switch'
import { useLanguageStore } from '@/stores/language'

const props = defineProps<{ id: string; icon: string; label: string; modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const langStore = useLanguageStore()

const { id, icon, label, modelValue } = toRefs(props)
</script>
