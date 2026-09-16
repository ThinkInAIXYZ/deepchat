<template>
  <div class="w-full">
    <div
      v-if="installFailed"
      data-testid="runtime-install-error"
      class="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive"
    >
      {{ t('settings.pluginsHub.installFailed') }}
      <span v-if="installState?.error" class="block text-xs opacity-80">
        {{ installState.error }}
      </span>
    </div>

    <div
      v-if="installing"
      data-testid="runtime-install-progress"
      class="flex flex-wrap items-center gap-3"
    >
      <span class="text-sm text-muted-foreground">
        {{ t('settings.pluginsHub.installing', { percent: installPercent }) }}
      </span>
      <DcButton
        size="sm"
        variant="outline"
        data-testid="runtime-install-cancel"
        @click="emit('cancel')"
      >
        {{ t('settings.pluginsHub.cancelInstall') }}
      </DcButton>
    </div>

    <div v-else-if="!installed && !ready" class="flex flex-wrap items-center gap-2">
      <DcButton
        v-if="!installFailed"
        size="sm"
        variant="outline"
        data-testid="runtime-install-download"
        :disabled="availability !== 'available' || busy"
        @click="emit('download')"
      >
        <Icon icon="lucide:download" class="mr-2 size-4" />
        {{ t('settings.pluginsHub.installNow') }}
      </DcButton>
      <DcButton
        v-if="installFailed"
        size="sm"
        variant="outline"
        data-testid="runtime-install-retry"
        :disabled="availability !== 'available' || busy"
        @click="emit('download')"
      >
        {{ t('settings.pluginsHub.retryInstall') }}
      </DcButton>
      <DcButton
        size="sm"
        variant="outline"
        data-testid="runtime-install-manual"
        :disabled="busy"
        @click="emit('manual-install')"
      >
        {{ t('settings.pluginsHub.manualInstall') }}
      </DcButton>
    </div>

    <div v-else-if="installed" class="flex flex-wrap items-center gap-2">
      <slot name="installed-info" />
      <DcButton
        size="sm"
        variant="outline"
        class="text-destructive hover:text-destructive"
        data-testid="runtime-install-uninstall"
        :disabled="busy"
        @click="emit('uninstall')"
      >
        <Icon icon="lucide:trash-2" class="mr-2 size-4" />
        {{ t('settings.pluginsHub.uninstall') }}
      </DcButton>
    </div>

    <div v-else-if="ready" data-testid="runtime-install-ready" class="w-full">
      <slot name="installed-info" />
    </div>

    <p
      v-if="!installed && !ready && !installFailed && availabilityLabel"
      class="mt-1 text-xs text-muted-foreground"
    >
      {{ availabilityLabel }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { DcButton } from '@dc-ui/components/button'

const props = defineProps<{
  installState: {
    phase: string
    receivedBytes: number
    totalBytes: number | null
    error: string | null
  } | null
  availability: 'available' | 'incompatible-app' | 'unsupported-platform' | null
  installed: boolean
  /**
   * The runtime is usable without a user-managed copy (bundled with the app
   * or resolved from the development tree). No download or uninstall actions
   * apply in this state.
   */
  ready?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  download: []
  'manual-install': []
  cancel: []
  uninstall: []
}>()

const { t } = useI18n()

const installing = computed(() => {
  const phase = props.installState?.phase
  return (
    phase === 'probing' ||
    phase === 'downloading' ||
    phase === 'verifying' ||
    phase === 'installing'
  )
})
const installFailed = computed(() => props.installState?.phase === 'error')
const installPercent = computed(() => {
  const state = props.installState
  if (!state || !state.totalBytes || state.totalBytes <= 0) return 0
  return Math.min(100, Math.round((state.receivedBytes / state.totalBytes) * 100))
})
const availabilityLabel = computed(() => {
  if (props.availability === 'incompatible-app') {
    return t('settings.pluginsHub.incompatibleApp')
  }
  if (props.availability === 'unsupported-platform') {
    return t('settings.pluginsHub.unavailablePlatform')
  }
  // No catalog entry at all: this build ships no download for the runtime, so
  // installing from a file is the only route.
  if (props.availability === null) {
    return t('settings.pluginsHub.notDistributed')
  }
  return ''
})
</script>
