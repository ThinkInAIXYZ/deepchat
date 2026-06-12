<template>
  <SettingsPageShell
    :title="t('settings.plugins.title')"
    :description="t('settings.plugins.officialOnly')"
    :eyebrow="t('settings.controlCenter.groups.tools')"
    data-testid="settings-plugins-page"
  >
    <template #actions>
      <Button
        variant="outline"
        size="icon"
        :disabled="loading"
        :aria-label="t('settings.plugins.refresh')"
        :title="t('settings.plugins.refresh')"
        @click="loadPlugins"
      >
        <Icon icon="lucide:refresh-cw" class="w-4 h-4" />
      </Button>
    </template>

    <div
      v-if="errorMessage"
      class="border border-destructive/40 text-destructive rounded-lg px-3 py-2 text-sm"
    >
      {{ errorMessage }}
    </div>

    <div class="space-y-3">
      <div
        v-if="!loading && plugins.length === 0"
        class="border border-dashed border-border rounded-lg p-6 flex flex-col gap-4 bg-background"
      >
        <div class="flex items-start gap-3">
          <Icon icon="lucide:puzzle" class="w-5 h-5 mt-0.5 text-muted-foreground" />
          <div class="min-w-0">
            <h3 class="text-sm font-semibold">{{ t('settings.plugins.emptyTitle') }}</h3>
            <p class="text-sm text-muted-foreground mt-1">
              {{ t('settings.plugins.emptyDescription') }}
            </p>
          </div>
        </div>
      </div>

      <article
        v-for="plugin in plugins"
        :key="plugin.id"
        class="border border-border rounded-lg p-4 flex flex-col gap-4 bg-background"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-semibold truncate">{{ plugin.name }}</h3>
              <span
                class="border border-border rounded px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {{ plugin.version }}
              </span>
            </div>
            <div class="text-xs text-muted-foreground mt-1 truncate">
              {{ plugin.publisher }} · {{ plugin.id }}
            </div>
          </div>
          <span
            class="shrink-0 border rounded px-2 py-1 text-xs"
            :class="
              plugin.enabled
                ? 'border-emerald-500/40 text-emerald-600'
                : 'border-border text-muted-foreground'
            "
          >
            {{
              plugin.enabled
                ? t('settings.plugins.status.enabled')
                : t('settings.plugins.status.disabled')
            }}
          </span>
        </div>

        <dl class="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt class="text-muted-foreground">{{ t('settings.plugins.runtime') }}</dt>
          <dd>{{ formatRuntimeState(plugin.runtime?.state) }}</dd>
          <dt class="text-muted-foreground">{{ t('settings.plugins.version') }}</dt>
          <dd>{{ plugin.runtime?.version || '-' }}</dd>
          <dt class="text-muted-foreground">{{ t('settings.plugins.command') }}</dt>
          <dd class="truncate font-mono text-xs">{{ plugin.runtime?.command || '-' }}</dd>
        </dl>

        <div v-if="plugin.runtime?.lastError" class="text-xs text-destructive">
          {{ plugin.runtime.lastError }}
        </div>

        <div
          v-if="getPluginMcpErrors(plugin).length > 0"
          class="space-y-1 text-xs text-destructive"
        >
          <div v-for="error in getPluginMcpErrors(plugin)" :key="error">
            {{ error }}
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <Button
            v-if="!plugin.enabled"
            :data-testid="`plugin-enable-${plugin.id}`"
            size="sm"
            :disabled="isPending(plugin.id)"
            @click="enablePlugin(plugin.id)"
          >
            <Icon icon="lucide:power" class="w-4 h-4 mr-2" />
            {{ t('settings.plugins.enable') }}
          </Button>
          <Button
            v-if="plugin.settings"
            :data-testid="`plugin-settings-${plugin.id}`"
            size="sm"
            variant="outline"
            :disabled="isPending(plugin.id)"
            @click="openSettings(plugin.id)"
          >
            <Icon icon="lucide:settings" class="w-4 h-4 mr-2" />
            {{ t('settings.plugins.openSettings') }}
          </Button>
          <Button
            v-if="plugin.enabled"
            :data-testid="`plugin-disable-${plugin.id}`"
            size="sm"
            variant="outline"
            :disabled="isPending(plugin.id)"
            @click="disablePlugin(plugin.id)"
          >
            <Icon icon="lucide:power-off" class="w-4 h-4 mr-2" />
            {{ t('settings.plugins.disable') }}
          </Button>
        </div>
      </article>
    </div>
  </SettingsPageShell>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { createPluginClient } from '@api/PluginClient'
import type { PluginActionResult, PluginListItem, PluginRuntimeState } from '@shared/types/plugin'
import SettingsPageShell from './control-center/SettingsPageShell.vue'

const { t } = useI18n()
const pluginClient = createPluginClient()
const plugins = ref<PluginListItem[]>([])
const loading = ref(false)
const errorMessage = ref('')
const pendingPluginId = ref<string | null>(null)

function isPending(pluginId: string): boolean {
  return pendingPluginId.value === pluginId
}

function formatRuntimeState(state?: PluginRuntimeState): string {
  if (!state) {
    return '-'
  }
  return t(`settings.plugins.runtimeStates.${state}`)
}

function getPluginMcpErrors(plugin: PluginListItem): string[] {
  return (plugin.mcpServers ?? [])
    .filter((server) => Boolean(server.lastError))
    .map((server) => `${server.serverId}: ${server.lastError}`)
}

async function loadPlugins(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    plugins.value = await pluginClient.listPlugins()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('settings.plugins.loadFailed')
  } finally {
    loading.value = false
  }
}

async function runPluginAction(
  pluginId: string,
  action: () => Promise<PluginActionResult>
): Promise<void> {
  pendingPluginId.value = pluginId
  errorMessage.value = ''
  try {
    const result = await action()
    if (!result.ok) {
      throw new Error(result.error || t('settings.plugins.actionFailed'))
    }
    await loadPlugins()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('settings.plugins.actionFailed')
  } finally {
    pendingPluginId.value = null
  }
}

async function enablePlugin(pluginId: string): Promise<void> {
  await runPluginAction(pluginId, () => pluginClient.enablePlugin(pluginId))
}

async function disablePlugin(pluginId: string): Promise<void> {
  await runPluginAction(pluginId, () => pluginClient.disablePlugin(pluginId))
}

async function openSettings(pluginId: string): Promise<void> {
  await runPluginAction(pluginId, () =>
    pluginClient.invokeAction({
      pluginId,
      actionId: 'settings.open'
    })
  )
}

onMounted(() => {
  void loadPlugins()
})
</script>
