<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import QRCode from 'qrcode'
import { useTunnelSyncStore } from '@/stores/tunnelSync'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { DcButton } from '@dc-ui/components/button'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'

const { t } = useI18n()
const store = useTunnelSyncStore()
const { host, peer, devices, busy, error, transferring } = storeToRefs(store)
const port = ref('48632')
const publicUrl = ref('')
const enableDialog = ref(false)
const overwriteDialog = ref(false)
const pairingInput = ref('')
const deviceName = ref('')
const renameId = ref<string | null>(null)
const renameName = ref('')
const qr = ref('')
const now = ref(Date.now())
const activePairing = computed(() => {
  const pairing = host.value?.pairing
  return pairing && pairing.expiresAt > now.value ? pairing : null
})
const pairingPayload = computed(() => {
  if (!activePairing.value) return ''
  try {
    const url = new URL(publicUrl.value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return ''
    return JSON.stringify({ hostUrl: url.origin, ...activePairing.value })
  } catch {
    return ''
  }
})
let qrRevision = 0
watch(pairingPayload, async (payload) => {
  const revision = ++qrRevision
  qr.value = ''
  if (payload) {
    const image = await QRCode.toDataURL(payload, { width: 180, margin: 2 }).catch(() => '')
    if (revision === qrRevision) qr.value = image
  }
})
watch(
  () => host.value?.status.configuredPort,
  (value) => {
    if (value) port.value = String(value)
  }
)
useIntervalFn(() => {
  now.value = Date.now()
  void store.refresh()
}, 2000)
onMounted(() => {
  void store.refresh()
})
const progressText = computed(() => {
  const bytes = (value: number) => (value / 1024 ** 2).toFixed(1)
  return `${bytes(peer.value?.received ?? 0)} / ${bytes(peer.value?.total ?? 0)} MiB`
})
function startRename(device: { deviceId: string; name: string }) {
  renameId.value = device.deviceId
  renameName.value = device.name
}
async function enable() {
  if (await store.run(() => store.client.setEnabled(true, Number(port.value), true)))
    enableDialog.value = false
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
    ) {
      throw new Error('sync.tunnel.error.invalidPairing')
    }
    await store.client.pair({ ...input, deviceName: deviceName.value })
    pairingInput.value = ''
  })
}
async function overwrite() {
  if (await store.run(() => store.client.pull('overwrite', true))) overwriteDialog.value = false
}
</script>

<template>
  <section
    class="rounded-xl border border-border bg-card/30 p-4"
    aria-labelledby="tunnel-sync-title"
    data-testid="tunnel-sync-section"
  >
    <h2 id="tunnel-sync-title" class="text-sm font-medium">{{ t('sync.tunnel.title') }}</h2>
    <p class="mt-2 text-sm text-muted-foreground">{{ t('sync.tunnel.description') }}</p>
    <p v-if="error" role="alert" class="mt-3 text-sm text-destructive">{{ t(error) }}</p>
    <div class="mt-5 space-y-4">
      <h3 class="text-sm font-medium">{{ t('sync.tunnel.host') }}</h3>
      <div class="flex flex-wrap items-end gap-3">
        <div class="space-y-2">
          <Label for="tunnel-port">{{ t('sync.tunnel.port') }}</Label>
          <Input
            id="tunnel-port"
            v-model="port"
            type="number"
            min="1"
            max="65535"
            class="w-32"
            :disabled="busy || host?.status.enabled"
          />
        </div>
        <DcButton
          v-if="!host?.status.enabled"
          variant="outline"
          :disabled="
            busy ||
            !host ||
            !Number.isInteger(Number(port)) ||
            Number(port) < 1 ||
            Number(port) > 65535
          "
          @click="enableDialog = true"
          >{{ t('sync.tunnel.enable') }}</DcButton
        >
        <DcButton
          v-else
          variant="outline"
          :disabled="busy"
          @click="store.run(() => store.client.setEnabled(false))"
          >{{ t('sync.tunnel.disable') }}</DcButton
        >
        <span class="text-sm text-muted-foreground" role="status">{{
          t(host?.status.running ? 'sync.tunnel.running' : 'sync.tunnel.stopped')
        }}</span>
      </div>
      <template v-if="host?.status.running">
        <p class="text-sm text-muted-foreground">{{ t('sync.tunnel.ingress') }}</p>
        <code class="block select-text break-all rounded bg-muted p-2 text-xs"
          >service: http://127.0.0.1:{{ host.status.port }}</code
        >
        <details class="text-sm">
          <summary class="cursor-pointer">{{ t('sync.tunnel.quickTunnel') }}</summary>
          <code class="mt-2 block select-text break-all rounded bg-muted p-2 text-xs"
            >cloudflared tunnel --protocol http2 --url http://127.0.0.1:{{ host.status.port }}</code
          >
          <p class="mt-2 text-muted-foreground">{{ t('sync.tunnel.quickWarning') }}</p>
        </details>
        <div class="flex flex-wrap items-center gap-3">
          <DcButton
            variant="outline"
            :disabled="busy || transferring"
            @click="store.run(() => store.client.publish())"
            >{{ t('sync.tunnel.publish') }}</DcButton
          >
          <span class="text-sm text-muted-foreground">{{
            host.status.publishedAt
              ? t('sync.tunnel.publishedAt', {
                  time: new Date(host.status.publishedAt).toLocaleString()
                })
              : t('sync.tunnel.noSnapshot')
          }}</span>
        </div>
        <p class="text-sm text-muted-foreground">{{ t('sync.tunnel.publishHelp') }}</p>
        <div class="space-y-2">
          <Label for="tunnel-public-url">{{ t('sync.tunnel.publicUrl') }}</Label>
          <Input
            id="tunnel-public-url"
            v-model="publicUrl"
            type="url"
            placeholder="https://sync.example.com"
            :disabled="busy"
          />
        </div>
        <DcButton
          variant="outline"
          :disabled="busy"
          @click="store.run(() => store.client.createCode())"
          >{{ t('sync.tunnel.createCode') }}</DcButton
        >
        <div v-if="activePairing" class="space-y-2">
          <p class="text-sm">
            {{
              t('sync.tunnel.codeExpires', {
                code: activePairing.code,
                time: new Date(activePairing.expiresAt).toLocaleTimeString()
              })
            }}
          </p>
          <Label v-if="pairingPayload" for="tunnel-pairing-payload">{{
            t('sync.tunnel.pairingPayload')
          }}</Label>
          <textarea
            v-if="pairingPayload"
            id="tunnel-pairing-payload"
            :value="pairingPayload"
            readonly
            rows="4"
            class="w-full select-text rounded-md border border-input bg-background p-2 text-xs"
          />
          <img
            v-if="qr"
            :src="qr"
            :alt="t('sync.tunnel.pairingPayload')"
            width="180"
            height="180"
          />
        </div>
      </template>
      <div v-if="devices.length" class="space-y-2">
        <h4 class="text-sm font-medium">{{ t('sync.tunnel.devices') }}</h4>
        <div
          v-for="device in devices"
          :key="device.deviceId"
          class="flex flex-wrap items-center gap-2 border-t border-border py-2"
        >
          <template v-if="renameId === device.deviceId">
            <Input
              v-model="renameName"
              :aria-label="t('sync.tunnel.deviceName')"
              maxlength="120"
              class="w-48"
            />
            <DcButton
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
            <DcButton variant="ghost" @click="renameId = null">{{ t('common.cancel') }}</DcButton>
          </template>
          <template v-else>
            <span class="min-w-0 flex-1 break-all text-sm"
              >{{ device.name
              }}<span class="block text-xs text-muted-foreground">{{
                device.revoked
                  ? t('sync.tunnel.revoked')
                  : device.lastSeenAt
                    ? t('sync.tunnel.lastSeen', {
                        time: new Date(device.lastSeenAt).toLocaleString()
                      })
                    : t('sync.tunnel.neverSeen')
              }}</span></span
            >
            <DcButton variant="ghost" :disabled="busy" @click="startRename(device)">{{
              t('sync.tunnel.rename')
            }}</DcButton>
            <DcButton
              v-if="!device.revoked"
              variant="outline"
              :disabled="busy"
              @click="store.run(() => store.client.revoke(device.deviceId))"
              >{{ t('sync.tunnel.revoke') }}</DcButton
            >
          </template>
        </div>
      </div>
    </div>
    <div class="mt-6 space-y-4 border-t border-border pt-5">
      <h3 class="text-sm font-medium">{{ t('sync.tunnel.peer') }}</h3>
      <template v-if="!peer?.paired">
        <div class="space-y-2">
          <Label for="tunnel-pairing-input">{{ t('sync.tunnel.pairingPayload') }}</Label>
          <textarea
            id="tunnel-pairing-input"
            v-model="pairingInput"
            rows="4"
            :disabled="busy || transferring"
            class="w-full rounded-md border border-input bg-background p-2 text-xs"
          />
        </div>
        <div class="space-y-2">
          <Label for="tunnel-device-name">{{ t('sync.tunnel.deviceName') }}</Label>
          <Input
            id="tunnel-device-name"
            v-model="deviceName"
            maxlength="120"
            :disabled="busy || transferring"
          />
        </div>
        <DcButton
          variant="outline"
          :disabled="busy || transferring || !pairingInput.trim() || !deviceName.trim()"
          @click="pair"
          >{{ t('sync.tunnel.pair') }}</DcButton
        >
      </template>
      <template v-else>
        <p class="break-all text-sm">{{ peer.hostUrl }}</p>
        <p class="text-xs text-muted-foreground">{{ peer.hostId }}</p>
        <p class="text-sm text-muted-foreground">{{ t('sync.tunnel.incrementHelp') }}</p>
        <p class="text-sm text-muted-foreground">{{ t('sync.tunnel.encryptionHelp') }}</p>
        <div class="flex flex-wrap gap-2">
          <DcButton
            variant="outline"
            :disabled="busy || transferring"
            @click="store.run(() => store.client.pull('increment'))"
            >{{ t('sync.tunnel.pull') }}</DcButton
          >
          <DcButton
            variant="outline"
            :disabled="busy || transferring"
            @click="overwriteDialog = true"
            >{{ t('sync.tunnel.overwrite') }}</DcButton
          >
          <DcButton
            variant="ghost"
            :disabled="busy || transferring"
            @click="store.run(() => store.client.forget())"
            >{{ t('sync.tunnel.forget') }}</DcButton
          >
          <DcButton
            v-if="transferring"
            variant="outline"
            :disabled="peer.phase === 'importing'"
            @click="store.run(() => store.client.cancel())"
            >{{ t('common.cancel') }}</DcButton
          >
        </div>
        <div role="status" aria-live="polite" class="space-y-2 text-sm">
          <p>{{ t(`sync.tunnel.phase.${peer.phase}`) }}</p>
          <template v-if="transferring && peer.total">
            <progress
              :value="peer.received"
              :max="peer.total"
              :aria-label="t('sync.tunnel.pull')"
              class="h-2 w-full"
            />
            <p class="text-muted-foreground">{{ progressText }}</p>
          </template>
          <p v-if="peer.lastSuccessAt" class="text-muted-foreground">
            {{
              t('sync.tunnel.lastSuccess', { time: new Date(peer.lastSuccessAt).toLocaleString() })
            }}
          </p>
        </div>
        <p v-if="peer.error" role="alert" class="text-sm text-destructive">{{ t(peer.error) }}</p>
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
