<template>
  <section
    class="space-y-5"
    :aria-label="t('settings.nowledgePlugin.title')"
    data-testid="nowledge-mem-settings"
  >
    <p class="text-sm text-muted-foreground">{{ t('settings.nowledgePlugin.description') }}</p>
    <div class="flex gap-2" :aria-label="t('settings.nowledgePlugin.connection')">
      <DcButton
        v-for="id in profiles"
        :key="id"
        size="sm"
        :variant="profile === id ? 'secondary' : 'ghost'"
        :aria-pressed="profile === id"
        :disabled="busy"
        @click="switchProfile(id)"
      >
        {{ t(`settings.nowledgePlugin.${id}`) }}
      </DcButton>
    </div>
    <p v-if="loading" role="status">{{ t('common.loading') }}</p>
    <form v-else class="space-y-4" @submit.prevent="save">
      <fieldset class="space-y-4" :disabled="busy || !state">
        <div class="space-y-2">
          <Label :for="`${uid}-url`">{{ t('settings.nowledgePlugin.serverUrl') }}</Label>
          <Input
            :id="`${uid}-url`"
            :model-value="draft.baseUrl"
            data-testid="nowledge-mem-base-url-input"
            :placeholder="
              profile === 'local' ? 'http://127.0.0.1:14242' : 'https://mem.example.com'
            "
            @update:model-value="changeUrl(String($event))"
          />
        </div>
        <div class="space-y-2">
          <Label :for="`${uid}-key`">{{ t('settings.knowledgeBase.nowledgeMem.apiKey') }}</Label>
          <Input
            :id="`${uid}-key`"
            v-model="draft.apiKey"
            type="password"
            autocomplete="new-password"
            data-testid="nowledge-mem-api-key-input"
            :placeholder="
              savedConnection?.hasApiKey
                ? t('settings.nowledgePlugin.savedKey')
                : t('settings.nowledgePlugin.enterKey')
            "
          />
          <p class="text-xs text-muted-foreground">{{ t('settings.nowledgePlugin.keyHint') }}</p>
        </div>
        <div v-if="profile === 'remote'" class="space-y-2">
          <Label :for="`${uid}-link`">{{ t('settings.nowledgePlugin.connectLink') }}</Label>
          <Input
            :id="`${uid}-link`"
            v-model="draft.connectLink"
            type="password"
            autocomplete="off"
          />
        </div>
        <details class="space-y-3">
          <summary class="cursor-pointer text-sm">
            {{ t('settings.nowledgePlugin.advanced') }}
          </summary>
          <div class="space-y-2">
            <Label :for="`${uid}-api`">{{ t('settings.nowledgePlugin.apiUrl') }}</Label>
            <Input :id="`${uid}-api`" v-model="draft.apiBaseUrl" :placeholder="draft.baseUrl" />
          </div>
          <div class="space-y-2">
            <Label :for="`${uid}-mcp`">{{ t('settings.nowledgePlugin.mcpUrl') }}</Label>
            <Input
              :id="`${uid}-mcp`"
              v-model="draft.mcpUrl"
              :placeholder="`${draft.apiBaseUrl || draft.baseUrl}/mcp/`"
            />
          </div>
          <div class="space-y-2">
            <Label :for="`${uid}-timeout`">{{ t('settings.nowledgePlugin.timeout') }}</Label>
            <Input
              :id="`${uid}-timeout`"
              v-model="timeoutSeconds"
              type="number"
              min="5"
              max="120"
            />
          </div>
        </details>
        <label v-if="destinationChanged" class="flex items-start gap-2 text-sm">
          <input v-model="draft.replace" type="checkbox" class="mt-1" />
          {{ t('settings.nowledgePlugin.replace') }}
        </label>
        <div class="flex flex-wrap gap-2">
          <DcButton type="submit" :disabled="!canSave" data-testid="nowledge-mem-save-button">{{
            busy ? t('settings.nowledgePlugin.verifying') : t('settings.nowledgePlugin.verifySave')
          }}</DcButton>
          <DcButton
            type="button"
            variant="outline"
            :disabled="!savedConnection || dirty || state?.exportProfile === profile"
            @click="selectExport"
          >
            {{
              state?.exportProfile === profile
                ? t('settings.nowledgePlugin.exportSelected')
                : t('settings.nowledgePlugin.useForExports')
            }}
          </DcButton>
          <DcButton v-if="dirty" type="button" variant="ghost" @click="resetDraft">{{
            t('common.cancel')
          }}</DcButton>
        </div>
      </fieldset>
    </form>
    <p v-if="message" role="status" class="text-sm">{{ message }}</p>
    <div v-if="error" role="alert" class="space-y-2 text-sm text-destructive">
      <p>{{ error }}</p>
      <DcButton v-if="!state" size="sm" variant="outline" :disabled="busy" @click="load">{{
        t('common.retry')
      }}</DcButton>
    </div>
    <dl
      v-if="savedConnection"
      class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs text-muted-foreground"
    >
      <dt>{{ t('settings.nowledgePlugin.apiUrl') }}</dt>
      <dd class="break-all">{{ savedConnection.apiBaseUrl }}</dd>
      <dt>{{ t('settings.nowledgePlugin.mcpUrl') }}</dt>
      <dd class="break-all">{{ savedConnection.mcpUrl }}</dd>
    </dl>
    <div v-if="state?.legacy.length" class="space-y-2 border-t pt-4">
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
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'
import { createNowledgeMemClient } from '@api/NowledgeMemClient'
import type {
  NowledgeConnectionInput,
  NowledgePluginState,
  NowledgeProfileId
} from '@shared/types/nowledgeMemPlugin'
import { settingsLeaveGuard } from '../services/settingsLeaveGuard'

const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const uid = useId()
const client = createNowledgeMemClient()
const profiles = ['local', 'remote'] as const
const profile = ref<NowledgeProfileId>('local')
const state = ref<NowledgePluginState | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const message = ref('')
const savedConnection = computed(() => state.value?.connections[profile.value])
const draft = reactive<NowledgeConnectionInput>({ profile: 'local', baseUrl: '', timeout: 30000 })
const baseline = ref('')
const dirty = computed(() => baseline.value !== JSON.stringify(draft))
const timeoutSeconds = computed({
  get: () => draft.timeout / 1000,
  set: (value: string | number) => {
    draft.timeout = Number(value) * 1000
  }
})
const destinationChanged = computed(() => {
  const saved = savedConnection.value
  return (
    saved &&
    (draft.baseUrl !== saved.baseUrl ||
      draft.apiBaseUrl !== saved.apiBaseUrl ||
      draft.mcpUrl !== saved.mcpUrl)
  )
})
const canSave = computed(
  () =>
    draft.baseUrl.trim() &&
    draft.timeout >= 5000 &&
    draft.timeout <= 120000 &&
    (!destinationChanged.value || draft.replace) &&
    !(draft.apiKey && draft.connectLink)
)

function resetDraft() {
  const saved = savedConnection.value
  Object.keys(draft).forEach((key) => delete (draft as unknown as Record<string, unknown>)[key])
  Object.assign(draft, {
    profile: profile.value,
    baseUrl: saved?.baseUrl ?? (profile.value === 'local' ? 'http://127.0.0.1:14242' : ''),
    apiBaseUrl: saved?.apiBaseUrl ?? '',
    mcpUrl: saved?.mcpUrl ?? '',
    timeout: saved?.timeout ?? 30000,
    apiKey: '',
    connectLink: '',
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
async function switchProfile(id: NowledgeProfileId) {
  if (profile.value === id || busy.value) return
  if (dirty.value && !(await settingsLeaveGuard.requestLeave())) return
  profile.value = id
  error.value = ''
  message.value = ''
  resetDraft()
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
async function save() {
  if (busy.value || !canSave.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  const input = { ...draft }
  // A link may be consumed even when subsequent verification fails.
  draft.connectLink = ''
  try {
    state.value = await client.saveConnection(input)
    resetDraft()
    message.value = t('settings.nowledgePlugin.verified')
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('settings.nowledgePlugin.saveFailed')
  } finally {
    busy.value = false
  }
}
async function selectExport() {
  busy.value = true
  error.value = ''
  try {
    state.value = await client.selectExport(profile.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('settings.nowledgePlugin.saveFailed')
  } finally {
    busy.value = false
  }
}
function importLegacy(item: NowledgePluginState['legacy'][number]) {
  const host = new URL(item.baseUrl).hostname
  profile.value = ['localhost', '127.0.0.1', '[::1]'].includes(host) ? 'local' : 'remote'
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
  draft.connectLink = ''
})
</script>
