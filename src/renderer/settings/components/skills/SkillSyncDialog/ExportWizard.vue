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
      <!-- Step 1: Select skills to export -->
      <div v-if="currentStep === 1">
        <h3 class="text-sm font-medium mb-4">{{ t('settings.skills.sync.exportStep1Title') }}</h3>
        <div v-if="loadingSkills" class="flex items-center justify-center py-8">
          <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
        <div v-else>
          <!-- Select all / Deselect all -->
          <div class="flex items-center justify-between mb-4">
            <div class="text-sm text-muted-foreground">
              {{
                t('settings.skills.sync.selectedCount', {
                  count: selectedSkills.length,
                  total: localSkills.length
                })
              }}
            </div>
            <Button variant="ghost" size="sm" @click="toggleAllSkills">
              {{
                allSkillsSelected
                  ? t('settings.skills.sync.deselectAll')
                  : t('settings.skills.sync.selectAll')
              }}
            </Button>
          </div>

          <ScrollArea class="h-[280px] pr-4">
            <div class="space-y-2">
              <div
                v-for="skill in localSkills"
                :key="skill.name"
                class="flex items-start gap-3 p-3 border rounded-lg hover:bg-accent/50 transition-colors"
              >
                <Checkbox
                  :checked="skillCheckedState[skill.name]"
                  @update:checked="(value) => updateSkillChecked(skill.name, Boolean(value))"
                  class="mt-0.5"
                />
                <div class="flex-1 min-w-0">
                  <span class="font-medium truncate">{{ skill.name }}</span>
                  <p
                    v-if="skill.description"
                    class="text-xs text-muted-foreground line-clamp-2 mt-1"
                  >
                    {{ skill.description }}
                  </p>
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>

      <!-- Step 2: Select target tool -->
      <div v-else-if="currentStep === 2">
        <h3 class="text-sm font-medium mb-4">{{ t('settings.skills.sync.exportStep2Title') }}</h3>
        <div v-if="scanningTools" class="flex items-center justify-center py-8">
          <Icon icon="lucide:loader-2" class="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
        <div v-else class="space-y-4">
          <div class="space-y-2">
            <div
              v-for="tool in availableTools"
              :key="tool.id"
              class="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-accent transition-colors"
              :class="{ 'border-primary bg-accent': selectedToolId === tool.id }"
              @click="selectedToolId = tool.id"
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-10 h-10 rounded-lg flex items-center justify-center"
                  :class="getToolIconBg(tool.id)"
                >
                  <Icon :icon="getToolIcon(tool.id)" class="w-5 h-5" />
                </div>
                <div>
                  <div class="font-medium">{{ tool.name }}</div>
                  <div class="text-xs text-muted-foreground truncate max-w-[300px]">
                    {{ tool.skillsDir }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Kiro-specific options -->
          <div
            v-if="isKiroSelected"
            class="p-4 border rounded-lg bg-pink-50/50 dark:bg-pink-900/10 space-y-4"
          >
            <div
              class="flex items-center gap-2 text-sm font-medium text-pink-600 dark:text-pink-400"
            >
              <Icon icon="lucide:sparkles" class="w-4 h-4" />
              {{ t('settings.skills.sync.kiroOptions') }}
            </div>

            <!-- Inclusion mode -->
            <div class="space-y-2">
              <Label class="text-sm">{{ t('settings.skills.sync.kiroInclusion') }}</Label>
              <RadioGroup v-model="kiroInclusion" class="space-y-2">
                <div class="flex items-start gap-2">
                  <RadioGroupItem value="on-demand" id="kiro-on-demand" class="mt-0.5" />
                  <div>
                    <Label for="kiro-on-demand" class="text-sm font-normal cursor-pointer">
                      {{ t('settings.skills.sync.kiroOnDemand') }}
                    </Label>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.skills.sync.kiroOnDemandDesc') }}
                    </p>
                  </div>
                </div>
                <div class="flex items-start gap-2">
                  <RadioGroupItem value="always" id="kiro-always" class="mt-0.5" />
                  <div>
                    <Label for="kiro-always" class="text-sm font-normal cursor-pointer">
                      {{ t('settings.skills.sync.kiroAlways') }}
                    </Label>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.skills.sync.kiroAlwaysDesc') }}
                    </p>
                  </div>
                </div>
                <div class="flex items-start gap-2">
                  <RadioGroupItem value="conditional" id="kiro-conditional" class="mt-0.5" />
                  <div class="flex-1">
                    <Label for="kiro-conditional" class="text-sm font-normal cursor-pointer">
                      {{ t('settings.skills.sync.kiroConditional') }}
                    </Label>
                    <p class="text-xs text-muted-foreground">
                      {{ t('settings.skills.sync.kiroConditionalDesc') }}
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            <!-- File patterns (shown only for conditional) -->
            <div v-if="kiroInclusion === 'conditional'" class="space-y-2">
              <Label for="kiro-patterns" class="text-sm">
                {{ t('settings.skills.sync.kiroFilePatterns') }}
              </Label>
              <Input
                id="kiro-patterns"
                v-model="kiroFilePatterns"
                :placeholder="t('settings.skills.sync.kiroFilePatternsPlaceholder')"
                class="text-sm"
              />
              <p class="text-xs text-muted-foreground">
                {{ t('settings.skills.sync.kiroFilePatternsHint') }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 3: Preview and confirm -->
      <div v-else-if="currentStep === 3">
        <h3 class="text-sm font-medium mb-4">{{ t('settings.skills.sync.exportStep3Title') }}</h3>
        <div v-if="loading" class="flex flex-col items-center justify-center py-8">
          <Icon icon="lucide:loader-2" class="w-8 h-8 animate-spin text-muted-foreground mb-2" />
          <span class="text-sm text-muted-foreground">{{
            t('settings.skills.sync.previewing')
          }}</span>
        </div>
        <div v-else-if="exporting" class="flex flex-col items-center justify-center py-8">
          <Icon icon="lucide:loader-2" class="w-8 h-8 animate-spin text-primary mb-2" />
          <span class="text-sm text-muted-foreground">
            {{
              t('settings.skills.sync.exporting', {
                current: exportProgress.current,
                total: exportProgress.total
              })
            }}
          </span>
          <span class="text-xs text-muted-foreground mt-1">{{ exportProgress.currentSkill }}</span>
        </div>
        <div v-else>
          <!-- Warnings -->
          <div
            v-if="allWarnings.length > 0"
            class="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg"
          >
            <div
              class="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-medium text-sm mb-2"
            >
              <Icon icon="lucide:alert-triangle" class="w-4 h-4" />
              {{ t('settings.skills.sync.exportWarnings') }}
            </div>
            <div class="space-y-1">
              <div
                v-for="(warning, index) in allWarnings"
                :key="index"
                class="text-xs text-amber-700 dark:text-amber-300"
              >
                {{ warning }}
              </div>
            </div>
          </div>

          <!-- Conflicts -->
          <ConflictResolver
            v-if="conflictItems.length > 0"
            :conflicts="conflictItems"
            :strategies="conflictStrategies"
            :warnings="[]"
            @update:strategies="conflictStrategies = $event"
          />

          <!-- No conflicts message -->
          <div v-else class="text-center py-8 text-muted-foreground">
            <Icon icon="lucide:check-circle" class="w-12 h-12 mx-auto mb-2 text-green-500" />
            <p>{{ t('settings.skills.sync.noConflicts') }}</p>
            <p class="text-xs mt-1">
              {{ t('settings.skills.sync.readyToExport', { count: selectedSkills.length }) }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex justify-between pt-4 border-t mt-4 flex-shrink-0">
      <Button variant="outline" @click="handleBack" :disabled="exporting">
        {{ currentStep === 1 ? t('common.cancel') : t('common.back') }}
      </Button>
      <Button @click="handleNext" :disabled="!canProceed || exporting">
        <Icon v-if="exporting" icon="lucide:loader-2" class="w-4 h-4 mr-2 animate-spin" />
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
import { Checkbox } from '@shadcn/components/ui/checkbox'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Label } from '@shadcn/components/ui/label'
import { Input } from '@shadcn/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import { usePresenter } from '@/composables/usePresenter'
import { useToast } from '@/components/use-toast'
import { useSkillsStore } from '@/stores/skillsStore'
import { storeToRefs } from 'pinia'
import type { ExternalToolConfig, ExportPreview, KiroInclusionMode } from '@shared/types/skillSync'
import { ConflictStrategy } from '@shared/types/skillSync'
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
const skillsStore = useSkillsStore()
const { skills: localSkills, loading: loadingSkills } = storeToRefs(skillsStore)

// State
const scanningTools = ref(false)
const loading = ref(false)
const exporting = ref(false)
const selectedSkills = ref<string[]>([])
const skillCheckedState = ref<Record<string, boolean>>({})
const availableTools = ref<ExternalToolConfig[]>([])
const selectedToolId = ref<string | null>(null)
const exportPreviews = ref<ExportPreview[]>([])
const conflictStrategies = ref<Record<string, ConflictStrategy>>({})
const exportProgress = ref({ current: 0, total: 0, currentSkill: '' })

// Kiro-specific options
const kiroInclusion = ref<KiroInclusionMode>('on-demand')
const kiroFilePatterns = ref<string>('')

// Computed
const allSkillsSelected = computed(() => {
  return localSkills.value.length > 0 && selectedSkills.value.length === localSkills.value.length
})

const isKiroSelected = computed(() => {
  return selectedToolId.value === 'kiro'
})

const conflictItems = computed((): ConflictItem[] => {
  return exportPreviews.value
    .filter((p) => p.conflict)
    .map((p) => ({
      skillName: p.skillName,
      existingName: p.conflict!.existingPath
    }))
})

const allWarnings = computed(() => {
  const warnings: string[] = []
  for (const preview of exportPreviews.value) {
    if (preview.warnings.length > 0) {
      warnings.push(...preview.warnings.map((w) => `${preview.skillName}: ${w}`))
    }
  }
  return warnings
})

const canProceed = computed(() => {
  if (props.currentStep === 1) {
    return selectedSkills.value.length > 0
  }
  if (props.currentStep === 2) {
    return selectedToolId.value !== null
  }
  return true
})

const nextButtonText = computed(() => {
  if (props.currentStep === 3) {
    return t('settings.skills.sync.exportButton')
  }
  return t('common.next')
})

// Build export options based on selected tool
const exportOptions = computed(() => {
  if (selectedToolId.value === 'kiro') {
    const options: Record<string, unknown> = {
      inclusion: kiroInclusion.value
    }
    if (kiroInclusion.value === 'conditional' && kiroFilePatterns.value.trim()) {
      options.filePatterns = kiroFilePatterns.value
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
    }
    return options
  }
  return undefined
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

const getToolIcon = (toolId: string): string => {
  const icons: Record<string, string> = {
    'claude-code': 'simple-icons:anthropic',
    cursor: 'simple-icons:cursor',
    windsurf: 'lucide:wind',
    copilot: 'simple-icons:github',
    kiro: 'lucide:sparkles',
    antigravity: 'lucide:rocket'
  }
  return icons[toolId] || 'lucide:box'
}

const getToolIconBg = (toolId: string): string => {
  const bgs: Record<string, string> = {
    'claude-code': 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
    cursor: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    windsurf: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400',
    copilot: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    kiro: 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400',
    antigravity: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
  }
  return bgs[toolId] || 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400'
}

const updateSkillChecked = (skillName: string, checked: boolean) => {
  skillCheckedState.value[skillName] = checked
  // Directly update selectedSkills for immediate reactivity
  if (checked) {
    if (!selectedSkills.value.includes(skillName)) {
      selectedSkills.value = [...selectedSkills.value, skillName]
    }
  } else {
    selectedSkills.value = selectedSkills.value.filter((name) => name !== skillName)
  }
}

const toggleAllSkills = () => {
  if (allSkillsSelected.value) {
    selectedSkills.value = []
    for (const skill of localSkills.value) {
      skillCheckedState.value[skill.name] = false
    }
  } else {
    selectedSkills.value = localSkills.value.map((s) => s.name)
    for (const skill of localSkills.value) {
      skillCheckedState.value[skill.name] = true
    }
  }
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
    await loadTools()
    emit('update:step', 2)
  } else if (props.currentStep === 2) {
    await previewExport()
    emit('update:step', 3)
  } else if (props.currentStep === 3) {
    await executeExport()
  }
}

const loadTools = async () => {
  scanningTools.value = true
  try {
    availableTools.value = await skillSyncPresenter.getRegisteredTools()
  } catch (error) {
    console.error('Load tools error:', error)
    toast({
      title: t('settings.skills.sync.loadToolsError'),
      description: String(error),
      variant: 'destructive'
    })
  } finally {
    scanningTools.value = false
  }
}

const previewExport = async () => {
  if (!selectedToolId.value) return

  loading.value = true
  try {
    const previews = await skillSyncPresenter.previewExport(
      selectedSkills.value,
      selectedToolId.value,
      exportOptions.value
    )
    exportPreviews.value = previews

    // Initialize conflict strategies
    const strategies: Record<string, ConflictStrategy> = {}
    for (const preview of previews) {
      if (preview.conflict) {
        strategies[preview.skillName] = ConflictStrategy.SKIP
      }
    }
    conflictStrategies.value = strategies
  } catch (error) {
    console.error('Preview export error:', error)
    toast({
      title: t('settings.skills.sync.previewError'),
      description: String(error),
      variant: 'destructive'
    })
  } finally {
    loading.value = false
  }
}

const executeExport = async () => {
  exporting.value = true
  exportProgress.value = { current: 0, total: exportPreviews.value.length, currentSkill: '' }

  try {
    const result = await skillSyncPresenter.executeExport(
      exportPreviews.value,
      conflictStrategies.value
    )

    if (result.success) {
      toast({
        title: t('settings.skills.sync.exportSuccess'),
        description: t('settings.skills.sync.exportSuccessMessage', {
          count: result.exported,
          skipped: result.skipped
        })
      })
      emit('complete')
    } else {
      // Log detailed failure info for debugging
      console.error('Export failures:', result.failed)

      // Build detailed error message
      const failureDetails = result.failed.map((f) => `${f.skill}: ${f.reason}`).join('\n')

      toast({
        title: t('settings.skills.sync.exportPartial'),
        description: `${t('settings.skills.sync.exportPartialMessage', {
          exported: result.exported,
          failed: result.failed.length
        })}\n\n${failureDetails}`,
        variant: 'destructive',
        duration: 10000 // Show longer so user can read the error
      })
      emit('complete')
    }
  } catch (error) {
    console.error('Export error:', error)
    toast({
      title: t('settings.skills.sync.exportError'),
      description: String(error),
      variant: 'destructive'
    })
  } finally {
    exporting.value = false
  }
}

// Lifecycle
onMounted(async () => {
  await skillsStore.loadSkills()
})

// Initialize skillCheckedState when skills are loaded
watch(
  localSkills,
  (skills) => {
    const newState: Record<string, boolean> = {}
    for (const skill of skills) {
      // Preserve existing checked state or default to false
      newState[skill.name] = skillCheckedState.value[skill.name] ?? false
    }
    skillCheckedState.value = newState
  },
  { immediate: true }
)

// Reset state when going back
watch(
  () => props.currentStep,
  (step) => {
    if (step === 1) {
      selectedToolId.value = null
      exportPreviews.value = []
      conflictStrategies.value = {}
      // Reset Kiro options
      kiroInclusion.value = 'on-demand'
      kiroFilePatterns.value = ''
    }
  }
)
</script>
