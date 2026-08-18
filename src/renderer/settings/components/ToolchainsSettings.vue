<template>
  <SettingsPageShell
    :title="t('routes.settings-toolchains')"
    :description="t('settings.toolchains.description')"
    :eyebrow="t('settings.controlCenter.groups.tools')"
    data-testid="settings-toolchains-page"
  >
    <ToolchainKindCard
      kind="node"
      :status="snapshot?.node ?? null"
      :busy="busyKind === 'node'"
      @change-source="changeSource"
      @install="runInstall"
      @repair="runRepair"
      @revert="runRevert"
      @pick-custom="runPickCustom"
      @cancel="runCancel"
    />
    <ToolchainKindCard
      kind="uv"
      :status="snapshot?.uv ?? null"
      :busy="busyKind === 'uv'"
      @change-source="changeSource"
      @install="runInstall"
      @repair="runRepair"
      @revert="runRevert"
      @pick-custom="runPickCustom"
      @cancel="runCancel"
    />
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  ToolchainKind,
  ToolchainSelection,
  ToolchainStatusSnapshot
} from '@shared/types/toolchains'
import { createToolchainClient } from '@api/ToolchainClient'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import SettingsPageShell from './control-center/SettingsPageShell.vue'
import ToolchainKindCard from './toolchains/ToolchainKindCard.vue'

const { t } = useI18n()
const client = createToolchainClient()
const snapshot = ref<ToolchainStatusSnapshot | null>(null)
const busyKind = ref<ToolchainKind | null>(null)
const stopProgress = ref<(() => void) | null>(null)

onMounted(async () => {
  await refresh()
  stopProgress.value = client.onProgress((progress) => {
    const current = snapshot.value
    if (!current) return
    current[progress.kind].install = {
      kind: progress.kind,
      phase: progress.phase as never,
      receivedBytes: progress.receivedBytes,
      totalBytes: progress.totalBytes,
      error: progress.error as never
    }
  })
})

onBeforeUnmount(() => {
  stopProgress.value?.()
})

async function refresh(): Promise<void> {
  snapshot.value = await client.getStatus()
}

async function changeSource(
  kind: ToolchainKind,
  source: ToolchainSelection['source']
): Promise<void> {
  if (source === 'custom') {
    await runPickCustom(kind)
    return
  }
  const version =
    source === 'managed'
      ? (snapshot.value?.[kind].selection.version ?? snapshot.value?.[kind].resolvedVersion)
      : undefined
  if (source === 'managed' && !version) {
    await runInstall(kind)
    return
  }
  await run(kind, () => client.setSource(kind, { source, ...(version ? { version } : {}) }))
}

async function runInstall(kind: ToolchainKind): Promise<void> {
  await run(kind, () => client.install(kind))
}

async function runRepair(kind: ToolchainKind): Promise<void> {
  await run(kind, () => client.repair(kind))
}

async function runRevert(kind: ToolchainKind): Promise<void> {
  await run(kind, () => client.revert(kind))
}

async function runPickCustom(kind: ToolchainKind): Promise<void> {
  await run(kind, async () => {
    const result = await client.pickCustom(kind)
    return result.state
  })
}

async function runCancel(kind: ToolchainKind): Promise<void> {
  await client.cancelInstall(kind)
}

async function run(kind: ToolchainKind, operation: () => Promise<unknown>): Promise<void> {
  if (busyKind.value) return
  busyKind.value = kind
  try {
    await operation()
    await refresh()
  } catch (error) {
    notifyRenderer({
      kind: 'error',
      code: 'settings.toolchains.operationFailed',
      title: t('common.error.operationFailed')
    })
    void error
    await refresh()
  } finally {
    busyKind.value = null
  }
}
</script>
