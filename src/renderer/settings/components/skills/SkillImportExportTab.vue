<template>
  <div class="space-y-4">
    <div class="rounded-md border px-4 py-3">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button
          type="button"
          class="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="directoryPickerDisabled"
          @click="chooseDirectory"
        >
          <div class="mb-2 text-sm font-medium">
            {{ t('settings.skills.importExport.directory') }}
          </div>
          <div class="flex min-w-0 items-center gap-2 text-sm">
            <Icon
              :icon="directoryStatusIcon"
              class="h-4 w-4 shrink-0"
              :class="
                directoryValidationFailed
                  ? 'text-destructive'
                  : directoryExists === false
                    ? 'text-amber-500'
                    : 'text-muted-foreground'
              "
            />
            <span
              class="min-w-0 truncate font-mono text-xs"
              :class="directory ? 'text-foreground' : 'text-muted-foreground'"
              :title="directory || t('settings.skills.importExport.noDirectory')"
            >
              {{ directory || t('settings.skills.importExport.noDirectory') }}
            </span>
          </div>
          <p
            v-if="directoryValidationFailed || directoryPickerFailed"
            class="mt-2 text-xs text-destructive"
          >
            {{ t('common.error.requestFailed') }}
          </p>
          <p
            v-else-if="directory && directoryExists === false"
            class="mt-2 text-xs text-amber-600 dark:text-amber-400"
          >
            {{ t('settings.skills.importExport.directoryMissing') }}
          </p>
          <p v-else-if="!directory" class="mt-2 text-xs text-muted-foreground">
            {{ t('settings.skills.importExport.chooseDirectoryHint') }}
          </p>
        </button>
        <DcButton variant="outline" :disabled="directoryPickerDisabled" @click="chooseDirectory">
          <Spinner
            v-if="configLoading || choosingDirectory || directorySaving"
            data-icon="inline-start"
          />
          <Icon v-else icon="lucide:folder-open" data-icon="inline-start" />
          {{
            directory
              ? t('settings.skills.importExport.changeDirectory')
              : t('settings.skills.importExport.chooseDirectory')
          }}
        </DcButton>
      </div>
    </div>

    <div
      v-if="configLoadFailed || previewError"
      class="flex items-center justify-between gap-3 rounded-md border border-destructive/30 px-3 py-2"
    >
      <span class="text-sm text-destructive">
        {{
          previewError ? t('settings.skills.sync.previewError') : t('common.error.requestFailed')
        }}
      </span>
      <DcButton
        variant="outline"
        size="sm"
        :disabled="configLoading || previewing || operationPending"
        @click="retryReadOperation"
      >
        {{ t('common.retry') }}
      </DcButton>
    </div>

    <div
      v-if="!syncDirectoryReady && !configLoadFailed"
      class="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
    >
      {{
        directory
          ? t('settings.skills.importExport.directoryMissingAction')
          : t('settings.skills.importExport.noDirectoryAction')
      }}
    </div>

    <Tabs v-if="syncDirectoryReady" v-model="activeTab">
      <TabsList class="grid w-full max-w-xs grid-cols-2">
        <TabsTrigger value="export" :disabled="operationPending">
          {{ t('settings.skills.importExport.export') }}
        </TabsTrigger>
        <TabsTrigger value="import" :disabled="operationPending">
          {{ t('settings.skills.importExport.import') }}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="export" class="mt-4 space-y-4">
        <div class="flex flex-col gap-3 rounded-md border px-3 py-3 md:flex-row md:items-center">
          <div class="relative min-w-0 flex-1">
            <Icon
              icon="lucide:search"
              class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              v-model="exportQuery"
              :disabled="operationPending"
              :placeholder="t('settings.skills.importExport.searchPlaceholder')"
              class="h-8 pl-8"
            />
          </div>
          <label class="flex items-center gap-2 whitespace-nowrap text-sm">
            <Checkbox
              :checked="includeDisabled"
              :disabled="operationPending"
              @update:checked="setIncludeDisabled"
            />
            {{ t('settings.skills.importExport.includeDisabled') }}
          </label>
          <span class="text-sm text-muted-foreground">
            {{
              t('settings.skills.importExport.selectedCount', { count: selectedExportNames.size })
            }}
          </span>
          <div class="flex shrink-0 gap-2">
            <DcButton
              variant="outline"
              size="sm"
              :disabled="operationPending"
              @click="selectVisibleExport"
            >
              {{ t('settings.skills.importExport.selectVisible') }}
            </DcButton>
            <DcButton
              variant="outline"
              size="sm"
              :disabled="operationPending"
              @click="clearExportSelection"
            >
              {{ t('settings.skills.importExport.clearSelection') }}
            </DcButton>
          </div>
        </div>

        <div class="max-h-[48vh] overflow-y-auto rounded-md border">
          <label
            v-for="skill in exportCandidates"
            :key="skill.name"
            class="flex cursor-pointer items-start gap-2 border-b px-3 py-2 last:border-b-0"
          >
            <Checkbox
              :checked="selectedExportNames.has(skill.name)"
              :disabled="operationPending || (skill.deepchatDisabled && !includeDisabled)"
              @update:checked="toggleExport(skill.name)"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium" :title="skill.name">
                {{ skill.name }}
              </span>
              <span class="block truncate text-xs text-muted-foreground" :title="skill.description">
                {{ skill.description }}
              </span>
            </span>
            <DcBadge variant="outline">
              {{
                skill.deepchatDisabled
                  ? t('settings.skills.card.disabled')
                  : t('settings.skills.card.enabled')
              }}
            </DcBadge>
          </label>
          <div
            v-if="exportCandidates.length === 0"
            class="px-3 py-8 text-center text-sm text-muted-foreground"
          >
            {{ skills.length === 0 ? t('settings.skills.empty') : t('settings.skills.noResults') }}
          </div>
        </div>

        <div class="flex justify-end">
          <DcButton :disabled="!canExport" @click="requestExportConfirmation">
            <Spinner v-if="previewing || exporting" data-icon="inline-start" />
            <Icon v-else icon="lucide:upload" data-icon="inline-start" />
            {{ t('settings.skills.importExport.exportNow') }}
          </DcButton>
        </div>
      </TabsContent>

      <TabsContent value="import" class="mt-4 space-y-4">
        <div class="flex flex-col gap-3 rounded-md border px-3 py-3 lg:flex-row lg:items-center">
          <div class="relative min-w-0 flex-1">
            <Icon
              icon="lucide:search"
              class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              v-model="importQuery"
              :disabled="operationPending"
              :placeholder="t('settings.skills.importExport.searchPlaceholder')"
              class="h-8 pl-8"
            />
          </div>
          <select
            v-model="importStateFilter"
            :disabled="operationPending"
            :aria-label="t('settings.skills.importExport.stateFilter')"
            class="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">{{ t('settings.skills.importExport.allStates') }}</option>
            <option value="new">{{ t('settings.skills.importExport.state.new') }}</option>
            <option value="conflict">{{ t('settings.skills.importExport.state.conflict') }}</option>
            <option value="modified">{{ t('settings.skills.importExport.state.modified') }}</option>
            <option value="same">{{ t('settings.skills.importExport.state.same') }}</option>
            <option value="invalid">{{ t('settings.skills.importExport.state.invalid') }}</option>
          </select>
          <span class="text-sm text-muted-foreground">
            {{
              t('settings.skills.importExport.selectedCount', { count: selectedImportNames.size })
            }}
          </span>
          <div class="flex shrink-0 flex-wrap gap-2">
            <DcButton
              variant="outline"
              size="sm"
              :disabled="!config || previewing || operationPending"
              @click="previewImport"
            >
              <Spinner v-if="previewing" data-icon="inline-start" />
              <Icon v-else icon="lucide:refresh-cw" data-icon="inline-start" />
              {{ t('settings.skills.importExport.refresh') }}
            </DcButton>
            <DcButton
              variant="outline"
              size="sm"
              :disabled="operationPending"
              @click="selectVisibleImport"
            >
              {{ t('settings.skills.importExport.selectVisible') }}
            </DcButton>
            <DcButton
              variant="outline"
              size="sm"
              :disabled="operationPending"
              @click="clearImportSelection"
            >
              {{ t('settings.skills.importExport.clearSelection') }}
            </DcButton>
          </div>
        </div>

        <div class="max-h-[48vh] overflow-y-auto rounded-md border">
          <label
            v-for="item in filteredImportItems"
            :key="item.sourcePath"
            class="flex cursor-pointer items-start gap-2 border-b px-3 py-2 last:border-b-0"
            :class="{ 'cursor-not-allowed opacity-60': !isSelectableImportItem(item) }"
          >
            <Checkbox
              :checked="selectedImportNames.has(item.name)"
              :disabled="operationPending || !isSelectableImportItem(item)"
              @update:checked="toggleImport(item.name)"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium" :title="item.name">
                {{ item.name }}
              </span>
              <span
                class="block truncate font-mono text-xs text-muted-foreground"
                :title="item.sourcePath"
              >
                {{ item.sourcePath }}
              </span>
              <span v-if="item.error" class="block text-xs text-destructive">
                {{ t('settings.skills.sync.previewError') }}
              </span>
            </span>
            <DcBadge variant="outline" :class="stateClass(item.state)">
              {{ t(`settings.skills.importExport.state.${item.state}`) }}
            </DcBadge>
          </label>
          <div
            v-if="!importPreview || filteredImportItems.length === 0"
            class="px-3 py-8 text-center text-sm text-muted-foreground"
          >
            {{
              importPreview
                ? t('settings.skills.noResults')
                : t('settings.skills.importExport.noImportPreview')
            }}
          </div>
        </div>

        <div class="space-y-2 rounded-md border px-3 py-3">
          <div class="text-sm font-medium">{{ t('settings.skills.importExport.strategy') }}</div>
          <RadioGroup v-model="importStrategy" class="grid gap-2 sm:grid-cols-3">
            <label class="flex items-center gap-2 text-sm">
              <RadioGroupItem value="overwrite" :disabled="operationPending" />
              {{ t('settings.skills.importExport.overwrite') }}
            </label>
            <label class="flex items-center gap-2 text-sm">
              <RadioGroupItem value="rename" :disabled="operationPending" />
              {{ t('settings.skills.importExport.rename') }}
            </label>
            <label class="flex items-center gap-2 text-sm">
              <RadioGroupItem value="skip" :disabled="operationPending" />
              {{ t('settings.skills.importExport.skip') }}
            </label>
          </RadioGroup>
        </div>

        <div class="flex justify-end">
          <DcSubmitButton
            :status="importStatus"
            :icon="'lucide:download'"
            :disabled="!canImport"
            @click="executeImport"
          >
            {{ t('settings.skills.importExport.importSelected') }}
          </DcSubmitButton>
        </div>
        <DcInlineError v-if="operationErrorMessage" :error="operationErrorMessage" class="mt-2" />
      </TabsContent>
    </Tabs>

    <Dialog :open="exportConfirmOpen" @update:open="handleExportConfirmOpenChange">
      <DialogContent class="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ t('settings.skills.importExport.exportConfirmTitle') }}</DialogTitle>
          <DialogDescription>
            {{
              t('settings.skills.importExport.exportConfirmDescription', {
                count: exportPreview?.items.length ?? 0,
                directory: config?.skillsDirectory ?? ''
              })
            }}
          </DialogDescription>
        </DialogHeader>

        <div class="max-h-80 overflow-y-auto rounded-md border">
          <div
            v-for="item in exportPreview?.items ?? []"
            :key="item.sourcePath"
            class="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
          >
            <div class="min-w-0 flex-1 truncate" :title="item.name">{{ item.name }}</div>
            <DcBadge variant="outline" :class="stateClass(item.state)">
              {{ t(`settings.skills.importExport.state.${item.state}`) }}
            </DcBadge>
          </div>
          <div
            v-if="!exportPreview || exportPreview.items.length === 0"
            class="px-3 py-8 text-center text-sm text-muted-foreground"
          >
            {{ t('settings.skills.importExport.emptyExportConfirm') }}
          </div>
        </div>

        <DcInlineError v-if="operationErrorMessage" :error="operationErrorMessage" class="mt-2" />

        <DialogFooter>
          <DcFormActions
            :submit-status="exportStatus"
            :submit-icon="'lucide:upload'"
            :submit-disabled="!canConfirmExport"
            :cancel-disabled="exporting"
            :submit-label="t('settings.skills.importExport.confirmExport')"
            @cancel="handleExportConfirmOpenChange(false)"
            @submit="executeExport"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { nanoid } from 'nanoid'
import { DcBadge } from '@dc-ui/components/badge'
import { DcButton } from '@dc-ui/components/button'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Checkbox } from '@shadcn/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Input } from '@shadcn/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@shadcn/components/ui/radio-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { DcSubmitButton, useDcFormSubmit } from '@dc-ui/components/form'
import { DcFormActions } from '@dc-ui/components/form-actions'
import { createDeviceClient } from '@api/DeviceClient'
import { createProjectClient } from '@api/ProjectClient'
import { createSkillClient } from '@api/SkillClient'
import type {
  SkillInstallConflictStrategy,
  SkillSyncDirectoryExportPreview,
  SkillSyncDirectoryImportPreview,
  SkillSyncDirectoryPreviewItem,
  SyncDirectorySkillState
} from '@shared/types/skill'
import type { SkillSyncDirectoryConfig } from '@shared/types/skillManagement'
import type { UnifiedSkillItem } from '@shared/types/skillManagement'
import { settingsLeaveGuard } from '../../services/settingsLeaveGuard'

const props = defineProps<{
  skills: UnifiedSkillItem[]
}>()

const { t } = useI18n()
const skillClient = createSkillClient()
const deviceClient = createDeviceClient()
const projectClient = createProjectClient()
const IMPORT_PREVIEW_CACHE_TTL_MS = 2000

const activeTab = ref<'export' | 'import'>('export')
const config = ref<SkillSyncDirectoryConfig | null>(null)
const directory = ref('')
const directoryExists = ref<boolean | null>(null)
const directoryValidationFailed = ref(false)
const directoryPickerFailed = ref(false)
const configLoadFailed = ref(false)
const previewError = ref(false)
const configLoading = ref(false)
const choosingDirectory = ref(false)
const exportPreviewing = ref(false)
const importPreviewing = ref(false)
const operationKind = ref<'directory' | 'export' | 'import' | null>(null)
const retryKind = ref<'directory' | 'export' | 'import' | null>(null)
const retryDirectory = ref('')
const retryExportNames = ref<string[] | null>(null)
const includeDisabled = ref(true)
const exportQuery = ref('')
const importQuery = ref('')
const importStateFilter = ref<SyncDirectorySkillState | 'all'>('all')
const selectedExportNames = ref<Set<string>>(new Set())
const selectedImportNames = ref<Set<string>>(new Set())
const exportPreview = ref<SkillSyncDirectoryExportPreview | null>(null)
const importPreview = ref<SkillSyncDirectoryImportPreview | null>(null)
const exportConfirmOpen = ref(false)
const importStrategy = ref<SkillInstallConflictStrategy>('overwrite')
const importPreviewCache = ref<{
  key: string
  preview: SkillSyncDirectoryImportPreview
  timestamp: number
} | null>(null)
const importPreviewRequestId = ref(0)
let exportPreviewRequestId = 0
let configRequestId = 0
let operationGeneration = 0
const operationPending = ref(false)
const operationError = ref(false)
const operationErrorMessage = ref<string | null>(null)
const { status: exportStatus, run: runExport } = useDcFormSubmit()
const { status: importStatus, run: runImport } = useDcFormSubmit()
let disposed = false
let importPreviewInFlight: {
  key: string
  promise: Promise<SkillSyncDirectoryImportPreview>
} | null = null

const skills = computed(() => props.skills.filter((skill) => skill.mutable))
const syncDirectoryReady = computed(() =>
  Boolean(config.value?.skillsDirectory && directoryExists.value)
)
const previewing = computed(() => exportPreviewing.value || importPreviewing.value)
const directorySaving = computed(
  () => operationKind.value === 'directory' && operationPending.value
)
const exporting = computed(() => operationKind.value === 'export' && operationPending.value)
const directoryPickerDisabled = computed(
  () => configLoading.value || operationPending.value || choosingDirectory.value
)
const directoryStatusIcon = computed(() => {
  if (directoryValidationFailed.value || (directory.value && directoryExists.value === false)) {
    return 'lucide:circle-alert'
  }
  return directory.value ? 'lucide:folder' : 'lucide:folder-open'
})
const exportCandidates = computed(() => {
  const query = normalizeQuery(exportQuery.value)
  return skills.value.filter((skill) => {
    if (!includeDisabled.value && skill.deepchatDisabled) {
      return false
    }
    return matchesSkill(skill, query)
  })
})
const filteredImportItems = computed(() => {
  const query = normalizeQuery(importQuery.value)
  return (importPreview.value?.items ?? []).filter((item) => {
    if (importStateFilter.value !== 'all' && item.state !== importStateFilter.value) {
      return false
    }
    return matchesImportItem(item, query)
  })
})
const canExport = computed(
  () =>
    Boolean(config.value) &&
    selectedExportNames.value.size > 0 &&
    !previewing.value &&
    !operationPending.value
)
const canImport = computed(
  () =>
    Boolean(config.value) &&
    selectedImportNames.value.size > 0 &&
    !previewing.value &&
    !operationPending.value
)
const canConfirmExport = computed(
  () =>
    Boolean(exportPreview.value) &&
    !exporting.value &&
    !(operationError.value && retryKind.value !== 'export')
)

const logFailure = (message: string, error: unknown) => {
  console.error(message, error)
}

const beginOperation = (kind: Exclude<typeof operationKind.value, null>): number | null => {
  if (operationPending.value) return null
  const generation = ++operationGeneration
  operationKind.value = kind
  retryKind.value = kind
  operationPending.value = true
  operationError.value = false
  return generation
}

const isCurrentOperation = (generation: number) =>
  generation === operationGeneration && operationPending.value

const finishOperation = (failed: boolean) => {
  operationPending.value = false
  operationError.value = failed
}

const clearSettledOperation = () => {
  if (operationError.value) {
    operationError.value = false
    retryKind.value = null
    operationErrorMessage.value = null
  }
}

const loadConfig = async () => {
  const requestId = ++configRequestId
  configLoading.value = true
  configLoadFailed.value = false
  try {
    const nextConfig = await skillClient.getSkillsSyncConfig()
    const nextDirectory = nextConfig?.skillsDirectory ?? ''
    const validation = await checkDirectoryExists(nextDirectory)
    if (disposed || requestId !== configRequestId) return

    config.value = nextConfig
    directory.value = nextDirectory
    directoryExists.value = validation.exists
    directoryValidationFailed.value = validation.failed
    if (syncDirectoryReady.value && activeTab.value === 'import') {
      await refreshImportPreview()
    }
  } catch (error) {
    if (disposed || requestId !== configRequestId) return
    config.value = null
    directory.value = ''
    directoryExists.value = null
    directoryValidationFailed.value = false
    configLoadFailed.value = true
    logFailure('[SkillImportExportTab] Failed to load sync directory configuration', error)
  } finally {
    if (requestId === configRequestId) configLoading.value = false
  }
}

const checkDirectoryExists = async (path: string) => {
  if (!path) return { exists: null, failed: false } as const
  try {
    return { exists: await projectClient.pathExists(path), failed: false } as const
  } catch (error) {
    logFailure('[SkillImportExportTab] Failed to validate sync directory', error)
    return { exists: null, failed: true } as const
  }
}

const chooseDirectory = async () => {
  if (directoryPickerDisabled.value) return
  directoryPickerFailed.value = false
  choosingDirectory.value = true
  try {
    const result = await deviceClient.selectDirectory()
    if (disposed) return
    if (!result.canceled && result.filePaths[0]) {
      await saveDirectory(result.filePaths[0])
    }
  } catch (error) {
    if (disposed) return
    directoryPickerFailed.value = true
    logFailure('[SkillImportExportTab] Failed to select sync directory', error)
  } finally {
    choosingDirectory.value = false
  }
}

const saveDirectory = async (nextDirectory: string) => {
  const generation = beginOperation('directory')
  if (generation === null) return
  configRequestId += 1
  configLoading.value = false
  directoryPickerFailed.value = false
  invalidateExportPreview()
  retryDirectory.value = nextDirectory
  try {
    const nextConfig = await skillClient.setSkillsSyncDirectory(nextDirectory)
    if (!isCurrentOperation(generation)) return
    const validation = await checkDirectoryExists(nextConfig.skillsDirectory)
    if (!isCurrentOperation(generation)) return
    config.value = nextConfig
    configLoadFailed.value = false
    directory.value = nextConfig.skillsDirectory
    directoryExists.value = validation.exists
    directoryValidationFailed.value = validation.failed
    invalidateImportPreviewCache()
    importPreview.value = null
    selectedImportNames.value = new Set()
    if (syncDirectoryReady.value && activeTab.value === 'import') {
      await refreshImportPreview({ force: true })
    }
    if (!isCurrentOperation(generation)) return
    notifyRenderer({
      kind: 'success',
      code: 'settings.skills.syncDirectorySaved',
      title: t('settings.skills.importExport.saved')
    })
    finishOperation(false)
    retryKind.value = null
    retryDirectory.value = ''
  } catch (error) {
    if (!isCurrentOperation(generation)) return
    logFailure('[SkillImportExportTab] Failed to save sync directory', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.skills.syncDirectorySaveFailed',
      title: t('common.error.operationFailed')
    })
    finishOperation(true)
  }
}

const toggleExport = (name: string) => {
  selectedExportNames.value = toggleSet(selectedExportNames.value, name)
}

const toggleImport = (name: string) => {
  const item = importPreview.value?.items.find((candidate) => candidate.name === name)
  if (item && !isSelectableImportItem(item)) {
    return
  }
  selectedImportNames.value = toggleSet(selectedImportNames.value, name)
}

const setIncludeDisabled = (checked: boolean | 'indeterminate') => {
  includeDisabled.value = checked === true
  if (!includeDisabled.value) {
    selectedExportNames.value = new Set(
      [...selectedExportNames.value].filter(
        (name) => !props.skills.find((skill) => skill.name === name)?.deepchatDisabled
      )
    )
  }
}

const toggleSet = (current: Set<string>, name: string) => {
  const next = new Set(current)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  return next
}

const normalizeQuery = (value: string) => value.trim().toLowerCase()
const normalizeResultCount = (value: number | undefined, maximum: number) => {
  if (!Number.isFinite(value)) return 0
  return Math.min(maximum, Math.max(0, Math.trunc(value ?? 0)))
}

const matchesSkill = (skill: UnifiedSkillItem, query: string) => {
  if (!query) return true
  return skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
}

const matchesImportItem = (item: SkillSyncDirectoryPreviewItem, query: string) => {
  if (!query) return true
  return item.name.toLowerCase().includes(query) || item.sourcePath.toLowerCase().includes(query)
}

const isSelectableImportItem = (item: SkillSyncDirectoryPreviewItem) =>
  item.state !== 'invalid' && item.state !== 'same'

const selectVisibleExport = () => {
  selectedExportNames.value = new Set(exportCandidates.value.map((skill) => skill.name))
}

const clearExportSelection = () => {
  selectedExportNames.value = new Set()
}

const selectVisibleImport = () => {
  selectedImportNames.value = new Set(
    filteredImportItems.value.filter(isSelectableImportItem).map((item) => item.name)
  )
}

const clearImportSelection = () => {
  selectedImportNames.value = new Set()
}

const filterSelectedImportNames = (
  current: Set<string>,
  preview: SkillSyncDirectoryImportPreview
) => {
  const selectable = new Set(preview.items.filter(isSelectableImportItem).map((item) => item.name))
  return new Set([...current].filter((name) => selectable.has(name)))
}

const invalidateImportPreviewCache = () => {
  importPreviewRequestId.value += 1
  importPreviewCache.value = null
  importPreviewInFlight = null
  importPreviewing.value = false
}

const invalidateExportPreview = () => {
  exportPreviewRequestId += 1
  exportPreviewing.value = false
  exportPreview.value = null
  exportConfirmOpen.value = false
  retryExportNames.value = null
}

const showPreviewError = (error: unknown) => {
  previewError.value = true
  logFailure('[SkillImportExportTab] Failed to preview sync directory', error)
}

const requestExportConfirmation = async () => {
  const requestId = ++exportPreviewRequestId
  const syncDirectory = config.value?.skillsDirectory
  if (!syncDirectory) return
  const skillNames = [...selectedExportNames.value]
  const requestedIncludeDisabled = includeDisabled.value
  previewError.value = false
  exportPreviewing.value = true
  try {
    const preview = await skillClient.previewSyncDirectoryExport({
      skillNames,
      includeDisabled: requestedIncludeDisabled
    })
    if (requestId !== exportPreviewRequestId || config.value?.skillsDirectory !== syncDirectory) {
      return
    }
    exportPreview.value = preview
    retryExportNames.value = null
    exportConfirmOpen.value = true
  } catch (error) {
    if (requestId !== exportPreviewRequestId || config.value?.skillsDirectory !== syncDirectory) {
      return
    }
    exportPreview.value = null
    exportConfirmOpen.value = false
    showPreviewError(error)
  } finally {
    if (requestId === exportPreviewRequestId) exportPreviewing.value = false
  }
}

const executeExport = async () => {
  const skillNames =
    retryKind.value === 'export' && retryExportNames.value?.length
      ? [...retryExportNames.value]
      : [...selectedExportNames.value]
  if (skillNames.length === 0) return
  const generation = beginOperation('export')
  if (generation === null) return
  const requestedIncludeDisabled = includeDisabled.value
  retryExportNames.value = skillNames
  operationErrorMessage.value = null
  try {
    await runExport(async () => {
      const result = await skillClient.executeSyncDirectoryExport({
        skillNames,
        includeDisabled: requestedIncludeDisabled
      })
      if (!isCurrentOperation(generation)) return
      const exported = normalizeResultCount(result.exported, skillNames.length)
      const skipped = normalizeResultCount(result.skipped, skillNames.length)
      const failed = Math.min(
        skillNames.length,
        Math.max(
          result.failed.length,
          result.success ? 0 : 1,
          skillNames.length - exported - skipped
        )
      )
      invalidateImportPreviewCache()
      if (!result.success || failed > 0) {
        const failedNames = new Set(result.failed.map((failure) => failure.skillName))
        const invalidNames = new Set(
          (exportPreview.value?.items ?? [])
            .filter((item) => item.state === 'invalid')
            .map((item) => item.name)
        )
        const retryCandidates = (
          failedNames.size ? skillNames.filter((name) => failedNames.has(name)) : skillNames
        ).filter((name) => !invalidNames.has(name))
        retryExportNames.value = retryCandidates.length > 0 ? retryCandidates : null
        if (!retryExportNames.value) retryKind.value = null
        operationErrorMessage.value = t('settings.skills.importExport.result', {
          count: exported,
          failed
        })
        finishOperation(true)
        throw new Error('Sync directory export was incomplete')
      }
      finishOperation(false)
      exportConfirmOpen.value = false
      retryKind.value = null
      retryExportNames.value = null
    })
  } catch (error) {
    if (!operationErrorMessage.value) {
      logFailure('[SkillImportExportTab] Failed to export skills', error)
      finishOperation(true)
      operationErrorMessage.value = t('common.error.requestFailed')
    }
  }
}

const applyImportPreview = (
  preview: SkillSyncDirectoryImportPreview,
  options: { clearSelection?: boolean } = {}
) => {
  importPreview.value = preview
  selectedImportNames.value = options.clearSelection
    ? new Set()
    : filterSelectedImportNames(selectedImportNames.value, preview)
}

const refreshImportPreview = async (
  options: { force?: boolean; clearSelection?: boolean } = {}
) => {
  if (!syncDirectoryReady.value) return
  const syncDirectory = config.value?.skillsDirectory
  if (!syncDirectory) return
  previewError.value = false

  const cached = importPreviewCache.value
  const now = Date.now()
  if (
    !options.force &&
    cached?.key === syncDirectory &&
    now - cached.timestamp < IMPORT_PREVIEW_CACHE_TTL_MS
  ) {
    applyImportPreview(cached.preview, options)
    return
  }

  if (!options.force && importPreviewInFlight?.key === syncDirectory) {
    const inFlight = importPreviewInFlight
    const requestId = importPreviewRequestId.value
    try {
      const preview = await inFlight.promise
      if (
        requestId !== importPreviewRequestId.value ||
        config.value?.skillsDirectory !== syncDirectory
      ) {
        return
      }
      applyImportPreview(preview, options)
    } catch (error) {
      if (
        requestId !== importPreviewRequestId.value ||
        config.value?.skillsDirectory !== syncDirectory
      ) {
        return
      }
      importPreview.value = null
      selectedImportNames.value = new Set()
      showPreviewError(error)
    }
    return
  }

  const requestId = ++importPreviewRequestId.value
  importPreviewing.value = true
  const promise = skillClient.previewSyncDirectoryImport()
  importPreviewInFlight = { key: syncDirectory, promise }
  try {
    const preview = await promise
    importPreviewCache.value = {
      key: syncDirectory,
      preview,
      timestamp: Date.now()
    }
    if (
      requestId === importPreviewRequestId.value &&
      config.value?.skillsDirectory === syncDirectory
    ) {
      applyImportPreview(preview, options)
    }
  } catch (error) {
    if (
      requestId === importPreviewRequestId.value &&
      config.value?.skillsDirectory === syncDirectory
    ) {
      importPreview.value = null
      selectedImportNames.value = new Set()
      showPreviewError(error)
    }
  } finally {
    if (importPreviewInFlight?.promise === promise) {
      importPreviewInFlight = null
    }
    if (requestId === importPreviewRequestId.value) {
      importPreviewing.value = false
    }
  }
}

const previewImport = async () => {
  await refreshImportPreview({ force: true })
}

const executeImport = async () => {
  const skillNames = [...selectedImportNames.value]
  if (skillNames.length === 0) {
    retryKind.value = null
    return
  }
  const generation = beginOperation('import')
  if (generation === null) return
  const strategy = importStrategy.value
  operationErrorMessage.value = null
  try {
    await runImport(async () => {
      const result = await skillClient.executeSyncDirectoryImport({
        skillNames,
        strategy
      })
      if (!isCurrentOperation(generation)) return
      const imported = normalizeResultCount(result.imported, skillNames.length)
      const skipped = normalizeResultCount(result.skipped, skillNames.length)
      const failed = Math.min(
        skillNames.length,
        Math.max(
          result.failed.length,
          result.success ? 0 : 1,
          skillNames.length - imported - skipped
        )
      )
      invalidateImportPreviewCache()
      if (!result.success || failed > 0) {
        const failedNames = new Set(result.failed.map((failure) => failure.skillName))
        selectedImportNames.value = failedNames.size
          ? new Set(skillNames.filter((name) => failedNames.has(name)))
          : new Set(skillNames)
        operationErrorMessage.value = t('settings.skills.importExport.result', {
          count: imported,
          failed
        })
        finishOperation(true)
        await refreshImportPreview({ force: true })
        if (selectedImportNames.value.size === 0) retryKind.value = null
        throw new Error('Sync directory import was incomplete')
      }
      finishOperation(false)
      retryKind.value = null
      selectedImportNames.value = new Set()
      await refreshImportPreview({ force: true })
    })
  } catch (error) {
    if (!operationErrorMessage.value) {
      logFailure('[SkillImportExportTab] Failed to import skills', error)
      finishOperation(true)
      operationErrorMessage.value = t('common.error.requestFailed')
    }
  }
}

const stateClass = (state: SkillSyncDirectoryPreviewItem['state']) => {
  if (state === 'conflict' || state === 'modified') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  }
  if (state === 'invalid') {
    return 'border-destructive/40 bg-destructive/10 text-destructive'
  }
  if (state === 'new') {
    return 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300'
  }
  return ''
}

watch(
  [selectedExportNames, includeDisabled],
  () => {
    invalidateExportPreview()
  },
  { flush: 'sync' }
)

watch(activeTab, (tab) => {
  previewError.value = false
  if (
    operationError.value &&
    ((tab === 'import' && retryKind.value === 'export') ||
      (tab === 'export' && retryKind.value === 'import'))
  ) {
    clearSettledOperation()
  }
  if (tab === 'import') {
    void refreshImportPreview()
  }
})

const retryReadOperation = () => {
  if (configLoadFailed.value) {
    void loadConfig()
  } else if (activeTab.value === 'import') {
    void previewImport()
  } else {
    void requestExportConfirmation()
  }
}

const handleExportConfirmOpenChange = (open: boolean) => {
  if (!open && exporting.value) return
  exportConfirmOpen.value = open
  if (!open && retryKind.value === 'export' && operationError.value) {
    clearSettledOperation()
  }
  if (!open) retryExportNames.value = null
}

const leaveGuardLease = settingsLeaveGuard.register({
  id: `settings.skills.syncDirectory:${nanoid(8)}`,
  onDiscard: () => undefined
})
const stopLeaveRiskSync = watch(
  operationPending,
  (pending) => {
    leaveGuardLease.setRisk(pending ? 'busy' : 'clean')
  },
  { immediate: true, flush: 'sync' }
)

onMounted(() => {
  disposed = false
  void loadConfig()
})

onBeforeUnmount(() => {
  disposed = true
  configRequestId += 1
  exportPreviewRequestId += 1
  importPreviewRequestId.value += 1
  stopLeaveRiskSync()
  leaveGuardLease.release()
})
</script>
