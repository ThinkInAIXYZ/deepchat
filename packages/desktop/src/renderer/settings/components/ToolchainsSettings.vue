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
const stopListeners = ref<Array<() => void>>([])
let seenChangedVersion = 0
let hydrated = false

onMounted(async () => {
  stopListeners.value = [
    client.onChanged((payload) => {
      if (payload.version < seenChangedVersion) return
      seenChangedVersion = payload.version
      void refresh({ fromVersion: payload.version })
    }),
    client.onProgress((progress) => {
      const current = snapshot.value
      if (!current) return
      current[progress.kind].install = {
        kind: progress.kind,
        phase: progress.phase,
        receivedBytes: progress.receivedBytes,
        totalBytes: progress.totalBytes,
        error: progress.error
      }
    })
  ]
  await refresh()
  hydrated = true
})

onBeforeUnmount(() => {
  for (const stop of stopListeners.value) stop()
  stopListeners.value = []
})

async function refresh(options?: { fromVersion?: number }): Promise<void> {
  const status = await client.getStatus()
  if (options?.fromVersion != null && options.fromVersion < seenChangedVersion) return
  if (!hydrated && options?.fromVersion == null && seenChangedVersion > 0) return
  snapshot.value = status
}

async function changeSource(
  kind: ToolchainKind,
  source: ToolchainSelection['source']
): Promise<void> {
  if (source === 'custom') {
    await runPickCustom(kind)
    return
  }
  if (source === 'managed') {
    if (snapshot.value?.[kind].managedAvailable) {
      await run(kind, () => client.setSource(kind, { source: 'managed' }))
      return
    }
    await runInstall(kind)
    return
  }
  await run(kind, () => client.setSource(kind, { source }))
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
  const { cancelled } = await client.cancelInstall(kind)
  if (cancelled) {
    await refresh()
  }
}

async function run(kind: ToolchainKind, operation: () => Promise<unknown>): Promise<void> {
  if (busyKind.value) return
  busyKind.value = kind
  try {
    await operation()
    await refresh()
  } catch {
    notifyRenderer({
      kind: 'error',
      code: 'settings.toolchains.operationFailed',
      title: t('common.error.operationFailed')
    })
    await refresh()
  } finally {
    busyKind.value = null
  }
}
</script>
