<template>
  <div
    v-if="missing.length > 0"
    role="status"
    data-testid="toolchain-missing-banner"
    class="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2 text-sm"
  >
    <div class="min-w-0">
      <div class="font-medium">{{ t('settings.toolchains.bannerTitle') }}</div>
      <p class="truncate text-muted-foreground">
        {{ t('settings.toolchains.bannerDescription') }}
      </p>
    </div>
    <DcButton size="sm" variant="outline" data-testid="toolchain-banner-open" @click="openSettings">
      {{ t('settings.toolchains.bannerAction') }}
    </DcButton>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createSettingsClient } from '@api/SettingsClient'
import { createToolchainClient } from '@api/ToolchainClient'
import { DcButton } from '@dc-ui/components/button'
import type { ToolchainKind } from '@shared/types/toolchains'

const { t } = useI18n()
const toolchainClient = createToolchainClient()
const settingsClient = createSettingsClient()
const missing = ref<Array<{ kind: ToolchainKind; reason: string }>>([])
let stopMissing: (() => void) | null = null
let seenMissingVersion = 0

onMounted(async () => {
  stopMissing = toolchainClient.onMissing((payload) => {
    if (payload.version < seenMissingVersion) return
    seenMissingVersion = payload.version
    missing.value = payload.missing
  })
  const status = await toolchainClient.getStatus().catch(() => null)
  if (seenMissingVersion > 0) return
  missing.value = status?.missing ?? []
})

onBeforeUnmount(() => {
  stopMissing?.()
})

async function openSettings(): Promise<void> {
  await settingsClient.openSettings({ routeName: 'settings-toolchains' })
}
</script>
