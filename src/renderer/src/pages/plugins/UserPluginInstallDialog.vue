<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { Input } from '@shadcn/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { createPluginClient } from '@api/PluginClient'
import { createDeviceClient } from '@api/DeviceClient'
import type { PluginListItem } from '@shared/types/plugin'
import type { PreparedUserPlugin, UserPluginSource } from '@shared/types/userPlugin'

const props = defineProps<{
  kind: 'git' | 'zip' | 'directory'
  pluginId?: string
  source?: UserPluginSource
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ installed: [plugin: PluginListItem] }>()
const { t } = useI18n()
const client = createPluginClient()
const device = createDeviceClient()
const url = ref('')
const gitRef = ref('')
const subdirectory = ref('')
const selectedPath = ref('')
const prepared = ref<PreparedUserPlugin | null>(null)
const selection = ref({ skills: true, hooks: false, mcp: false })
const busy = ref(false)
const installing = ref(false)
const error = ref('')
let generation = 0
let requestId: string | null = null
const hasSelectedCapability = computed(
  () =>
    prepared.value &&
    ((selection.value.skills && prepared.value.package.skills.length) ||
      (selection.value.hooks && prepared.value.package.hooks.length) ||
      (selection.value.mcp && prepared.value.package.mcpServers.length))
)
const title = computed(() =>
  t(props.pluginId ? 'settings.userPlugins.update' : 'settings.userPlugins.install')
)

async function discard(): Promise<void> {
  generation++
  const operation = prepared.value?.operationId ?? requestId
  prepared.value = null
  requestId = null
  if (operation) await client.discardPrepared(operation).catch(() => undefined)
}
watch(open, (value) => {
  if (!value) {
    void discard()
    return
  }
  error.value = ''
  busy.value = false
  url.value = props.source?.kind === 'git' ? props.source.url : ''
  gitRef.value = props.source?.kind === 'git' ? (props.source.ref ?? '') : ''
  subdirectory.value = props.source?.subdirectory ?? ''
  selectedPath.value = ''
  selection.value = { skills: true, hooks: false, mcp: false }
})
onBeforeUnmount(() => {
  void discard()
})

async function selectPath(): Promise<void> {
  const version = generation
  try {
    const result =
      props.kind === 'directory'
        ? await device.selectDirectory()
        : await device.selectFiles({ filters: [{ name: 'ZIP', extensions: ['zip'] }] })
    if (open.value && version === generation && !result.canceled)
      selectedPath.value = result.filePaths[0] ?? ''
  } catch (cause) {
    error.value = String(cause)
  }
}

async function inspect(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  const version = ++generation
  const id = crypto.randomUUID()
  requestId = id
  try {
    const common = subdirectory.value.trim() ? { subdirectory: subdirectory.value.trim() } : {}
    const source: UserPluginSource =
      props.kind === 'git'
        ? {
            kind: 'git',
            url: url.value.trim(),
            ...(gitRef.value.trim() ? { ref: gitRef.value.trim() } : {}),
            ...common
          }
        : { kind: props.kind, path: selectedPath.value, ...common }
    const result = await client.inspectSource(source, id)
    if (version !== generation || !open.value) {
      await client.discardPrepared(result.operationId)
      return
    }
    prepared.value = result
  } catch (cause) {
    if (version === generation) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (version === generation) {
      busy.value = false
      requestId = null
    }
  }
}

async function install(): Promise<void> {
  if (!prepared.value || busy.value) return
  busy.value = true
  installing.value = true
  error.value = ''
  try {
    const result = await client.installUserPlugin({
      operationId: prepared.value.operationId,
      pluginId: props.pluginId,
      selection: { ...selection.value }
    })
    if (!result.ok || !result.status)
      throw new Error(result.error ?? t('settings.plugins.actionFailed'))
    prepared.value = null
    emit('installed', result.status)
    open.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
    installing.value = false
  }
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="
      (value) => {
        if (!installing) open = value
      }
    "
  >
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ t('settings.userPlugins.installDescription') }}</DialogDescription>
      </DialogHeader>
      <form v-if="!prepared" class="space-y-4" @submit.prevent="inspect">
        <template v-if="kind === 'git'">
          <label class="block space-y-2"
            ><span class="text-sm">{{ t('settings.userPlugins.gitUrl') }}</span
            ><Input
              v-model="url"
              type="url"
              required
              :disabled="busy"
              placeholder="https://github.com/owner/plugin.git"
          /></label>
          <label class="block space-y-2"
            ><span class="text-sm">{{ t('settings.userPlugins.gitRef') }}</span
            ><Input v-model="gitRef" :disabled="busy"
          /></label>
        </template>
        <div v-else class="space-y-2">
          <DcButton type="button" variant="outline" :disabled="busy" @click="selectPath">{{
            t(
              kind === 'zip'
                ? 'settings.userPlugins.chooseZip'
                : 'settings.userPlugins.chooseDirectory'
            )
          }}</DcButton>
          <p class="break-all text-sm text-muted-foreground">{{ selectedPath }}</p>
        </div>
        <label class="block space-y-2"
          ><span class="text-sm">{{ t('settings.userPlugins.subdirectory') }}</span
          ><Input v-model="subdirectory" :disabled="busy"
        /></label>
        <DcButton
          type="submit"
          :disabled="busy || (kind !== 'git' && !selectedPath)"
          :loading="busy"
          >{{ t('settings.userPlugins.inspect') }}</DcButton
        >
      </form>
      <div v-else class="space-y-4 text-sm">
        <div>
          <h2 class="font-semibold">
            {{ prepared.package.name }} · {{ prepared.package.version }}
          </h2>
          <p class="text-muted-foreground">{{ prepared.package.description }}</p>
          <p class="mt-2 break-all">
            {{ prepared.source.kind === 'git' ? prepared.source.url : prepared.source.path }}
          </p>
          <p v-if="prepared.source.kind === 'git'" class="break-all font-mono text-xs">
            {{ prepared.source.commit }}
          </p>
          <details class="mt-1 text-xs text-muted-foreground">
            <summary class="cursor-pointer">
              {{ t('settings.userPlugins.technicalDetails') }}
            </summary>
            <p class="break-all font-mono">SHA-256: {{ prepared.digest }}</p>
          </details>
        </div>
        <p>{{ t('settings.userPlugins.executionNotice') }}</p>
        <ul v-if="prepared.package.findings.length" class="list-disc space-y-1 pl-5">
          <li v-for="finding in prepared.package.findings" :key="finding">{{ finding }}</li>
        </ul>
        <label v-if="prepared.package.skills.length" class="flex items-start gap-2">
          <input v-model="selection.skills" type="checkbox" :disabled="busy" class="mt-1" />
          <span
            >{{ t('settings.userPlugins.useSkills') }}:
            {{ prepared.package.skills.map((skill) => skill.name).join(', ') }}</span
          >
        </label>
        <div v-if="prepared.package.hooks.length" class="space-y-2 border-t pt-3">
          <label class="flex items-start gap-2"
            ><input
              v-model="selection.hooks"
              type="checkbox"
              :disabled="busy"
              class="mt-1"
            /><span>{{ t('settings.userPlugins.allowHooks') }}</span></label
          >
          <div v-for="hook in prepared.package.hooks" :key="hook.id" class="space-y-1">
            <p class="font-medium">{{ hook.event }} {{ hook.matcher }} · {{ hook.timeout }}s</p>
            <pre class="whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs"
              >{{ hook.command
              }}{{ hook.commandWindows ? `\nWindows: ${hook.commandWindows}` : '' }}</pre
            >
          </div>
          <p class="text-muted-foreground">{{ t('settings.userPlugins.sharedData') }}</p>
        </div>
        <div v-if="prepared.package.mcpServers.length" class="space-y-2 border-t pt-3">
          <label class="flex items-start gap-2"
            ><input v-model="selection.mcp" type="checkbox" :disabled="busy" class="mt-1" /><span>{{
              t('settings.userPlugins.allowMcp')
            }}</span></label
          >
          <div v-for="server in prepared.package.mcpServers" :key="server.name" class="space-y-1">
            <p class="font-medium">{{ server.name }} · {{ server.type }}</p>
            <pre class="whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs"
              >{{ server.url ?? [server.command, ...(server.args ?? [])].join(' ')
              }}{{ server.cwd ? `\nCWD: ${server.cwd}` : '' }}</pre
            >
            <details v-if="server.env || server.headers" class="text-xs">
              <summary class="cursor-pointer">
                {{ t('settings.userPlugins.technicalDetails') }}
              </summary>
              <pre class="whitespace-pre-wrap break-all">{{
                JSON.stringify({ env: server.env, headers: server.headers }, null, 2)
              }}</pre>
            </details>
            <p v-if="server.requiredVariables.length">
              {{ t('settings.userPlugins.requiredVariables') }}:
              {{ server.requiredVariables.join(', ') }}
            </p>
          </div>
        </div>
      </div>
      <p v-if="error" role="alert" class="break-words text-sm text-destructive">{{ error }}</p>
      <DialogFooter>
        <DcButton variant="outline" :disabled="installing" @click="open = false">{{
          t('common.cancel')
        }}</DcButton>
        <DcButton
          v-if="prepared"
          :loading="busy"
          :disabled="busy || !hasSelectedCapability"
          @click="install"
          >{{
            t(
              pluginId ? 'settings.userPlugins.applyUpdate' : 'settings.userPlugins.installDisabled'
            )
          }}</DcButton
        >
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
