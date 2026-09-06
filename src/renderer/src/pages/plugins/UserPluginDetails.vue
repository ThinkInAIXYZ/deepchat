<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
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
import { usePluginCatalogStore } from '@/stores/pluginCatalog'
import type { PluginListItem, PluginActionResult } from '@shared/types/plugin'
import UserPluginInstallDialog from './UserPluginInstallDialog.vue'

const props = defineProps<{ plugin: PluginListItem }>()
const { t } = useI18n()
const router = useRouter()
const client = createPluginClient()
const catalog = usePluginCatalogStore()
const details = computed(() => props.plugin.userPlugin!)
const updateOpen = ref(false)
const uninstallOpen = ref(false)
const pending = ref(false)
const error = ref('')
const values = ref<Record<string, string>>({})

async function action(work: () => Promise<PluginActionResult>): Promise<void> {
  if (pending.value) return
  pending.value = true
  error.value = ''
  try {
    const result = await work()
    if (!result.ok) throw new Error(result.error ?? t('settings.plugins.actionFailed'))
    if (result.status) catalog.commitPluginMutation(result.status)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    pending.value = false
  }
}

async function refresh(): Promise<void> {
  await action(async () => ({ ok: true, status: await client.getPlugin(props.plugin.id) }))
}

async function uninstall(): Promise<void> {
  const id = props.plugin.id
  await action(async () => {
    const result = await client.uninstallUserPlugin(id)
    if (result.ok) {
      catalog.removePlugin(id)
      uninstallOpen.value = false
      await router.push({ name: 'plugins' })
    }
    return result
  })
}

async function configure(serverName: string, names: string[]): Promise<void> {
  await action(() =>
    client.configureMcp(
      props.plugin.id,
      serverName,
      Object.fromEntries(names.map((name) => [name, values.value[`${serverName}:${name}`] ?? '']))
    )
  )
  values.value = {}
}

async function retry(invocationId: string): Promise<void> {
  await action(async () => {
    await client.retryHook(props.plugin.id, invocationId)
    return { ok: true, status: await client.getPlugin(props.plugin.id) }
  })
}
</script>

<template>
  <div class="space-y-6 text-sm">
    <div class="flex flex-wrap gap-2">
      <DcButton variant="outline" size="sm" :disabled="pending" @click="updateOpen = true">{{
        t('settings.userPlugins.update')
      }}</DcButton>
      <DcButton variant="outline" size="sm" :disabled="pending" @click="refresh">{{
        t('common.browser.reload')
      }}</DcButton>
      <DcButton variant="outline" size="sm" :disabled="pending" @click="uninstallOpen = true">{{
        t('settings.userPlugins.uninstall')
      }}</DcButton>
    </div>
    <p v-if="error" role="alert" class="break-all text-destructive">{{ error }}</p>
    <section class="space-y-2">
      <h2 class="font-semibold">{{ t('settings.userPlugins.source') }}</h2>
      <p class="break-all">
        {{ details.source.kind === 'git' ? details.source.url : details.source.path }}
      </p>
      <p v-if="details.source.kind === 'git'" class="break-all font-mono text-xs">
        {{ details.source.commit }}
      </p>
      <details class="text-xs text-muted-foreground">
        <summary class="cursor-pointer">{{ t('settings.userPlugins.technicalDetails') }}</summary>
        <p class="break-all font-mono">{{ plugin.id }}<br />SHA-256: {{ details.digest }}</p>
      </details>
      <p>{{ details.package.description }}</p>
      <ul v-if="details.package.findings.length" class="list-disc space-y-1 pl-5">
        <li v-for="finding in details.package.findings" :key="finding">{{ finding }}</li>
      </ul>
    </section>
    <section v-if="details.package.skills.length" class="space-y-2 border-t pt-4">
      <h2 class="font-semibold">
        {{ t('routes.plugins-skills') }} ·
        {{
          t(
            details.selection.skills
              ? 'settings.userPlugins.selected'
              : 'settings.userPlugins.notSelected'
          )
        }}
      </h2>
      <p>{{ details.package.skills.map((skill) => skill.name).join(', ') }}</p>
    </section>
    <section v-if="details.package.hooks.length" class="space-y-3 border-t pt-4">
      <h2 class="font-semibold">
        Hooks ·
        {{
          t(
            details.selection.hooks
              ? 'settings.userPlugins.reviewed'
              : 'settings.userPlugins.notSelected'
          )
        }}
      </h2>
      <p v-if="!details.selection.hooks">{{ t('settings.userPlugins.hooksNotEnabled') }}</p>
      <p class="text-muted-foreground">{{ t('settings.userPlugins.sharedData') }}</p>
      <div v-for="hook in details.package.hooks" :key="hook.id">
        <p>{{ hook.event }} {{ hook.matcher }}</p>
        <pre class="mt-1 whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{{
          hook.command + (hook.commandWindows ? `\nWindows: ${hook.commandWindows}` : '')
        }}</pre>
      </div>
      <h3 class="font-medium">{{ t('settings.userPlugins.diagnostics') }}</h3>
      <p v-if="!details.diagnostics.length" class="text-muted-foreground">
        {{ t('settings.userPlugins.noInvocations') }}
      </p>
      <div
        v-for="diagnostic in details.diagnostics"
        :key="diagnostic.invocationId"
        class="flex items-start justify-between gap-3"
      >
        <div class="min-w-0">
          <p>
            {{ diagnostic.event }} · {{ t(`settings.userPlugins.hookStatus.${diagnostic.status}`) }}
          </p>
          <p class="break-all text-xs text-muted-foreground">
            {{ diagnostic.message }} · {{ new Date(diagnostic.at).toLocaleString() }}
          </p>
        </div>
        <DcButton
          v-if="plugin.enabled && ['failed', 'uncertain'].includes(diagnostic.status)"
          variant="outline"
          size="sm"
          :disabled="pending"
          @click="retry(diagnostic.invocationId)"
          >{{ t('settings.userPlugins.retryHook') }}</DcButton
        >
      </div>
    </section>
    <section v-if="details.package.mcpServers.length" class="space-y-3 border-t pt-4">
      <h2 class="font-semibold">
        MCP ·
        {{
          t(
            details.selection.mcp
              ? 'settings.userPlugins.selected'
              : 'settings.userPlugins.notSelected'
          )
        }}
      </h2>
      <p>{{ t('settings.userPlugins.mcpSetupDescription') }}</p>
      <div v-for="server in details.package.mcpServers" :key="server.name" class="space-y-2">
        <h3 class="font-medium">{{ server.name }} · {{ server.type }}</h3>
        <pre class="whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{{
          server.url ?? [server.command, ...(server.args ?? [])].join(' ')
        }}</pre>
        <form
          v-if="details.setup[`${plugin.id}.${server.name}`]?.length"
          class="space-y-2"
          @submit.prevent="
            configure(`${plugin.id}.${server.name}`, details.setup[`${plugin.id}.${server.name}`])
          "
        >
          <label
            v-for="name in details.setup[`${plugin.id}.${server.name}`]"
            :key="name"
            class="block space-y-1"
          >
            <span>{{ name }}</span>
            <Input
              v-model="values[`${plugin.id}.${server.name}:${name}`]"
              type="password"
              autocomplete="off"
              required
              :disabled="pending || !plugin.enabled"
            />
          </label>
          <DcButton
            type="submit"
            variant="outline"
            size="sm"
            :disabled="pending || !plugin.enabled"
            >{{ t('settings.userPlugins.saveMcp') }}</DcButton
          >
        </form>
      </div>
      <DcButton variant="outline" size="sm" @click="router.push({ name: 'plugins-mcp' })">{{
        t('settings.userPlugins.manageMcp')
      }}</DcButton>
    </section>
    <UserPluginInstallDialog
      v-model:open="updateOpen"
      :kind="details.source.kind"
      :source="details.source"
      :plugin-id="plugin.id"
      @installed="catalog.commitPluginMutation"
    />
    <Dialog
      :open="uninstallOpen"
      @update:open="
        (value) => {
          if (!pending) uninstallOpen = value
        }
      "
    >
      <DialogContent>
        <DialogHeader
          ><DialogTitle>{{ t('settings.userPlugins.uninstall') }} {{ plugin.name }}</DialogTitle
          ><DialogDescription>{{
            t('settings.userPlugins.uninstallDescription')
          }}</DialogDescription></DialogHeader
        >
        <DialogFooter
          ><DcButton variant="outline" :disabled="pending" @click="uninstallOpen = false">{{
            t('common.cancel')
          }}</DcButton
          ><DcButton :disabled="pending" @click="uninstall">{{
            t('settings.userPlugins.uninstall')
          }}</DcButton></DialogFooter
        >
      </DialogContent>
    </Dialog>
  </div>
</template>
