<template>
  <SettingsPageShell
    :title="t('routes.settings-ocr')"
    :description="t('settings.ocr.description')"
    :eyebrow="t('settings.controlCenter.groups.tools')"
    data-testid="settings-ocr-page"
  >
    <SettingsSectionCard
      :title="t('settings.ocr.automationTitle')"
      :description="t('settings.ocr.automationDescription')"
    >
      <div class="flex flex-col gap-5">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ t('settings.ocr.autoExtract') }}</div>
            <p class="mt-1 text-sm text-muted-foreground">
              {{ t('settings.ocr.autoExtractDescription') }}
            </p>
          </div>
          <Switch
            data-testid="ocr-auto-extract-switch"
            :aria-label="t('settings.ocr.autoExtract')"
            :model-value="automaticExtractionEnabled"
            :disabled="settingsLoading || !settingsReady || settingInFlight"
            @update:model-value="updateAutomaticExtraction"
          />
        </div>

        <Separator />

        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ t('settings.ocr.backend') }}</div>
            <p class="mt-1 text-sm text-muted-foreground">
              {{ t('settings.ocr.backendDescription') }}
            </p>
          </div>
          <Select
            :model-value="backend"
            :disabled="settingsLoading || !settingsReady || settingInFlight"
            @update:model-value="updateBackend"
          >
            <SelectTrigger
              data-testid="ocr-backend-select"
              class="w-40"
              :aria-label="t('settings.ocr.backend')"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{{ t('settings.ocr.backendAuto') }}</SelectItem>
              <SelectItem value="cpu">{{ t('settings.ocr.backendCpu') }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard
      :title="t('settings.ocr.runtimeTitle')"
      :description="t('settings.ocr.runtimeDescription')"
    >
      <template #actions>
        <Button
          variant="ghost"
          size="sm"
          :disabled="statusLoading"
          data-testid="ocr-refresh-status"
          @click="refreshStatus"
        >
          <Spinner v-if="statusLoading" class="mr-2 size-4" />
          <Icon v-else icon="lucide:refresh-cw" class="mr-2 size-4" />
          {{ t('settings.ocr.refresh') }}
        </Button>
      </template>

      <div v-if="status" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatusMetricCard
          :label="t('settings.ocr.availability')"
          :value="availabilityLabel"
          icon="lucide:package-check"
          :badge="`${status.platform}/${status.arch}`"
          :description="availabilityDescription"
        />
        <StatusMetricCard
          :label="t('settings.ocr.process')"
          :value="processLabel"
          icon="lucide:cpu"
          :description="processDescription"
        />
        <StatusMetricCard
          :label="t('settings.ocr.version')"
          :value="status.availability.lightOcrVersion"
          icon="lucide:badge-check"
          :description="status.availability.bundleId"
        />
      </div>
      <Alert
        v-if="status?.availability.status === 'unavailable'"
        variant="destructive"
        class="mt-4"
      >
        <Icon icon="lucide:circle-alert" class="size-4" />
        <AlertTitle>{{ t('settings.ocr.unavailable') }}</AlertTitle>
        <AlertDescription>{{ availabilityDescription }}</AlertDescription>
      </Alert>
      <div
        v-if="!status"
        class="flex min-h-28 items-center justify-center text-sm text-muted-foreground"
      >
        <Spinner v-if="statusLoading" class="mr-2 size-4" />
        {{ statusLoading ? t('settings.ocr.loading') : t('settings.ocr.statusUnavailable') }}
      </div>

      <div
        v-if="status?.process?.engine"
        class="mt-4 grid gap-x-6 gap-y-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2"
      >
        <div class="flex min-w-0 justify-between gap-3">
          <span class="text-muted-foreground">{{ t('settings.ocr.strategy') }}</span>
          <span class="truncate font-mono text-xs">{{ engineStrategyLabel }}</span>
        </div>
        <div class="flex min-w-0 justify-between gap-3">
          <span class="text-muted-foreground">{{ t('settings.ocr.nodeVersion') }}</span>
          <span class="truncate font-mono text-xs">{{ nodeVersionLabel }}</span>
        </div>
        <div class="flex min-w-0 justify-between gap-3">
          <span class="text-muted-foreground">{{ t('settings.ocr.detectionBackend') }}</span>
          <span class="truncate font-mono text-xs">{{ detectionBackendLabel }}</span>
        </div>
        <div class="flex min-w-0 justify-between gap-3">
          <span class="text-muted-foreground">{{ t('settings.ocr.recognitionBackend') }}</span>
          <span class="truncate font-mono text-xs">{{ recognitionBackendLabel }}</span>
        </div>
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard
      :title="t('settings.ocr.cacheTitle')"
      :description="t('settings.ocr.cacheDescription')"
    >
      <template #actions>
        <Button
          variant="outline"
          size="sm"
          data-testid="ocr-clear-cache"
          :disabled="!canClearCache"
          @click="clearDialogOpen = true"
        >
          <Spinner v-if="cacheClearInFlight" class="mr-2 size-4" />
          <Icon v-else icon="lucide:trash-2" class="mr-2 size-4" />
          {{ t('settings.ocr.clearCache') }}
        </Button>
      </template>

      <div v-if="status?.cache" class="grid gap-3 sm:grid-cols-3">
        <StatusMetricCard
          :label="t('settings.ocr.cacheMode')"
          :value="cacheModeLabel"
          icon="lucide:database"
          :description="cacheModeDescription"
        />
        <StatusMetricCard
          :label="t('settings.ocr.cacheEntries')"
          :value="formatNumber(status.cache.entryCount)"
          icon="lucide:files"
        />
        <StatusMetricCard
          :label="t('settings.ocr.cacheUsage')"
          :value="formatBytes(status.cache.logicalBytes)"
          icon="lucide:hard-drive"
          :description="t('settings.ocr.cacheLimit', { size: formatBytes(status.cache.maxBytes) })"
        />
      </div>
      <p v-else class="text-sm text-muted-foreground">
        {{ t('settings.ocr.cacheNotStarted') }}
      </p>
    </SettingsSectionCard>

    <AlertDialog :open="clearDialogOpen" @update:open="clearDialogOpen = $event">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('settings.ocr.clearCacheTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('settings.ocr.clearCacheDescription') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="cacheClearInFlight">
            {{ t('common.cancel') }}
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="ocr-clear-cache-confirm"
            :disabled="cacheClearInFlight"
            @click="clearCache"
          >
            {{ t('settings.ocr.clearCacheConfirm') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import type { AcceptableValue } from 'reka-ui'
import { useI18n } from 'vue-i18n'
import type { OcrRuntimeStatus } from '@shared/contracts/routes/ocr.routes'
import { createOcrClient } from '@api/OcrClient'
import { createSettingsClient } from '@api/SettingsClient'
import { useToast } from '@/components/use-toast'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@shadcn/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@shadcn/components/ui/alert'
import { Button } from '@shadcn/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Separator } from '@shadcn/components/ui/separator'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Switch } from '@shadcn/components/ui/switch'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import SettingsSectionCard from './control-center/SettingsSectionCard.vue'
import StatusMetricCard from './control-center/StatusMetricCard.vue'

type OcrBackend = 'auto' | 'cpu'

const { t, locale } = useI18n()
const { toast } = useToast()
const settingsClient = createSettingsClient()
const ocrClient = createOcrClient()

const automaticExtractionEnabled = ref(true)
const backend = ref<OcrBackend>('auto')
const status = ref<OcrRuntimeStatus | null>(null)
const settingsLoading = ref(true)
const settingsReady = ref(false)
const settingInFlight = ref(false)
const statusLoading = ref(false)
const cacheClearInFlight = ref(false)
const clearDialogOpen = ref(false)
const statusErrorNotified = ref(false)

const availabilityLabel = computed(() =>
  status.value?.availability.status === 'available'
    ? t('settings.ocr.available')
    : t('settings.ocr.unavailable')
)
const availabilityDescription = computed(() => {
  const availability = status.value?.availability
  return availability?.status === 'unavailable'
    ? t(`settings.ocr.unavailableReasons.${availability.reason}`)
    : t('settings.ocr.offlineReady')
})
const processLabel = computed(() => {
  const state = status.value?.process?.state
  return state ? t(`settings.ocr.processStates.${state}`) : t('settings.ocr.notStarted')
})
const processDescription = computed(() => {
  const process = status.value?.process
  if (!process) return t('settings.ocr.lazyStartDescription')
  if (process.queuedRequests > 0) {
    return t('settings.ocr.queuedRequests', { count: process.queuedRequests })
  }
  return process.nodeVersion ?? t('settings.ocr.nodeNotStarted')
})
const nodeVersionLabel = computed(
  () => status.value?.process?.nodeVersion ?? t('settings.ocr.nodeNotStarted')
)
const engineStrategyLabel = computed(() => {
  const strategy = status.value?.process?.engine?.strategy
  return strategy ? t(`settings.ocr.strategies.${strategy}`) : t('settings.ocr.notStarted')
})
const detectionBackendLabel = computed(() => formatEngineStage('detection'))
const recognitionBackendLabel = computed(() => formatEngineStage('recognition'))
const cacheModeLabel = computed(() => {
  const cache = status.value?.cache
  return cache ? t(`settings.ocr.cacheModes.${cache.mode}`) : t('settings.ocr.notStarted')
})
const cacheModeDescription = computed(() => {
  const reason = status.value?.cache?.persistenceUnavailableReason
  return reason
    ? t(`settings.ocr.cacheFallbackReasons.${reason}`)
    : t('settings.ocr.cacheProtected')
})
const canClearCache = computed(() => {
  const process = status.value?.process
  const processIsActive =
    process !== null &&
    process !== undefined &&
    (process.queuedRequests > 0 ||
      process.state === 'starting' ||
      process.state === 'busy' ||
      process.state === 'stopping')
  return (
    status.value?.availability.status === 'available' &&
    !processIsActive &&
    !cacheClearInFlight.value &&
    !statusLoading.value
  )
})

const { resume: resumePolling } = useIntervalFn(refreshStatus, 5_000, {
  immediate: false,
  immediateCallback: false
})

onMounted(async () => {
  await Promise.all([loadSettings(), refreshStatus()])
  resumePolling()
})

async function loadSettings(): Promise<void> {
  settingsLoading.value = true
  try {
    const values = await settingsClient.getSnapshot([
      'ocrAutoExtractForNonVisionModels',
      'ocrBackend'
    ])
    automaticExtractionEnabled.value = values.ocrAutoExtractForNonVisionModels ?? true
    backend.value = values.ocrBackend ?? 'auto'
    settingsReady.value = true
  } catch {
    showFailure('settings.ocr.loadFailed')
  } finally {
    settingsLoading.value = false
  }
}

async function updateAutomaticExtraction(value: boolean): Promise<void> {
  if (settingInFlight.value) return
  const previous = automaticExtractionEnabled.value
  automaticExtractionEnabled.value = value
  settingInFlight.value = true
  try {
    await settingsClient.update([{ key: 'ocrAutoExtractForNonVisionModels', value }])
  } catch {
    automaticExtractionEnabled.value = previous
    showFailure('settings.ocr.updateFailed')
  } finally {
    settingInFlight.value = false
  }
}

async function updateBackend(value: AcceptableValue): Promise<void> {
  if (settingInFlight.value || (value !== 'auto' && value !== 'cpu')) return
  const previous = backend.value
  backend.value = value
  settingInFlight.value = true
  try {
    await settingsClient.update([{ key: 'ocrBackend', value }])
  } catch {
    backend.value = previous
    showFailure('settings.ocr.updateFailed')
  } finally {
    settingInFlight.value = false
  }
}

async function refreshStatus(): Promise<void> {
  if (statusLoading.value || cacheClearInFlight.value) return
  statusLoading.value = true
  try {
    status.value = await ocrClient.getRuntimeStatus()
    statusErrorNotified.value = false
  } catch {
    if (!status.value && !statusErrorNotified.value) {
      statusErrorNotified.value = true
      showFailure('settings.ocr.statusLoadFailed')
    }
  } finally {
    statusLoading.value = false
  }
}

async function clearCache(): Promise<void> {
  if (!canClearCache.value) return
  cacheClearInFlight.value = true
  try {
    const result = await ocrClient.clearCache()
    if (status.value) status.value = { ...status.value, cache: result.cache }
    clearDialogOpen.value = false
    toast({
      title: t('settings.ocr.cacheCleared'),
      description: t('settings.ocr.cacheClearedDescription')
    })
  } catch {
    showFailure('settings.ocr.clearCacheFailed')
  } finally {
    cacheClearInFlight.value = false
  }
}

function formatEngineStage(stage: 'detection' | 'recognition'): string {
  const value = status.value?.process?.engine?.[stage]
  if (!value) return t('settings.ocr.notStarted')
  const providers = value.providerChain.length > 0 ? value.providerChain.join(' → ') : '—'
  return `${providers} · ${value.precision}`
}

function formatBytes(value: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(amount)} ${units[unit]}`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale.value).format(value)
}

function showFailure(descriptionKey: string): void {
  toast({
    title: t('common.error.operationFailed'),
    description: t(descriptionKey),
    variant: 'destructive'
  })
}
</script>
