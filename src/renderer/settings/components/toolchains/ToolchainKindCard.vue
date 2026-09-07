<template>
  <SettingsSectionCard :title="title" :description="availabilityLabel">
    <div class="space-y-4">
      <div
        v-if="status?.system"
        class="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm"
        data-testid="toolchain-system-detected"
      >
        <div class="font-medium text-emerald-700 dark:text-emerald-300">
          {{ t('settings.toolchains.systemDetected', { path: status.system.path }) }}
        </div>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ t('settings.toolchains.systemDetectedHint') }}
        </p>
      </div>

      <div class="grid gap-2">
        <label class="text-sm font-medium" :for="`toolchain-source-${kind}`">
          {{ t('settings.toolchains.source') }}
        </label>
        <Select
          :model-value="status?.selection.source ?? 'unconfigured'"
          :disabled="busy || installing"
          @update:model-value="onSourceChange"
        >
          <SelectTrigger :id="`toolchain-source-${kind}`" :data-testid="`toolchain-source-${kind}`">
            <span class="truncate">{{ sourceDisplayLabel }}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-if="status?.bundledAvailable || status?.selection.source === 'bundled'"
              value="bundled"
            >
              {{ t('settings.toolchains.sources.bundled') }}
            </SelectItem>
            <SelectItem
              v-if="status?.managedAvailable || status?.selection.source === 'managed'"
              value="managed"
            >
              {{ t('settings.toolchains.sources.managed') }}
            </SelectItem>
            <SelectItem
              v-if="status?.system || status?.selection.source === 'system'"
              value="system"
            >
              {{ t('settings.toolchains.sources.system') }}
            </SelectItem>
            <SelectItem value="custom">{{ t('settings.toolchains.sources.custom') }}</SelectItem>
            <SelectItem value="unconfigured">
              {{ t('settings.toolchains.sources.unconfigured') }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <dl class="grid gap-1 text-sm text-muted-foreground">
        <div v-if="status?.resolvedVersion" class="flex justify-between gap-4">
          <dt>{{ t('settings.toolchains.version') }}</dt>
          <dd class="font-mono text-foreground">{{ status.resolvedVersion }}</dd>
        </div>
        <div v-if="status?.resolvedPath" class="flex justify-between gap-4">
          <dt>{{ t('settings.toolchains.path') }}</dt>
          <dd class="truncate font-mono text-foreground" :title="status.resolvedPath">
            {{ status.resolvedPath }}
          </dd>
        </div>
      </dl>

      <div v-if="installing" class="space-y-2">
        <div class="flex items-center justify-between text-xs text-muted-foreground">
          <span>{{ t('settings.toolchains.installing') }}</span>
          <span v-if="progressLabel">{{ progressLabel }}</span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-muted">
          <div class="h-full bg-foreground transition-[width]" :style="{ width: progressWidth }" />
        </div>
      </div>

      <p
        v-if="kind === 'node' && status?.availability === 'ready' && status.ocrCompatible === false"
        class="text-sm text-muted-foreground"
        data-testid="toolchain-ocr-pin-hint"
      >
        {{ t('settings.toolchains.ocrPinHint') }}
      </p>

      <p v-if="status?.install?.error" class="text-sm text-destructive">
        {{ t(`settings.toolchains.downloadReasons.${status.install.error}`) }}
      </p>

      <div class="flex flex-wrap gap-2">
        <DcButton
          size="sm"
          :disabled="busy || installing"
          :data-testid="`toolchain-install-${kind}`"
          @click="$emit('install', kind)"
        >
          {{ t('settings.toolchains.install') }}
        </DcButton>
        <DcButton
          v-if="status?.selection.source === 'managed'"
          size="sm"
          variant="outline"
          :disabled="busy || installing"
          @click="$emit('repair', kind)"
        >
          {{ t('settings.toolchains.repair') }}
        </DcButton>
        <DcButton
          v-if="status?.bundledAvailable"
          size="sm"
          variant="outline"
          :disabled="busy || installing"
          @click="$emit('revert', kind)"
        >
          {{ t('settings.toolchains.revert') }}
        </DcButton>
        <DcButton v-if="installing" size="sm" variant="ghost" @click="$emit('cancel', kind)">
          {{ t('settings.toolchains.cancelInstall') }}
        </DcButton>
      </div>
    </div>
  </SettingsSectionCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AcceptableValue } from 'reka-ui'
import type { ToolchainKind, ToolchainKindStatus, ToolchainSource } from '@shared/types/toolchains'
import { DcButton } from '@dc-ui/components/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@shadcn/components/ui/select'
import SettingsSectionCard from '../control-center/SettingsSectionCard.vue'

const props = defineProps<{
  kind: ToolchainKind
  status: ToolchainKindStatus | null
  busy: boolean
}>()

const emit = defineEmits<{
  changeSource: [kind: ToolchainKind, source: ToolchainSource]
  install: [kind: ToolchainKind]
  repair: [kind: ToolchainKind]
  revert: [kind: ToolchainKind]
  pickCustom: [kind: ToolchainKind]
  cancel: [kind: ToolchainKind]
}>()

const { t } = useI18n()

const title = computed(() =>
  props.kind === 'node' ? t('settings.toolchains.nodeTitle') : t('settings.toolchains.uvTitle')
)
const availabilityLabel = computed(() => {
  const availability = props.status?.availability ?? 'unconfigured'
  return t(`settings.toolchains.availability.${availability}`)
})
const sourceDisplayLabel = computed(() => {
  const source = props.status?.selection.source ?? 'unconfigured'
  const name = t(`settings.toolchains.sources.${source}`)
  if (props.status?.derived && source !== 'unconfigured') {
    return t('settings.toolchains.sources.autoNamed', { source: name })
  }
  return name
})
const installing = computed(() => {
  const phase = props.status?.install?.phase
  return phase !== undefined && phase !== 'idle'
})
const progressWidth = computed(() => {
  const install = props.status?.install
  if (!install?.totalBytes) return installing.value ? '20%' : '0%'
  return `${Math.min(100, Math.round((install.receivedBytes / install.totalBytes) * 100))}%`
})
const progressLabel = computed(() => {
  const install = props.status?.install
  if (!install?.totalBytes) return null
  return `${formatBytes(install.receivedBytes)} / ${formatBytes(install.totalBytes)}`
})

function onSourceChange(value: AcceptableValue): void {
  if (typeof value !== 'string') return
  emit('changeSource', props.kind, value as ToolchainSource)
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
</script>
