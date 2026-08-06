<template>
  <SettingsPageShell
    :title="t('routes.settings-ocr')"
    :description="t('settings.ocr.description')"
    :eyebrow="t('settings.controlCenter.groups.tools')"
    data-testid="settings-ocr-page"
  >
    <SettingsSectionCard
      :title="t('settings.ocr.autoExtract')"
      :description="t('settings.ocr.autoExtractDescription')"
    >
      <template #actions>
        <Switch
          data-testid="ocr-auto-extract-switch"
          :aria-label="t('settings.ocr.autoExtract')"
          :model-value="automaticExtractionEnabled"
          :disabled="!settingsReady || settingsOperationPending"
          @update:model-value="updateAutomaticExtraction"
        />
      </template>

      <div class="space-y-4">
        <Alert
          v-if="statusStale || (!status && statusHasError)"
          variant="destructive"
          data-testid="ocr-status-stale"
        >
          <Icon icon="lucide:circle-alert" class="size-4" />
          <AlertTitle>{{ t('common.error.operationFailed') }}</AlertTitle>
          <AlertDescription class="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
            <span>{{ t('settings.ocr.statusLoadFailed') }}</span>
            <DcButton
              variant="outline"
              size="sm"
              :disabled="statusLoading"
              data-testid="ocr-retry-status"
              @click="refreshStatus"
            >
              <Spinner v-if="statusLoading" class="mr-2 size-4" />
              <Icon v-else icon="lucide:refresh-cw" class="mr-2 size-4" />
              {{ t('settings.ocr.refresh') }}
            </DcButton>
          </AlertDescription>
        </Alert>

        <Alert v-else-if="status?.availability.status === 'unavailable'" variant="destructive">
          <Icon icon="lucide:circle-alert" class="size-4" />
          <AlertTitle>{{ t('settings.ocr.unavailable') }}</AlertTitle>
          <AlertDescription>{{ availabilityDescription }}</AlertDescription>
        </Alert>

        <div
          v-else-if="!status && statusLoading"
          class="flex items-center text-sm text-muted-foreground"
        >
          <Spinner class="mr-2 size-4" />
          {{ t('settings.ocr.loading') }}
        </div>

        <Collapsible v-model:open="advancedOpen" class="rounded-lg border bg-muted/10">
          <CollapsibleTrigger as-child>
            <DcButton
              variant="ghost"
              class="flex h-auto w-full items-center justify-between rounded-lg p-4"
              data-testid="ocr-advanced-toggle"
            >
              <div class="min-w-0 text-start">
                <div class="text-sm font-medium">{{ t('settings.ocr.advancedTitle') }}</div>
                <p class="mt-1 text-xs font-normal text-muted-foreground">
                  {{ t('settings.ocr.advancedDescription') }}
                </p>
              </div>
              <Icon
                :icon="advancedOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                class="ml-3 size-4 shrink-0 text-muted-foreground"
              />
            </DcButton>
          </CollapsibleTrigger>

          <CollapsibleContent class="border-t">
            <div
              class="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="min-w-0">
                <div class="text-sm font-medium">{{ t('settings.ocr.backend') }}</div>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{ t('settings.ocr.backendDescription') }}
                </p>
              </div>
              <Select
                :model-value="backend"
                :disabled="!settingsReady || settingsOperationPending"
                @update:model-value="updateBackend"
              >
                <SelectTrigger
                  data-testid="ocr-backend-select"
                  class="w-full sm:w-64"
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

            <div
              class="flex flex-col gap-3 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="min-w-0">
                <div class="text-sm font-medium">{{ t('settings.ocr.cacheTitle') }}</div>
                <div
                  v-if="status?.cache"
                  class="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
                >
                  <span>
                    {{ t('settings.ocr.cacheEntries') }}:
                    <bdi>{{ formatNumber(status.cache.entryCount) }}</bdi>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {{ t('settings.ocr.cacheUsage') }}:
                    <bdi>{{ formatBytes(status.cache.logicalBytes) }}</bdi>
                  </span>
                </div>
                <p v-else class="mt-1 text-xs text-muted-foreground">
                  {{ t('settings.ocr.cacheNotStarted') }}
                </p>
                <p
                  v-if="status?.cache?.persistenceUnavailableReason"
                  class="mt-1 text-xs text-amber-600 dark:text-amber-400"
                >
                  {{ cacheModeDescription }}
                </p>
              </div>
              <DcButton
                v-if="status?.cache && status.cache.entryCount > 0"
                variant="outline"
                size="sm"
                data-testid="ocr-clear-cache"
                :disabled="!canClearCache"
                @click="clearDialogOpen = true"
              >
                <Spinner v-if="cacheClearInFlight" class="mr-2 size-4" />
                <Icon v-else icon="lucide:trash-2" class="mr-2 size-4" />
                {{ t('settings.ocr.clearCache') }}
              </DcButton>
            </div>
            <Collapsible v-model:open="diagnosticsOpen" class="border-t">
              <CollapsibleTrigger as-child>
                <DcButton
                  variant="ghost"
                  class="flex h-auto w-full items-center justify-between rounded-none px-4 py-4"
                  data-testid="ocr-diagnostics-toggle"
                >
                  <div class="min-w-0 text-start">
                    <div class="text-sm font-medium">{{ t('settings.ocr.diagnosticsTitle') }}</div>
                    <p class="mt-1 text-xs font-normal text-muted-foreground">
                      {{ t('settings.ocr.diagnosticsDescription') }}
                    </p>
                  </div>
                  <Icon
                    :icon="diagnosticsOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                    class="ml-3 size-4 shrink-0 text-muted-foreground"
                  />
                </DcButton>
              </CollapsibleTrigger>

              <CollapsibleContent class="border-t bg-background/50 px-4 py-4">
                <dl v-if="status" class="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                  <div class="min-w-0">
                    <dt class="text-xs text-muted-foreground">
                      {{ t('settings.ocr.availability') }}
                    </dt>
                    <dd class="mt-1 font-medium">{{ availabilityLabel }}</dd>
                    <p
                      dir="ltr"
                      class="mt-1 truncate text-left font-mono text-xs text-muted-foreground"
                    >
                      {{ status.platform }}/{{ status.arch }}
                    </p>
                  </div>
                  <div class="min-w-0">
                    <dt class="text-xs text-muted-foreground">{{ t('settings.ocr.process') }}</dt>
                    <dd class="mt-1 font-medium">{{ processLabel }}</dd>
                    <p v-if="queuedRequestsLabel" class="mt-1 text-xs text-muted-foreground">
                      {{ queuedRequestsLabel }}
                    </p>
                  </div>
                  <div class="min-w-0">
                    <dt class="text-xs text-muted-foreground">{{ t('settings.ocr.version') }}</dt>
                    <dd class="mt-1 font-medium">{{ status.availability.lightOcrVersion }}</dd>
                    <p
                      dir="ltr"
                      class="mt-1 truncate text-left font-mono text-xs text-muted-foreground"
                    >
                      {{ status.availability.bundleId }}
                    </p>
                  </div>
                  <div v-if="status.cache" class="min-w-0">
                    <dt class="text-xs text-muted-foreground">{{ t('settings.ocr.cacheMode') }}</dt>
                    <dd class="mt-1 font-medium">{{ cacheModeLabel }}</dd>
                    <p class="mt-1 text-xs text-muted-foreground">{{ cacheModeDescription }}</p>
                  </div>
                  <div v-if="status.process" class="min-w-0">
                    <dt class="text-xs text-muted-foreground">
                      {{ t('settings.ocr.nodeVersion') }}
                    </dt>
                    <dd dir="ltr" class="mt-1 truncate text-left font-mono text-xs">
                      {{ nodeVersionLabel }}
                    </dd>
                  </div>
                  <div v-if="status.process?.engine" class="min-w-0">
                    <dt class="text-xs text-muted-foreground">{{ t('settings.ocr.strategy') }}</dt>
                    <dd dir="ltr" class="mt-1 truncate text-left font-mono text-xs">
                      {{ engineStrategyLabel }}
                    </dd>
                  </div>
                  <div v-if="status.process?.engine" class="min-w-0">
                    <dt class="text-xs text-muted-foreground">
                      {{ t('settings.ocr.detectionBackend') }}
                    </dt>
                    <dd dir="ltr" class="mt-1 truncate text-left font-mono text-xs">
                      {{ detectionBackendLabel }}
                    </dd>
                  </div>
                  <div v-if="status.process?.engine" class="min-w-0">
                    <dt class="text-xs text-muted-foreground">
                      {{ t('settings.ocr.recognitionBackend') }}
                    </dt>
                    <dd dir="ltr" class="mt-1 truncate text-left font-mono text-xs">
                      {{ recognitionBackendLabel }}
                    </dd>
                  </div>
                </dl>
                <p v-else class="text-sm text-muted-foreground">
                  {{
                    statusLoading ? t('settings.ocr.loading') : t('settings.ocr.statusUnavailable')
                  }}
                </p>
              </CollapsibleContent>
            </Collapsible>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </SettingsSectionCard>

    <DcConfirmDialog
      :open="clearDialogOpen"
      :title="t('settings.ocr.clearCacheTitle')"
      :description="t('settings.ocr.clearCacheDescription')"
      :confirm-label="t('settings.ocr.clearCacheConfirm')"
      :busy="cacheClearInFlight"
      :disabled-confirm="!canClearCache"
      :confirm-attrs="{ 'data-testid': 'ocr-clear-cache-confirm' }"
      busy-data-testid="ocr-clear-cache-spinner"
      @update:open="handleClearDialogOpenChange"
      @confirm="clearCache"
    >
      <p v-if="cacheClearFailed" role="alert" class="text-sm text-destructive">
        {{ t('settings.ocr.clearCacheFailed') }}
      </p>
    </DcConfirmDialog>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDocumentVisibility, useIntervalFn, useWindowFocus } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import type { AcceptableValue } from 'reka-ui'
import { useI18n } from 'vue-i18n'
import type { OcrRuntimeStatus } from '@shared/contracts/routes/ocr.routes'
import { createOcrClient } from '@api/OcrClient'
import { createSettingsClient } from '@api/SettingsClient'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import { Alert, AlertDescription, AlertTitle } from '@shadcn/components/ui/alert'
import { DcButton } from '@dc-ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@shadcn/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@shadcn/components/ui/select'
import { Spinner } from '@shadcn/components/ui/spinner'
import { Switch } from '@shadcn/components/ui/switch'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import SettingsSectionCard from './control-center/SettingsSectionCard.vue'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'

type OcrBackend = 'auto' | 'cpu'

const { t, locale } = useI18n()
const settingsClient = createSettingsClient()
const ocrClient = createOcrClient()

const automaticExtractionEnabled = ref(true)
const backend = ref<OcrBackend>('auto')
const status = ref<OcrRuntimeStatus | null>(null)
const settingsReady = ref(false)
const settingsOperationPending = ref(false)
const statusLoading = ref(false)
const cacheClearInFlight = ref(false)
const cacheClearFailed = ref(false)
const clearDialogOpen = ref(false)
const advancedOpen = ref(false)
const diagnosticsOpen = ref(false)
const statusHasError = ref(false)
const documentVisibility = useDocumentVisibility()
const windowFocused = useWindowFocus()
const statusStale = computed(() => statusHasError.value && status.value !== null)
const pollingAllowed = computed(() => documentVisibility.value === 'visible' && windowFocused.value)

const availabilityLabel = computed(() =>
  status.value?.availability.status === 'available'
    ? t('settings.ocr.available')
    : t('settings.ocr.unavailable')
)
const availabilityDescription = computed(() => {
  const availability = status.value?.availability
  return availability?.status === 'unavailable'
    ? t(`settings.ocr.unavailableReasons.${availability.reason}`)
    : ''
})
const processLabel = computed(() => {
  const state = status.value?.process?.state
  return state ? t(`settings.ocr.processStates.${state}`) : t('settings.ocr.notStarted')
})
const queuedRequestsLabel = computed(() => {
  const process = status.value?.process
  return process && process.queuedRequests > 0
    ? t('settings.ocr.queuedRequests', { count: process.queuedRequests })
    : null
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
  const cache = status.value?.cache
  const processIsActive =
    process !== null &&
    process !== undefined &&
    (process.queuedRequests > 0 ||
      process.state === 'starting' ||
      process.state === 'busy' ||
      process.state === 'stopping')
  return (
    status.value?.availability.status === 'available' &&
    cache !== null &&
    cache !== undefined &&
    cache.entryCount > 0 &&
    !statusStale.value &&
    !processIsActive &&
    !cacheClearInFlight.value &&
    !statusLoading.value
  )
})

const { pause: pausePolling, resume: resumePolling } = useIntervalFn(pollRuntimeStatus, 5_000, {
  immediate: false,
  immediateCallback: false
})
let mounted = false
let disposed = false

const activatePolling = () => {
  if (!mounted || disposed || !pollingAllowed.value) return
  void refreshStatus()
  resumePolling()
}

onMounted(() => {
  mounted = true
  void loadSettings()
  activatePolling()
})

onBeforeUnmount(() => {
  disposed = true
  pausePolling()
})

watch(pollingAllowed, (allowed) => {
  pausePolling()
  if (allowed) activatePolling()
})

async function loadSettings(): Promise<void> {
  if (settingsOperationPending.value) return

  settingsOperationPending.value = true
  try {
    const values = await settingsClient.getSnapshot([
      'ocrAutoExtractForNonVisionModels',
      'ocrBackend'
    ])
    automaticExtractionEnabled.value = values.ocrAutoExtractForNonVisionModels ?? true
    backend.value = values.ocrBackend ?? 'auto'
    settingsReady.value = true
    notifyRenderer({
      kind: 'success',
      code: 'settings.ocr.loaded',
      title: t('common.saved')
    })
  } catch (error) {
    settingsReady.value = false
    console.error('[OcrSettings] Failed to load settings', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.ocr.loadFailed',
      title: t('settings.ocr.loadFailed')
    })
  } finally {
    settingsOperationPending.value = false
  }
}

async function updateAutomaticExtraction(value: boolean): Promise<void> {
  if (settingsOperationPending.value) return
  settingsOperationPending.value = true
  try {
    const result = await settingsClient.update([{ key: 'ocrAutoExtractForNonVisionModels', value }])
    automaticExtractionEnabled.value = result.values.ocrAutoExtractForNonVisionModels ?? value
    notifyRenderer({
      kind: 'success',
      code: 'settings.ocr.autoExtractUpdated',
      title: t('common.saved')
    })
  } catch (error) {
    console.error('[OcrSettings] Failed to update automatic extraction', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.ocr.updateFailed',
      title: t('settings.ocr.updateFailed')
    })
  } finally {
    settingsOperationPending.value = false
  }
}

async function updateBackend(value: AcceptableValue): Promise<void> {
  if (settingsOperationPending.value || (value !== 'auto' && value !== 'cpu')) return
  settingsOperationPending.value = true
  try {
    const result = await settingsClient.update([{ key: 'ocrBackend', value }])
    backend.value = result.values.ocrBackend ?? value
    notifyRenderer({
      kind: 'success',
      code: 'settings.ocr.backendUpdated',
      title: t('common.saved')
    })
  } catch (error) {
    console.error('[OcrSettings] Failed to update backend', error)
    notifyRenderer({
      kind: 'error',
      code: 'settings.ocr.updateFailed',
      title: t('settings.ocr.updateFailed')
    })
  } finally {
    settingsOperationPending.value = false
  }
}

async function refreshStatus(): Promise<void> {
  if (statusLoading.value || cacheClearInFlight.value) return
  statusLoading.value = true
  try {
    status.value = await ocrClient.getRuntimeStatus()
    statusHasError.value = false
  } catch {
    statusHasError.value = true
  } finally {
    statusLoading.value = false
  }
}

async function pollRuntimeStatus(): Promise<void> {
  if (!pollingAllowed.value) return
  await refreshStatus()
}

async function clearCache(): Promise<void> {
  if (!canClearCache.value) return
  cacheClearFailed.value = false
  cacheClearInFlight.value = true
  try {
    const result = await ocrClient.clearCache()
    if (status.value) status.value = { ...status.value, cache: result.cache }
    clearDialogOpen.value = false
    notifyRenderer({
      kind: 'success',
      code: 'settings.ocr.cacheCleared',
      title: t('settings.ocr.cacheCleared'),
      description: t('settings.ocr.cacheClearedDescription')
    })
  } catch (error) {
    console.error('[OcrSettings] Failed to clear cache', error)
    cacheClearFailed.value = true
  } finally {
    cacheClearInFlight.value = false
  }
}

function handleClearDialogOpenChange(open: boolean): void {
  if (cacheClearInFlight.value) return
  clearDialogOpen.value = open
  if (!open) cacheClearFailed.value = false
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
</script>
