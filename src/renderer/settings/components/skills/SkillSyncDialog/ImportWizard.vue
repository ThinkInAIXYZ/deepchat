<template>
  <div class="flex flex-col h-full">
    <!-- Steps indicator -->
    <div class="flex items-center justify-center gap-2 mb-6">
      <div v-for="step in 3" :key="step" class="flex items-center">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors"
          :class="getStepClass(step)"
        >
          <Icon v-if="currentStep > step" icon="lucide:check" class="w-4 h-4" />
          <span v-else>{{ step }}</span>
        </div>
        <div
          v-if="step < 3"
          class="w-12 h-0.5 mx-2 transition-colors"
          :class="currentStep > step ? 'bg-primary' : 'bg-muted'"
        />
      </div>
    </div>

    <!-- Step content -->
    <div class="flex-1 overflow-auto">
      <!-- Step 1: Select tool -->
      <div v-if="currentStep === 1">
        <h3 class="text-sm font-medium mb-4">{{ t('settings.skills.sync.step1Title') }}</h3>
        <ToolSelector
          :tools="scanResults"
          :selected-tool-id="selectedToolId"
          :loading="scanning"
          @select="handleToolSelect"
        />
      </div>

      <!-- Step 2: Select skills -->
      <div v-else-if="currentStep === 2">
        <h3 class="text-sm font-medium mb-4">{{ t('settings.skills.sync.step2Title') }}</h3>
        <SkillSelector
          :skills="selectedTool?.skills || []"
          :selected-skills="selectedSkills"
          :conflicts="conflictNames"
          @update:selected-skills="selectedSkills = $event"
        />
      </div>

      <!-- Step 3: Resolve conflicts -->
      <div v-else-if="currentStep === 3">
        <h3 class="text-sm font-medium mb-4">{{ t('settings.skills.sync.step3Title') }}</h3>
        <div v-if="loading" class="flex flex-col items-center justify-center py-8">
          <Icon icon="lucide:loader-2" class="w-8 h-8 animate-spin text-muted-foreground mb-2" />
          <span class="text-sm text-muted-foreground">{{
            t('settings.skills.sync.previewing')
          }}</span>
        </div>
        <div v-else-if="importing" class="flex flex-col items-center justify-center py-8">
          <Icon icon="lucide:loader-2" class="w-8 h-8 animate-spin text-primary mb-2" />
          <span class="text-sm text-muted-foreground">
            {{
              t('settings.skills.sync.importing', {
                current: importProgress.current,
                total: importProgress.total
              })
            }}
          </span>
          <span class="text-xs text-muted-foreground mt-1">{{ importProgress.currentSkill }}</span>
        </div>
        <ConflictResolver
          v-else
          :conflicts="conflictItems"
          :strategies="conflictStrategies"
          :warnings="allWarnings"
          @update:strategies="conflictStrategies = $event"
        />
      </div>
    </div>

    <!-- Actions -->
    <div class="flex justify-between pt-4 border-t mt-4 flex-shrink-0">
      <Button variant="outline" @click="handleBack" :disabled="importing">
        {{ currentStep === 1 ? t('common.cancel') : t('common.back') }}
      </Button>
      <Button @click="handleNext" :disabled="!canProceed || importing">
        <Icon v-if="importing" icon="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
        {{ nextButtonText }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { usePresenter } from '@/composables/usePresenter'
import { useToast } from '@/components/use-toast'
import type { ScanResult, ImportPreview } from '@shared/types/skillSync'
import { ConflictStrategy } from '@shared/types/skillSync'
import ToolSelector from './ToolSelector.vue'
import SkillSelector from './SkillSelector.vue'
import ConflictResolver, { type ConflictItem } from './ConflictResolver.vue'

const props = defineProps<{
  currentStep: number
}>()

const emit = defineEmits<{
  'update:step': [value: number]
  complete: []
  cancel: []
}>()

const { t } = useI18n()
const { toast } = useToast()
const skillSyncPresenter = usePresenter('skillSyncPresenter')

// State
const scanning = ref(false)
const loading = ref(false)
const importing = ref(false)
const scanResults = ref<ScanResult[]>([])
const selectedToolId = ref<string | null>(null)
const selectedSkills = ref<string[]>([])
const importPreviews = ref<ImportPreview[]>([])
const conflictStrategies = ref<Record<string, ConflictStrategy>>({})
const importProgress = ref({ current: 0, total: 0, currentSkill: '' })

// Computed
const selectedTool = computed(() => {
  return scanResults.value.find((t) => t.toolId === selectedToolId.value)
})

const conflictNames = computed(() => {
  return importPreviews.value.filter((p) => p.conflict).map((p) => p.skill.name)
})

const conflictItems = computed((): ConflictItem[] => {
  return importPreviews.value
    .filter((p) => p.conflict)
    .map((p) => ({
      skillName: p.skill.name,
      existingName: p.conflict!.existingSkillName
    }))
})

const allWarnings = computed(() => {
  const warnings: string[] = []
  for (const preview of importPreviews.value) {
    if (preview.warnings.length > 0) {
      warnings.push(...preview.warnings.map((w) => `${preview.skill.name}: ${w}`))
    }
  }
  return warnings
})

const canProceed = computed(() => {
  if (props.currentStep === 1) {
    return selectedToolId.value !== null
  }
  if (props.currentStep === 2) {
    return selectedSkills.value.length > 0
  }
  return true
})

const nextButtonText = computed(() => {
  if (props.currentStep === 3) {
    return t('settings.skills.sync.importButton')
  }
  return t('common.next')
})

// Methods
const getStepClass = (step: number) => {
  if (props.currentStep > step) {
    return 'bg-primary text-primary-foreground'
  }
  if (props.currentStep === step) {
    return 'bg-primary text-primary-foreground'
  }
  return 'bg-muted text-muted-foreground'
}

const handleToolSelect = (tool: ScanResult) => {
  selectedToolId.value = tool.toolId
  // Auto-select all skills
  selectedSkills.value = tool.skills.map((s) => s.name)
}

const handleBack = () => {
  if (props.currentStep === 1) {
    emit('cancel')
  } else {
    emit('update:step', props.currentStep - 1)
  }
}

const handleNext = async () => {
  if (props.currentStep === 1) {
    emit('update:step', 2)
  } else if (props.currentStep === 2) {
    await previewImport()
    emit('update:step', 3)
  } else if (props.currentStep === 3) {
    await executeImport()
  }
}

const previewImport = async () => {
  if (!selectedToolId.value) return

  loading.value = true
  try {
    const previews = await skillSyncPresenter.previewImport(
      selectedToolId.value,
      selectedSkills.value
    )
    importPreviews.value = previews

    // Initialize conflict strategies
    const strategies: Record<string, ConflictStrategy> = {}
    for (const preview of previews) {
      if (preview.conflict) {
        strategies[preview.skill.name] = ConflictStrategy.SKIP
      }
    }
    conflictStrategies.value = strategies
  } catch (error) {
    console.error('Preview import error:', error)
    toast({
      title: t('settings.skills.sync.previewError'),
      description: String(error),
      variant: 'destructive'
    })
  } finally {
    loading.value = false
  }
}

const executeImport = async () => {
  importing.value = true
  importProgress.value = { current: 0, total: importPreviews.value.length, currentSkill: '' }

  try {
    const result = await skillSyncPresenter.executeImport(
      importPreviews.value,
      conflictStrategies.value
    )

    if (result.success) {
      toast({
        title: t('settings.skills.sync.importSuccess'),
        description: t('settings.skills.sync.importSuccessMessage', {
          count: result.imported,
          skipped: result.skipped
        })
      })
      emit('complete')
    } else {
      toast({
        title: t('settings.skills.sync.importPartial'),
        description: t('settings.skills.sync.importPartialMessage', {
          imported: result.imported,
          failed: result.failed.length
        }),
        variant: 'destructive'
      })
      emit('complete')
    }
  } catch (error) {
    console.error('Import error:', error)
    toast({
      title: t('settings.skills.sync.importError'),
      description: String(error),
      variant: 'destructive'
    })
  } finally {
    importing.value = false
  }
}

// Lifecycle
onMounted(async () => {
  await scanTools()
})

const scanTools = async () => {
  scanning.value = true
  try {
    scanResults.value = await skillSyncPresenter.scanExternalTools()
  } catch (error) {
    console.error('Scan error:', error)
    toast({
      title: t('settings.skills.sync.scanError'),
      description: String(error),
      variant: 'destructive'
    })
  } finally {
    scanning.value = false
  }
}

// Listen to import progress events
watch(
  () => props.currentStep,
  (step) => {
    if (step === 1) {
      // Reset state when going back to step 1
      selectedToolId.value = null
      selectedSkills.value = []
      importPreviews.value = []
      conflictStrategies.value = {}
    }
  }
)
</script>
