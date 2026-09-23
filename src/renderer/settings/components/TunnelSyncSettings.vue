<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import QRCode from 'qrcode'
import { useTunnelSyncStore } from '../stores/tunnelSync'
import { createToolchainClient } from '@api/ToolchainClient'
import { createDeviceClient } from '@api/DeviceClient'
import { createBrowserClient } from '@api/BrowserClient'
import type { ToolchainKindStatus } from '@shared/types/toolchains'
import type { SyncTunnelConfig } from '@shared/contracts/routes/syncHost.routes'
import { Switch } from '@shadcn/components/ui/switch'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'
import { DcButton } from '@dc-ui/components/button'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'

const { t } = useI18n()
const router = useRouter()
const store = useTunnelSyncStore()
const { host, peer, devices, busy, error, transferring } = storeToRefs(store)
const tools = createToolchainClient()
const deviceClient = createDeviceClient()
const browser = createBrowserClient()
const toolchain = ref<ToolchainKindStatus | null>(null)
const port = ref('48632')
const mode = ref<SyncTunnelConfig['mode']>('quick')
const publicUrl = ref('')
const token = ref('')
const enableDialog = ref(false)
const overwriteDialog = ref(false)
const connectForm = ref(false)
const pairingInput = ref('')
const deviceName = ref('')
const renameId = ref<string | null>(null)
const renameName = ref('')
const qr = ref('')
const copied = ref(false)
const now = ref(Date.now())
const running = computed(() => Boolean(host.value?.status.enabled))
const tunnel = computed(() => host.value?.status.tunnel)
const connectionUrl = computed(() => tunnel.value?.publicUrl ?? '')
const canShareConnection = computed(
  () =>
    running.value &&
    connectionUrl.value &&
    ['connected', 'external'].includes(tunnel.value?.phase ?? '')
)
const activePairing = computed(() => {
  const pairing = host.value?.pairing
  return pairing && pairing.expiresAt > now.value ? pairing : null
})
watch(
  () => activePairing.value?.code,
  () => {
    qr.value = ''
    copied.value = false
  }
)
let hydrated = false
watch(
  () => host.value?.status,
  (status) => {
    if (!status || hydrated) return
    hydrated = true
    if (status.configuredPort) port.value = String(status.configuredPort)
    if (status.configuredPort || status.enabled) {
      mode.value = status.tunnelConfig.mode
      publicUrl.value = status.tunnelConfig.publicUrl
    }
  },
  { immediate: true }
)
let stopTools: (() => void) | undefined
let stopSync: (() => void) | undefined
async function refreshTools() {
  toolchain.value = (await tools.getStatus().catch(() => null))?.cloudflared ?? null
}
onMounted(() => {
  void store.refresh()
  void refreshTools()
  stopSync = store.client.onChanged(() => void store.refresh())
  stopTools = tools.onChanged(() => void refreshTools())
})
onBeforeUnmount(() => {
  stopTools?.()
  stopSync?.()
})
useIntervalFn(() => {
  now.value = Date.now()
  if (transferring.value || tunnel.value?.phase === 'starting') void store.refresh()
}, 2000)
const progressText = computed(() => {
  const bytes = (value: number) => (value / 1024 ** 2).toFixed(1)
  return `${bytes(peer.value?.received ?? 0)} / ${bytes(peer.value?.total ?? 0)} MiB`
})
const guideUrl = 'https://developers.cloudflare.com/tunnel/get-started/'
const serviceUrl = computed(() => `http://127.0.0.1:${port.value}`)
function startRename(device: { deviceId: string; name: string }) {
  renameId.value = device.deviceId
  renameName.value = device.name
}
async function enable() {
  if (
    await store.run(() =>
      store.client.setEnabled(
        true,
        Number(port.value),
        true,
        {
          mode: mode.value,
          publicUrl: mode.value === 'quick' ? '' : publicUrl.value.trim(),
          token: mode.value === 'named' ? token.value.trim() || undefined : undefined
        },
        true
      )
    )
  ) {
    enableDialog.value = false
    token.value = ''
  }
}
async function connection(qrcode = false) {
  const pairing = activePairing.value
  if (!pairing || !canShareConnection.value) return
  const payload = JSON.stringify({ hostUrl: connectionUrl.value, ...pairing })
  if (qrcode) qr.value = await QRCode.toDataURL(payload, { width: 160, margin: 2 })
  else {
    deviceClient.copyText(payload)
    copied.value = true
  }
}
async function createConnection() {
  if (!canShareConnection.value) return
  await store.run(async () => {
    if (!(await store.client.createCode()).pairing)
      throw new Error('sync.tunnel.error.connectionFailed')
  })
}
async function pair() {
  await store.run(async () => {
    let input: { hostUrl: string; hostId: string; code: string }
    try {
      input = JSON.parse(pairingInput.value)
    } catch {
      throw new Error('sync.tunnel.error.invalidPairing')
    }
    if (
      !input ||
      typeof input.hostUrl !== 'string' ||
      typeof input.hostId !== 'string' ||
      typeof input.code !== 'string'
    )
      throw new Error('sync.tunnel.error.invalidPairing')
    await store.client.pair({ ...input, deviceName: deviceName.value, bidirectional: true })
    pairingInput.value = ''
  })
}
async function overwrite() {
  if (await store.run(() => store.client.pull('overwrite', true))) overwriteDialog.value = false
}
</script>

<template>
  <section
    class="space-y-4 text-sm"
    :aria-label="t('sync.tunnel.title')"
    data-testid="tunnel-sync-section"
  >
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
      <p class="text-xs text-muted-foreground">
        <span class="font-medium text-foreground">cloudflared</span>
        · {{ t(`settings.toolchains.availability.${toolchain?.availability ?? 'unconfigured'}`) }}
        <template v-if="toolchain?.availability === 'ready'">
          · {{ t(`settings.toolchains.sources.${toolchain.selection.source}`) }}
          {{ toolchain.resolvedVersion }}</template
        >
      </p>
      <DcButton size="sm" variant="ghost" @click="router.push({ name: 'settings-toolchains' })">{{
        t('sync.tunnel.manageToolchain')
      }}</DcButton>
    </div>
    <p v-if="error" role="alert" class="text-xs text-destructive">{{ t(error) }}</p>
    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="font-medium">{{ t('sync.tunnel.host') }}</h3>
          <p class="mt-1 text-xs text-muted-foreground">{{ t('sync.tunnel.shareHelp') }}</p>
        </div>
        <DcButton
          v-if="running"
          size="sm"
          variant="outline"
          :disabled="busy"
          @click="store.run(() => store.client.setEnabled(false))"
          >{{ t('sync.tunnel.disable') }}</DcButton
        >
        <DcButton
          v-else
          size="sm"
          :disabled="busy || !host || (mode !== 'external' && toolchain?.availability !== 'ready')"
          @click="enableDialog = true"
          >{{ t('sync.tunnel.enable') }}</DcButton
        >
      </div>
      <template v-if="!running">
        <p
          v-if="mode !== 'external' && toolchain?.availability !== 'ready'"
          class="text-xs text-muted-foreground"
        >
          {{ t('sync.tunnel.installHelp') }}
        </p>
        <Tabs v-model="mode">
          <TabsList
            :aria-label="t('sync.tunnel.addressMode')"
            class="flex h-auto w-fit max-w-full flex-wrap"
          >
            <TabsTrigger
              v-for="option in ['quick', 'named', 'external'] as const"
              :key="option"
              :value="option"
              :disabled="busy"
              >{{ t(`sync.tunnel.modes.${option}`) }}</TabsTrigger
            >
          </TabsList>
        </Tabs>
        <p v-if="mode === 'quick'" class="text-xs leading-relaxed text-muted-foreground">
          {{ t('sync.tunnel.quickHelp') }}
        </p>
        <template v-else>
          <ol
            v-if="mode === 'named'"
            class="list-inside list-decimal space-y-1 text-xs leading-relaxed text-muted-foreground"
          >
            <li>
              {{ t('sync.tunnel.domainStepOne') }}
              <a
                :href="guideUrl"
                class="underline underline-offset-2"
                @click.prevent="browser.openExternal(guideUrl)"
                >{{ t('sync.tunnel.guide') }}</a
              >
            </li>
            <li>
              {{ t('sync.tunnel.domainStepTwo') }}
              <code class="select-all break-all text-foreground">{{ serviceUrl }}</code>
            </li>
            <li>{{ t('sync.tunnel.domainStepThree') }}</li>
          </ol>
          <p v-else class="text-xs text-muted-foreground">
            {{ t('sync.tunnel.externalHelp') }}
            <code class="select-all break-all text-foreground">{{ serviceUrl }}</code>
          </p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1" :class="mode === 'external' ? 'sm:col-span-2' : ''">
              <Label for="tunnel-url" class="text-xs">{{ t('sync.tunnel.publicUrl') }}</Label>
              <Input
                id="tunnel-url"
                v-model="publicUrl"
                :disabled="busy"
                placeholder="https://sync.example.com"
                class="h-8!"
              />
            </div>
            <div v-if="mode === 'named'" class="space-y-1">
              <Label for="tunnel-token" class="text-xs">{{ t('sync.tunnel.tunnelToken') }}</Label>
              <Input
                id="tunnel-token"
                v-model="token"
                type="password"
                autocomplete="off"
                :disabled="busy"
                :placeholder="host?.status.hasTunnelToken ? t('sync.tunnel.tokenSaved') : ''"
                class="h-8!"
              />
            </div>
          </div>
        </template>
        <details class="text-xs">
          <summary class="w-fit cursor-pointer text-muted-foreground">
            {{ t('sync.tunnel.advanced') }}
          </summary>
          <div class="mt-2 flex items-center gap-3">
            <Label for="tunnel-port" class="text-xs">{{ t('sync.tunnel.port') }}</Label>
            <Input
              id="tunnel-port"
              v-model="port"
              type="number"
              min="1"
              max="65535"
              :disabled="busy"
              class="h-8! w-28"
            />
          </div>
        </details>
      </template>
      <template v-else>
        <div class="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
          <span class="text-xs text-muted-foreground">{{
            t(`sync.tunnel.connector.${tunnel?.phase ?? 'stopped'}`)
          }}</span>
          <code v-if="connectionUrl && canShareConnection" class="select-all break-all text-xs">{{
            connectionUrl
          }}</code>
        </div>
        <p v-if="mode === 'quick'" class="text-xs text-muted-foreground">
          {{ t('sync.tunnel.quickWarning') }}
        </p>
        <p v-if="tunnel?.error" role="alert" class="text-xs text-destructive">
          {{ t(tunnel.error) }}
        </p>
        <div class="space-y-2 border-t border-border pt-3">
          <h4 class="font-medium">{{ t('sync.tunnel.sharePairingTitle') }}</h4>
          <p class="text-xs text-muted-foreground">
            {{ t(canShareConnection ? 'sync.tunnel.connectionHelp' : 'sync.tunnel.waitForTunnel') }}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <DcButton
              size="sm"
              variant="outline"
              :disabled="busy || !canShareConnection"
              @click="createConnection"
              >{{
                t(activePairing ? 'sync.tunnel.newConnection' : 'sync.tunnel.createConnection')
              }}</DcButton
            >
            <span
              v-if="activePairing && canShareConnection"
              class="text-xs text-muted-foreground"
              >{{
                t('sync.tunnel.expires', {
                  time: new Date(activePairing.expiresAt).toLocaleTimeString()
                })
              }}</span
            >
          </div>
          <div
            v-if="activePairing && canShareConnection"
            class="max-w-xl space-y-2 rounded-md bg-muted/40 p-3"
          >
            <p class="text-xs text-muted-foreground">{{ t('sync.tunnel.pairingCode') }}</p>
            <code class="select-all text-base font-semibold tracking-wider">{{
              activePairing.code
            }}</code>
            <p class="text-xs text-muted-foreground">{{ t('sync.tunnel.publicUrl') }}</p>
            <code class="select-all break-all text-xs">{{ connectionUrl }}</code>
            <div class="flex flex-wrap gap-2">
              <DcButton size="sm" variant="outline" :disabled="busy" @click="connection()">{{
                t(copied ? 'sync.tunnel.copied' : 'sync.tunnel.copyConnection')
              }}</DcButton>
              <DcButton size="sm" variant="ghost" :disabled="busy" @click="connection(true)">{{
                t('sync.tunnel.qrCode')
              }}</DcButton>
            </div>
            <img v-if="qr" :src="qr" :alt="t('sync.tunnel.qrCode')" width="160" height="160" />
          </div>
        </div>
        <details v-if="devices.length" class="text-xs">
          <summary class="w-fit cursor-pointer text-muted-foreground">
            {{ t('sync.tunnel.devices') }} ({{ devices.filter((d) => !d.revoked).length }})
          </summary>
          <div
            v-for="device in devices"
            :key="device.deviceId"
            class="mt-2 flex flex-wrap items-center gap-2"
          >
            <template v-if="renameId === device.deviceId">
              <Input
                v-model="renameName"
                :aria-label="t('sync.tunnel.deviceName')"
                maxlength="120"
                class="h-8! min-w-0 flex-1"
              />
              <DcButton
                size="sm"
                variant="outline"
                :disabled="busy || !renameName.trim()"
                @click="
                  store.run(async () => {
                    await store.client.rename(device.deviceId, renameName)
                    renameId = null
                  })
                "
                >{{ t('common.save') }}</DcButton
              >
              <DcButton size="sm" variant="ghost" @click="renameId = null">{{
                t('common.cancel')
              }}</DcButton>
            </template>
            <template v-else>
              <span class="min-w-0 flex-1 break-all"
                >{{ device.name }}
                <span v-if="device.revoked" class="text-muted-foreground"
                  >· {{ t('sync.tunnel.revoked') }}</span
                ></span
              >
              <DcButton size="sm" variant="ghost" :disabled="busy" @click="startRename(device)">{{
                t('sync.tunnel.rename')
              }}</DcButton>
              <DcButton
                v-if="!device.revoked"
                size="sm"
                variant="ghost"
                :disabled="busy"
                @click="store.run(() => store.client.revoke(device.deviceId))"
                >{{ t('sync.tunnel.revoke') }}</DcButton
              >
            </template>
          </div>
        </details>
      </template>
    </div>
    <div class="space-y-3 border-t border-border pt-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="font-medium">{{ t('sync.tunnel.peer') }}</h3>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ peer?.paired ? peer.hostUrl : t('sync.tunnel.receiveHelp') }}
          </p>
        </div>
        <DcButton
          v-if="!peer?.paired"
          size="sm"
          variant="outline"
          :disabled="busy || transferring"
          @click="connectForm = !connectForm"
          >{{ t('sync.tunnel.pair') }}</DcButton
        >
        <DcButton
          v-else
          size="sm"
          :disabled="busy || transferring"
          @click="
            store.run(() =>
              peer?.automatic?.enabled ? store.client.syncNow() : store.client.pull('increment')
            )
          "
          >{{ t('sync.tunnel.pull') }}</DcButton
        >
      </div>
      <div v-if="!peer?.paired && connectForm" class="space-y-3">
        <p class="text-xs text-muted-foreground">{{ t('sync.tunnel.automaticConsent') }}</p>
        <div class="space-y-1">
          <Label for="tunnel-pairing-input" class="text-xs">{{
            t('sync.tunnel.pairingPayload')
          }}</Label>
          <textarea
            id="tunnel-pairing-input"
            v-model="pairingInput"
            rows="2"
            :disabled="busy || transferring"
            class="w-full rounded-md border border-input bg-background p-2 text-xs"
          />
        </div>
        <div class="flex flex-wrap items-end gap-2">
          <div class="min-w-0 flex-1 space-y-1">
            <Label for="tunnel-device-name" class="text-xs">{{
              t('sync.tunnel.deviceName')
            }}</Label>
            <Input
              id="tunnel-device-name"
              v-model="deviceName"
              maxlength="120"
              :disabled="busy || transferring"
              class="h-8!"
            />
          </div>
          <DcButton
            size="sm"
            :disabled="busy || transferring || !pairingInput.trim() || !deviceName.trim()"
            @click="pair"
            >{{ t('sync.tunnel.confirmConnect') }}</DcButton
          >
        </div>
      </div>
      <template v-if="peer?.paired">
        <div class="flex items-center justify-between gap-3">
          <div class="space-y-1">
            <Label for="tunnel-automatic">{{ t('sync.tunnel.automatic') }}</Label>
            <p class="text-xs text-muted-foreground">{{ t('sync.tunnel.automaticHelp') }}</p>
          </div>
          <Switch
            id="tunnel-automatic"
            :model-value="peer.automatic?.enabled ?? false"
            :disabled="busy || transferring"
            @update:model-value="(enabled) => store.run(() => store.client.setAutomatic(enabled))"
          />
        </div>
        <p v-if="peer.automatic?.enabled" role="status" class="text-xs text-muted-foreground">
          {{ t(`sync.tunnel.automaticPhase.${peer.automatic.phase}`) }}
          <span v-if="peer.automatic.lastSuccessAt">
            ·
            {{
              t('sync.tunnel.lastSuccess', {
                time: new Date(peer.automatic.lastSuccessAt).toLocaleString()
              })
            }}</span
          >
        </p>
        <p v-if="peer.automatic?.error" role="alert" class="text-xs text-destructive">
          {{ t(peer.automatic.error) }}
        </p>
        <div
          role="status"
          aria-live="polite"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
        >
          <span>{{ t(`sync.tunnel.phase.${peer.phase}`) }}</span>
          <span v-if="peer.lastSuccessAt">{{
            t('sync.tunnel.lastSuccess', { time: new Date(peer.lastSuccessAt).toLocaleString() })
          }}</span>
          <DcButton
            v-if="transferring"
            size="sm"
            variant="ghost"
            :disabled="peer.phase === 'importing'"
            @click="store.run(() => store.client.cancel())"
            >{{ t('common.cancel') }}</DcButton
          >
        </div>
        <div v-if="transferring && peer.total" class="space-y-1 text-xs text-muted-foreground">
          <progress
            :value="peer.received"
            :max="peer.total"
            :aria-label="t('sync.tunnel.pull')"
            class="h-1.5 w-full"
          />
          <p>{{ progressText }}</p>
        </div>
        <p v-if="peer.error" role="alert" class="text-xs text-destructive">{{ t(peer.error) }}</p>
        <p v-if="!peer.automatic?.enabled" class="text-xs leading-relaxed text-muted-foreground">
          {{ t('sync.tunnel.incrementHelp') }}
        </p>
        <details class="text-xs">
          <summary class="w-fit cursor-pointer text-muted-foreground">
            {{ t('sync.tunnel.moreOptions') }}
          </summary>
          <p class="my-2 text-muted-foreground">{{ t('sync.tunnel.encryptionHelp') }}</p>
          <div class="flex flex-wrap gap-2">
            <DcButton
              size="sm"
              variant="outline"
              :disabled="busy || transferring"
              @click="overwriteDialog = true"
              v-if="!peer.automatic?.enabled"
              >{{ t('sync.tunnel.overwrite') }}</DcButton
            >
            <DcButton
              size="sm"
              variant="ghost"
              :disabled="busy || transferring"
              @click="store.run(() => store.client.forget())"
              >{{ t('sync.tunnel.forget') }}</DcButton
            >
          </div>
        </details>
      </template>
    </div>
    <DcConfirmDialog
      v-model:open="enableDialog"
      :title="t('sync.tunnel.enable')"
      :description="t('sync.tunnel.consent')"
      :busy="busy"
      :danger="false"
      @confirm="enable"
    />
    <DcConfirmDialog
      v-model:open="overwriteDialog"
      :title="t('sync.tunnel.overwrite')"
      :description="t('sync.tunnel.overwriteWarning')"
      :busy="busy"
      @confirm="overwrite"
    />
  </section>
</template>
