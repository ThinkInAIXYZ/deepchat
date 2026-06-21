<template>
  <Dialog :open="open" @update:open="(value) => emit('update:open', value)">
    <DialogContent class="sm:max-w-[680px]">
      <DialogHeader class="text-left">
        <DialogTitle>{{ t('settings.deepchatAgents.memoryManager.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.deepchatAgents.memoryManager.description') }}
        </DialogDescription>
      </DialogHeader>

      <MemoryManagerPanel
        v-if="open"
        :agent-id="agentId"
        :memory-enabled="memoryEnabled"
        :has-embedding-configured="hasEmbeddingConfigured"
        :persona-evolution-enabled="personaEvolutionEnabled"
      />
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import MemoryManagerPanel from './MemoryManagerPanel.vue'

defineProps<{
  open: boolean
  agentId: string
  memoryEnabled?: boolean
  hasEmbeddingConfigured?: boolean
  personaEvolutionEnabled?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
</script>
