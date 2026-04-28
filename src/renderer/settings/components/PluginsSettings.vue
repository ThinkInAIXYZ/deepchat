<template>
  <div class="w-full h-full flex flex-col p-6 gap-4 overflow-hidden">
    <header class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-lg font-semibold truncate">{{ t('settings.plugins.title') }}</h2>
        <p class="text-xs text-muted-foreground mt-1">
          {{ t('settings.plugins.officialOnly') }}
        </p>
      </div>
      <Button variant="outline" size="sm" :disabled="loading" @click="loadPlugins">
        <Icon icon="lucide:refresh-cw" class="w-4 h-4 mr-2" />
        {{ t('settings.plugins.refresh') }}
      </Button>
    </header>

    <div
      v-if="errorMessage"
      class="border border-destructive/40 text-destructive rounded-lg px-3 py-2 text-sm"
    >
      {{ errorMessage }}
    </div>

    <div class="flex-1 overflow-y-auto space-y-3 pr-1">
      <div v-if="!loading && plugins.length === 0" class="text-sm text-muted-foreground">
        {{ t('settings.plugins.empty') }}
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

        <div class="flex flex-wrap gap-2">
          <Button
            v-if="!plugin.installed"
            size="sm"
            :disabled="isPending(plugin.id)"
            @click="installPlugin(plugin.id)"
          >
            <Icon icon="lucide:download" class="w-4 h-4 mr-2" />
            {{ t('settings.plugins.install') }}
          </Button>
          <Button
            v-if="plugin.installed && !plugin.enabled"
            size="sm"
            :disabled="isPending(plugin.id)"
            @click="enablePlugin(plugin.id)"
          >
            <Icon icon="lucide:power" class="w-4 h-4 mr-2" />
            {{ t('settings.plugins.enable') }}
          </Button>
          <Button
            v-if="plugin.enabled && plugin.settings"
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
            size="sm"
            variant="outline"
            :disabled="isPending(plugin.id)"
            @click="disablePlugin(plugin.id)"
          >
            <Icon icon="lucide:power-off" class="w-4 h-4 mr-2" />
            {{ t('settings.plugins.disable') }}
          </Button>
          <Button
            v-if="plugin.installed"
            size="sm"
            variant="outline"
            :disabled="isPending(plugin.id)"
            @click="deletePlugin(plugin.id)"
          >
            <Icon icon="lucide:trash-2" class="w-4 h-4 mr-2" />
            {{ t('common.delete') }}
          </Button>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { createPluginClient } from '@api/PluginClient'
import type { PluginActionResult, PluginListItem, PluginRuntimeState } from '@shared/types/plugin'

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

async function installPlugin(pluginId: string): Promise<void> {
  await runPluginAction(pluginId, () => pluginClient.installOfficialPlugin(pluginId))
}

async function enablePlugin(pluginId: string): Promise<void> {
  await runPluginAction(pluginId, () => pluginClient.enablePlugin(pluginId))
}

async function disablePlugin(pluginId: string): Promise<void> {
  await runPluginAction(pluginId, () => pluginClient.disablePlugin(pluginId))
}

async function deletePlugin(pluginId: string): Promise<void> {
  await runPluginAction(pluginId, () => pluginClient.deletePlugin(pluginId))
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
