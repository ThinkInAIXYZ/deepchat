<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-2xl max-h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>
          {{
            mode === 'import'
              ? t('settings.skills.sync.importTitle')
              : t('settings.skills.sync.exportTitle')
          }}
        </DialogTitle>
        <DialogDescription>
          {{
            mode === 'import'
              ? t('settings.skills.sync.importDescription')
              : t('settings.skills.sync.exportDescription')
          }}
        </DialogDescription>
      </DialogHeader>

      <!-- Content area -->
      <div class="h-96 overflow-auto">
        <ImportWizard
          v-if="mode === 'import'"
          :current-step="currentStep"
          @update:step="currentStep = $event"
          @complete="handleComplete"
          @cancel="handleCancel"
        />
        <ExportWizard
          v-else
          :current-step="currentStep"
          @update:step="currentStep = $event"
          @complete="handleComplete"
          @cancel="handleCancel"
        />
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import ImportWizard from './ImportWizard.vue'
import ExportWizard from './ExportWizard.vue'

const props = defineProps<{
  open: boolean
  mode: 'import' | 'export'
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  completed: []
}>()

const { t } = useI18n()

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value)
})

const currentStep = ref(1)

// Reset step when dialog opens
watch(isOpen, (open) => {
  if (open) {
    currentStep.value = 1
  }
})

const handleComplete = () => {
  emit('completed')
  isOpen.value = false
}

const handleCancel = () => {
  isOpen.value = false
}
</script>
