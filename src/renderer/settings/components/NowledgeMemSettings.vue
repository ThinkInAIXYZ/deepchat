<template>
  <section
    class="space-y-5"
    :aria-label="t('settings.nowledgePlugin.title')"
    data-testid="nowledge-mem-settings"
  >
    <p class="text-sm text-muted-foreground">{{ t('settings.nowledgePlugin.description') }}</p>
    <p v-if="loading" role="status">{{ t('common.loading') }}</p>
    <form v-else class="space-y-4" @submit.prevent="save()">
      <fieldset class="space-y-4" :disabled="busy || !state">
        <div class="space-y-2">
          <Label :for="`${uid}-url`">{{ t('settings.nowledgePlugin.serverUrl') }}</Label>
          <Input
            :id="`${uid}-url`"
            :model-value="draft.baseUrl"
            data-testid="nowledge-mem-base-url-input"
            placeholder="http://127.0.0.1:14242"
            @update:model-value="changeUrl(String($event))"
          />
        </div>
        <div class="space-y-2">
          <Label :for="`${uid}-key`">{{ t('settings.nowledgePlugin.apiKey') }}</Label>
          <Input
            :id="`${uid}-key`"
            v-model="draft.apiKey"
            type="password"
            autocomplete="new-password"
            data-testid="nowledge-mem-api-key-input"
            :placeholder="
              savedConnection?.hasApiKey && !destinationChanged
                ? t('settings.nowledgePlugin.savedKey')
                : t('settings.nowledgePlugin.enterKey')
            "
          />
          <p class="text-xs text-muted-foreground">{{ t('settings.nowledgePlugin.keyHint') }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <DcButton type="submit" :disabled="!canSave" data-testid="nowledge-mem-save-button">{{
            busy ? t('settings.nowledgePlugin.verifying') : t('settings.nowledgePlugin.verifySave')
          }}</DcButton>
          <DcButton v-if="dirty" type="button" variant="ghost" @click="resetDraft">{{
            t('common.cancel')
          }}</DcButton>
        </div>
      </fieldset>
    </form>
    <p v-if="message" role="status" class="text-sm">{{ message }}</p>
    <DcInlineError
      v-if="state?.activationFailed"
      :error="t('settings.nowledgePlugin.activationFailed')"
    />
    <div v-if="error" role="alert" class="space-y-2 text-sm text-destructive">
      <p>{{ error }}</p>
      <DcButton v-if="!state" size="sm" variant="outline" :disabled="busy" @click="load">{{
        t('common.retry')
      }}</DcButton>
    </div>
    <div v-if="!savedConnection && state?.legacy.length" class="space-y-2 border-t pt-4">
      <p class="text-sm">{{ t('settings.nowledgePlugin.legacy') }}</p>
      <div
        v-for="item in state.legacy"
        :key="item.source"
        class="flex items-center justify-between gap-3 text-xs"
      >
        <span class="min-w-0 break-all">{{ item.source }} · {{ item.baseUrl }}</span>
        <DcButton
          size="sm"
          variant="outline"
          :disabled="busy || dirty"
          @click="importLegacy(item)"
          >{{ t('settings.nowledgePlugin.import') }}</DcButton
        >
      </div>
      <p class="text-xs text-muted-foreground">{{ t('settings.nowledgePlugin.legacyHint') }}</p>
    </div>
    <DcButton
      v-if="savedConnection"
      variant="outline"
      :disabled="busy || dirty"
      @click="clearOpen = true"
    >
      {{ t('settings.nowledgePlugin.clearConnections') }}
    </DcButton>
    <DcConfirmDialog
      v-model:open="replaceOpen"
      :title="t('settings.nowledgePlugin.replaceTitle')"
      :danger="false"
      :description="t('settings.nowledgePlugin.replace')"
      :confirm-label="t('settings.nowledgePlugin.verifySave')"
      :busy="busy"
      @confirm="save(true)"
    >
      <p class="break-all text-sm">{{ draft.baseUrl }}</p>
      <DcInlineError v-if="error" :error="error" />
    </DcConfirmDialog>
    <DcConfirmDialog
      v-model:open="clearOpen"
      :title="t('settings.nowledgePlugin.clearConnections')"
      :description="t('settings.nowledgePlugin.clearConfirm')"
      :confirm-label="t('common.confirm')"
      :busy="busy"
      danger
      @confirm="clearConnections"
    >
      <DcInlineError v-if="error" :error="error" />
    </DcConfirmDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { DcConfirmDialog } from '@dc-ui/components/confirm-dialog'
import { DcInlineError } from '@dc-ui/components/inline-error'
import { createNowledgeMemClient } from '@api/NowledgeMemClient'
import type { NowledgeConnectionInput, NowledgePluginState } from '@shared/types/nowledgeMemPlugin'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const uid = useId()
const client = createNowledgeMemClient()
const state = ref<NowledgePluginState | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const message = ref('')
const clearOpen = ref(false)
const replaceOpen = ref(false)
const savedConnection = computed(() => state.value?.connection)
const draft = reactive<NowledgeConnectionInput>({ baseUrl: '', timeout: 30000 })
const baseline = ref('')
const dirty = computed(() => baseline.value !== JSON.stringify(draft))
const destinationChanged = computed(() => {
  const saved = savedConnection.value
  return (
    saved &&
    (draft.baseUrl !== saved.baseUrl ||
      draft.apiBaseUrl !== saved.apiBaseUrl ||
      draft.mcpUrl !== saved.mcpUrl)
  )
})
const canSave = computed(() => Boolean(draft.baseUrl.trim()))

function resetDraft() {
  const saved = savedConnection.value
  Object.keys(draft).forEach((key) => delete (draft as unknown as Record<string, unknown>)[key])
  Object.assign(draft, {
    baseUrl: saved?.baseUrl ?? 'http://127.0.0.1:14242',
    apiBaseUrl: saved?.apiBaseUrl ?? '',
    mcpUrl: saved?.mcpUrl ?? '',
    timeout: saved?.timeout ?? 30000,
    apiKey: '',
    replace: false
  })
  baseline.value = JSON.stringify(draft)
}
function changeUrl(value: string) {
  draft.baseUrl = value
  draft.apiBaseUrl = ''
  draft.mcpUrl = ''
  delete draft.legacySource
  draft.replace = false
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    state.value = await client.getConnections()
    resetDraft()
  } catch {
    error.value = t('settings.nowledgePlugin.loadFailed')
  } finally {
    loading.value = false
  }
}
async function save(confirmed = false) {
  if (busy.value || !canSave.value) return
  if (destinationChanged.value && !confirmed) {
    error.value = ''
    replaceOpen.value = true
    return
  }
  busy.value = true
  error.value = ''
  message.value = ''
  const input = { ...draft, replace: confirmed }
  try {
    state.value = await client.saveConnection(input)
    replaceOpen.value = false
    resetDraft()
    message.value = state.value.activationFailed ? '' : t('settings.nowledgePlugin.verified')
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('settings.nowledgePlugin.saveFailed')
  } finally {
    busy.value = false
  }
}
async function clearConnections() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    state.value = await client.clearConnections()
    resetDraft()
    message.value = ''
    clearOpen.value = false
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('settings.nowledgePlugin.saveFailed')
  } finally {
    busy.value = false
  }
}
function importLegacy(item: NowledgePluginState['legacy'][number]) {
  resetDraft()
  Object.assign(draft, {
    baseUrl: item.baseUrl,
    apiBaseUrl: item.apiBaseUrl,
    mcpUrl: item.mcpUrl,
    legacySource: item.source
  })
  message.value = t('settings.nowledgePlugin.importReady')
}
const lease = settingsLeaveGuard.register({ id: 'nowledge-mem-plugin', onDiscard: resetDraft })
const stop = watch(
  [busy, dirty],
  ([pending, changed]) => lease.setRisk(pending ? 'busy' : changed ? 'dirty' : 'clean'),
  { immediate: true, flush: 'sync' }
)
onBeforeRouteLeave(() => settingsLeaveGuard.requestLeave())
onMounted(load)
onBeforeUnmount(() => {
  stop()
  lease.release()
  draft.apiKey = ''
})
</script>
