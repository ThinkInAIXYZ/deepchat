<template>
  <ScrollArea class="h-full w-full">
    <div class="flex h-full w-full flex-col gap-1.5 p-4">
      <div class="flex items-start gap-3 px-2 py-2">
        <div class="flex-1 text-xs leading-5 text-muted-foreground">
          {{ t('settings.environments.description') }}
        </div>
        <Button variant="outline" size="sm" :disabled="isLoading" @click="void refreshData()">
          <Icon
            icon="lucide:refresh-cw"
            class="mr-2 h-4 w-4"
            :class="isLoading ? 'animate-spin' : ''"
          />
          {{ t('settings.environments.actions.refresh') }}
        </Button>
      </div>

      <div class="flex items-center gap-3 px-2 py-2">
        <span class="flex items-center gap-2 text-sm font-medium text-foreground">
          <Icon icon="lucide:folder-x" class="h-4 w-4 text-muted-foreground" />
          {{ t('settings.environments.actions.showMissing') }}
        </span>
        <div class="ml-auto">
          <Switch
            data-testid="missing-toggle"
            :model-value="showMissing"
            @update:model-value="showMissing = $event"
          />
        </div>
      </div>

      <div
        v-if="visibleEnvironments.length === 0"
        class="px-2 py-6 text-sm text-muted-foreground"
        data-testid="environments-empty"
      >
        {{ t('settings.environments.empty.regular') }}
      </div>

      <template v-else>
        <article
          v-for="environment in visibleEnvironments"
          :key="environment.path"
          class="border-b border-border/50 px-2 py-3 last:border-b-0"
          data-testid="environment-row"
        >
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex items-start gap-3">
                <div
                  class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/30 text-muted-foreground"
                >
                  <Icon icon="lucide:folder" class="h-4 w-4" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="text-sm font-medium text-foreground">
                      {{ environment.name }}
                    </div>
                    <span
                      v-if="environment.path === defaultProjectPath"
                      class="text-xs font-medium text-primary"
                      data-testid="environment-badge-default"
                    >
                      {{ t('settings.environments.badges.default') }}
                    </span>
                    <span v-if="!environment.exists" class="text-xs text-destructive">
                      {{ t('settings.environments.badges.missing') }}
                    </span>
                    <span
                      v-if="environment.isSyntheticDefault"
                      class="text-xs text-muted-foreground"
                    >
                      {{ t('settings.environments.badges.notInHistory') }}
                    </span>
                  </div>
                  <p class="mt-1 break-all text-xs text-muted-foreground">
                    {{ environment.path }}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    {{
                      t('settings.environments.meta.sessions', {
                        count: environment.sessionCount
                      })
                    }}
                    <span class="px-1.5">·</span>
                    {{
                      t('settings.environments.meta.lastUsed', {
                        value: formatDate(environment.lastUsedAt)
                      })
                    }}
                  </p>
                </div>
              </div>
            </div>

            <div class="flex shrink-0 flex-wrap items-center gap-2 md:pl-4">
              <Button
                variant="outline"
                size="sm"
                :aria-label="t('settings.environments.actions.open')"
                @click="void handleOpen(environment.path)"
              >
                {{ t('settings.environments.actions.open') }}
              </Button>
              <Button
                v-if="environment.path !== defaultProjectPath"
                variant="ghost"
                size="sm"
                :aria-label="t('settings.environments.actions.setDefault')"
                :disabled="!environment.exists"
                @click="void handleSetDefault(environment)"
              >
                {{ t('settings.environments.actions.setDefault') }}
              </Button>
              <Button
                v-else
                variant="ghost"
                size="sm"
                :aria-label="t('settings.environments.actions.clearDefault')"
                @click="void handleClearDefault()"
              >
                {{ t('settings.environments.actions.clearDefault') }}
              </Button>
            </div>
          </div>
        </article>
      </template>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Switch } from '@shadcn/components/ui/switch'
import { useToast } from '@/components/use-toast'
import { usePresenter } from '@/composables/usePresenter'
import { useProjectStore } from '@/stores/ui/project'
import type { EnvironmentSummary } from '@shared/types/agent-interface'

type EnvironmentListItem = EnvironmentSummary & {
  isSyntheticDefault?: boolean
}

const { t, locale } = useI18n()
const { toast } = useToast()
const projectStore = useProjectStore()
const projectPresenter = usePresenter('projectPresenter', { safeCall: false })

const isLoading = ref(false)
const showMissing = ref(false)
const syntheticDefaultExists = ref(true)

const sortEnvironments = (list: EnvironmentListItem[]) =>
  [...list].sort((left, right) => {
    const leftDefault = left.path === projectStore.defaultProjectPath
    const rightDefault = right.path === projectStore.defaultProjectPath
    if (leftDefault !== rightDefault) {
      return leftDefault ? -1 : 1
    }
    return right.lastUsedAt - left.lastUsedAt
  })

const defaultProjectPath = computed(() => projectStore.defaultProjectPath)

const syncSyntheticDefaultExists = async () => {
  const currentPath = defaultProjectPath.value
  if (!currentPath) {
    syntheticDefaultExists.value = true
    return
  }

  const matchedEnvironment = projectStore.environments.find(
    (environment) => environment.path === currentPath
  )
  if (matchedEnvironment) {
    syntheticDefaultExists.value = matchedEnvironment.exists
    return
  }

  try {
    const exists = await projectPresenter.pathExists(currentPath)
    if (defaultProjectPath.value === currentPath) {
      syntheticDefaultExists.value = exists
    }
  } catch (error) {
    console.warn('[EnvironmentsSettings] Failed to resolve synthetic default path existence:', {
      path: currentPath,
      error
    })
    if (defaultProjectPath.value === currentPath) {
      syntheticDefaultExists.value = true
    }
  }
}

const syntheticDefaultEnvironment = computed<EnvironmentListItem | null>(() => {
  if (!defaultProjectPath.value) {
    return null
  }

  const matched = projectStore.environments.some(
    (environment) => environment.path === defaultProjectPath.value
  )
  if (matched) {
    return null
  }

  return {
    path: defaultProjectPath.value,
    name: defaultProjectPath.value.split(/[/\\]/).pop() ?? defaultProjectPath.value,
    sessionCount: 0,
    lastUsedAt: 0,
    isTemp: false,
    exists: syntheticDefaultExists.value,
    isSyntheticDefault: true
  }
})

const shouldShowEnvironment = (environment: EnvironmentListItem) =>
  (!environment.isTemp || environment.path === defaultProjectPath.value) &&
  (showMissing.value || environment.exists)

const visibleEnvironments = computed(() =>
  sortEnvironments(
    [
      ...projectStore.environments,
      ...(syntheticDefaultEnvironment.value ? [syntheticDefaultEnvironment.value] : [])
    ].filter(shouldShowEnvironment)
  )
)

const formatDate = (timestamp: number) => {
  if (!timestamp) {
    return t('settings.environments.meta.never')
  }

  return new Intl.DateTimeFormat(locale.value || undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp))
}

const refreshData = async () => {
  try {
    isLoading.value = true
    await projectStore.refreshEnvironmentData()
  } finally {
    isLoading.value = false
  }
}

const handleOpen = async (path: string) => {
  try {
    await projectStore.openDirectory(path)
  } catch (error) {
    toast({
      title: t('settings.environments.errors.openTitle'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const handleSetDefault = async (environment: EnvironmentListItem) => {
  if (!environment.exists) {
    return
  }

  await projectStore.setDefaultProject(environment.path)
}

const handleClearDefault = async () => {
  await projectStore.clearDefaultProject()
}

onMounted(() => {
  void refreshData()
})

watch(
  [defaultProjectPath, () => projectStore.environments],
  () => {
    void syncSyntheticDefaultExists()
  },
  { immediate: true, deep: true }
)
</script>
