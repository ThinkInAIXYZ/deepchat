<template>
  <SettingsPageShell
    :title="t('settings.environments.title')"
    :description="t('settings.environments.description')"
    :eyebrow="t('settings.controlCenter.groups.models')"
    data-testid="settings-environments-page"
  >
    <template #actions>
      <Button variant="outline" size="sm" :disabled="isLoading" @click="void refreshData()">
        <Icon
          icon="lucide:refresh-cw"
          class="mr-2 h-4 w-4"
          :class="isLoading ? 'animate-spin' : ''"
        />
        {{ t('settings.environments.actions.refresh') }}
      </Button>
    </template>

    <div class="flex w-full flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2 px-2">
        <Button
          variant="ghost"
          size="sm"
          data-testid="environments-active-tab"
          :class="currentView === 'active' ? 'bg-accent text-foreground' : 'text-muted-foreground'"
          @click="currentView = 'active'"
        >
          {{ t('settings.environments.tabs.active', { count: activeEnvironments.length }) }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid="environments-archived-tab"
          :class="
            currentView === 'archived' ? 'bg-accent text-foreground' : 'text-muted-foreground'
          "
          @click="currentView = 'archived'"
        >
          {{ t('settings.environments.tabs.archived', { count: archivedEnvironments.length }) }}
        </Button>
      </div>

      <div v-if="currentView === 'active'" class="flex items-center gap-3 px-2 py-1">
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
        v-if="currentView === 'active' && visibleActiveEnvironments.length === 0"
        class="px-2 py-6 text-sm text-muted-foreground"
        data-testid="environments-empty"
      >
        {{ t('settings.environments.empty.regular') }}
      </div>

      <draggable
        v-else-if="currentView === 'active'"
        :model-value="visibleActiveEnvironments"
        item-key="path"
        handle=".environment-folder-drag-target"
        :animation="150"
        ghost-class="environment-row-ghost"
        chosen-class="environment-row-chosen"
        :disabled="isLoading || visibleActiveEnvironments.length < 2"
        @update:model-value="handleVisibleActiveReorder"
      >
        <template #item="{ element: environment }">
          <EnvironmentRow
            :environment="environment"
            :default-project-path="defaultProjectPath"
            :view="currentView"
            :can-move-up="canMoveEnvironment(environment, -1)"
            :can-move-down="canMoveEnvironment(environment, 1)"
            :format-date="formatDate"
            @open="handleOpen"
            @set-default="handleSetDefault"
            @clear-default="handleClearDefault"
            @move-top="handleMove(environment, 'top')"
            @move-up="handleMove(environment, 'up')"
            @move-down="handleMove(environment, 'down')"
            @move-bottom="handleMove(environment, 'bottom')"
            @archive="requestEnvironmentAction('archive', environment)"
            @remove="requestEnvironmentAction('remove', environment)"
          />
        </template>
      </draggable>

      <div v-else class="flex flex-col" data-testid="environments-archived-panel">
        <div
          v-if="archivedEnvironments.length === 0"
          class="px-2 py-6 text-sm text-muted-foreground"
          data-testid="environments-archived-empty"
        >
          {{ t('settings.environments.empty.archived') }}
        </div>

        <template v-else>
          <EnvironmentRow
            v-for="environment in archivedEnvironments"
            :key="environment.path"
            :environment="environment"
            :default-project-path="defaultProjectPath"
            view="archived"
            :can-move-up="false"
            :can-move-down="false"
            :format-date="formatDate"
            @open="handleOpen"
            @restore="handleRestore"
            @remove="requestEnvironmentAction('remove', environment)"
          />
        </template>
      </div>
    </div>
  </SettingsPageShell>

  <Dialog v-model:open="confirmDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ confirmTitle }}</DialogTitle>
        <DialogDescription>{{ confirmDescription }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="confirmDialogOpen = false">
          {{ t('common.cancel') }}
        </Button>
        <Button
          :variant="pendingAction?.type === 'remove' ? 'destructive' : 'default'"
          @click="void confirmEnvironmentAction()"
        >
          {{ confirmActionLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, watch, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import draggable from 'vuedraggable'
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { Switch } from '@shadcn/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
import { useToast } from '@/components/use-toast'
import { createProjectClient } from '@api/ProjectClient'
import { useProjectStore } from '@/stores/ui/project'
import type { EnvironmentSummary } from '@shared/types/agent-interface'
import SettingsPageShell from './control-center/SettingsPageShell.vue'

type EnvironmentListItem = EnvironmentSummary & {
  isSyntheticDefault?: boolean
}

type EnvironmentView = 'active' | 'archived'
type PendingEnvironmentAction = {
  type: 'archive' | 'remove'
  environment: EnvironmentListItem
}
type MoveTarget = 'top' | 'up' | 'down' | 'bottom'

const { t, locale } = useI18n()
const { toast } = useToast()
const projectStore = useProjectStore()
const projectClient = createProjectClient()

const isLoading = ref(false)
const showMissing = ref(false)
const syntheticDefaultExists = ref(true)
const currentView = ref<EnvironmentView>('active')
const pendingAction = ref<PendingEnvironmentAction | null>(null)

const defaultProjectPath = computed(() => projectStore.defaultProjectPath)
const archivedEnvironments = computed<EnvironmentListItem[]>(
  () => projectStore.archivedEnvironments
)
const archivedEnvironmentPaths = computed(
  () => new Set(projectStore.archivedEnvironments.map((environment) => environment.path))
)

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
    const exists = await projectClient.pathExists(currentPath)
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
  if (!defaultProjectPath.value || archivedEnvironmentPaths.value.has(defaultProjectPath.value)) {
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
    status: 'active',
    sortOrder: 2147483647,
    archivedAt: null,
    removedAt: null,
    isSyntheticDefault: true
  }
})

const activeEnvironments = computed<EnvironmentListItem[]>(() => [
  ...projectStore.environments,
  ...(syntheticDefaultEnvironment.value ? [syntheticDefaultEnvironment.value] : [])
])

const shouldShowActiveEnvironment = (environment: EnvironmentListItem) =>
  (!environment.isTemp || environment.path === defaultProjectPath.value) &&
  (showMissing.value || environment.exists)

const visibleActiveEnvironments = computed(() =>
  activeEnvironments.value.filter(shouldShowActiveEnvironment)
)

const confirmDialogOpen = computed({
  get: () => pendingAction.value !== null,
  set: (open: boolean) => {
    if (!open) {
      pendingAction.value = null
    }
  }
})

const confirmTitle = computed(() => {
  if (pendingAction.value?.type === 'archive') {
    return t('settings.environments.confirm.archiveTitle', {
      name: pendingAction.value.environment.name
    })
  }

  return t('settings.environments.confirm.removeTitle', {
    name: pendingAction.value?.environment.name ?? ''
  })
})

const confirmDescription = computed(() => {
  if (pendingAction.value?.type === 'archive') {
    return t('settings.environments.confirm.archiveDescription')
  }

  return t('settings.environments.confirm.removeDescription')
})

const confirmActionLabel = computed(() =>
  pendingAction.value?.type === 'archive'
    ? t('settings.environments.actions.archive')
    : t('settings.environments.actions.remove')
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

const getActiveOrderPaths = () => activeEnvironments.value.map((environment) => environment.path)

const reorderActivePaths = async (paths: string[]) => {
  try {
    await projectStore.reorderEnvironments(paths)
  } catch (error) {
    toast({
      title: t('settings.environments.errors.reorderTitle'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const handleVisibleActiveReorder = (nextVisibleEnvironments: EnvironmentListItem[]) => {
  const currentOrder = getActiveOrderPaths()
  const visiblePathSet = new Set(
    visibleActiveEnvironments.value.map((environment) => environment.path)
  )
  const visibleIndexes = currentOrder
    .map((environmentPath, index) => (visiblePathSet.has(environmentPath) ? index : -1))
    .filter((index) => index >= 0)
  const nextVisiblePaths = nextVisibleEnvironments.map((environment) => environment.path)
  const nextOrder = [...currentOrder]

  visibleIndexes.forEach((targetIndex, index) => {
    nextOrder[targetIndex] = nextVisiblePaths[index]
  })

  void reorderActivePaths(nextOrder)
}

const canMoveEnvironment = (environment: EnvironmentListItem, delta: -1 | 1) => {
  const paths = getActiveOrderPaths()
  const index = paths.indexOf(environment.path)
  if (index < 0) {
    return false
  }

  return delta < 0 ? index > 0 : index < paths.length - 1
}

const handleMove = (environment: EnvironmentListItem, target: MoveTarget) => {
  const paths = getActiveOrderPaths()
  const currentIndex = paths.indexOf(environment.path)
  if (currentIndex < 0) {
    return
  }

  const [path] = paths.splice(currentIndex, 1)
  const nextIndex =
    target === 'top'
      ? 0
      : target === 'bottom'
        ? paths.length
        : target === 'up'
          ? Math.max(0, currentIndex - 1)
          : Math.min(paths.length, currentIndex + 1)

  paths.splice(nextIndex, 0, path)
  void reorderActivePaths(paths)
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

const requestEnvironmentAction = (
  type: PendingEnvironmentAction['type'],
  environment: EnvironmentListItem
) => {
  pendingAction.value = { type, environment }
}

const handleRestore = async (environment: EnvironmentListItem) => {
  try {
    await projectStore.restoreEnvironment(environment.path)
  } catch (error) {
    toast({
      title: t('settings.environments.errors.restoreTitle'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const confirmEnvironmentAction = async () => {
  const action = pendingAction.value
  if (!action) {
    return
  }

  pendingAction.value = null

  try {
    if (action.type === 'archive') {
      await projectStore.archiveEnvironment(action.environment.path)
      return
    }

    await projectStore.removeEnvironment(action.environment.path)
  } catch (error) {
    toast({
      title:
        action.type === 'archive'
          ? t('settings.environments.errors.archiveTitle')
          : t('settings.environments.errors.removeTitle'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive'
    })
  }
}

const EnvironmentRow = defineComponent({
  name: 'EnvironmentRow',
  props: {
    environment: {
      type: Object as PropType<EnvironmentListItem>,
      required: true
    },
    defaultProjectPath: {
      type: String as PropType<string | null>,
      default: null
    },
    view: {
      type: String as PropType<EnvironmentView>,
      required: true
    },
    canMoveUp: {
      type: Boolean,
      default: false
    },
    canMoveDown: {
      type: Boolean,
      default: false
    },
    formatDate: {
      type: Function as PropType<(timestamp: number) => string>,
      required: true
    }
  },
  emits: [
    'open',
    'set-default',
    'clear-default',
    'move-top',
    'move-up',
    'move-down',
    'move-bottom',
    'archive',
    'restore',
    'remove'
  ],
  setup(props, { emit }) {
    const isDefault = () => props.environment.path === props.defaultProjectPath
    const metaTimestamp = () =>
      props.view === 'archived' ? (props.environment.archivedAt ?? 0) : props.environment.lastUsedAt
    const folderIdentityAttrs = () =>
      props.view === 'active'
        ? {
            type: 'button',
            class:
              'environment-folder-drag-target flex w-full cursor-grab items-start gap-3 rounded-md text-left active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'aria-label': t('settings.environments.actions.dragTarget', {
              name: props.environment.name
            })
          }
        : {
            class: 'flex w-full items-start gap-3 rounded-md text-left',
            'aria-label': props.environment.name
          }

    return () =>
      h(
        'article',
        {
          class: 'border-b border-border/50 px-2 py-3 last:border-b-0',
          'data-testid': 'environment-row'
        },
        [
          h('div', { class: 'flex flex-col gap-3 md:flex-row md:items-start md:justify-between' }, [
            h('div', { class: 'min-w-0 flex-1' }, [
              h(props.view === 'active' ? 'button' : 'div', folderIdentityAttrs(), [
                h(
                  'span',
                  {
                    class:
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/30 text-muted-foreground'
                  },
                  [
                    h(Icon, {
                      icon: props.view === 'archived' ? 'lucide:archive' : 'lucide:folder',
                      class: 'h-4 w-4'
                    })
                  ]
                ),
                h('span', { class: 'min-w-0 flex-1' }, [
                  h('span', { class: 'flex flex-wrap items-center gap-2' }, [
                    h(
                      'span',
                      { class: 'text-sm font-medium text-foreground' },
                      props.environment.name
                    ),
                    isDefault()
                      ? h(
                          'span',
                          {
                            class: 'text-xs font-medium text-primary',
                            'data-testid': 'environment-badge-default'
                          },
                          t('settings.environments.badges.default')
                        )
                      : null,
                    !props.environment.exists
                      ? h(
                          'span',
                          { class: 'text-xs text-destructive' },
                          t('settings.environments.badges.missing')
                        )
                      : null,
                    props.environment.isSyntheticDefault
                      ? h(
                          'span',
                          { class: 'text-xs text-muted-foreground' },
                          t('settings.environments.badges.notInHistory')
                        )
                      : null
                  ]),
                  h(
                    'span',
                    { class: 'mt-1 block break-all text-xs text-muted-foreground' },
                    props.environment.path
                  ),
                  h('span', { class: 'mt-1 block text-xs text-muted-foreground' }, [
                    props.view === 'archived'
                      ? t('settings.environments.meta.archivedAt', {
                          value: props.formatDate(metaTimestamp())
                        })
                      : t('settings.environments.meta.sessions', {
                          count: props.environment.sessionCount
                        }),
                    props.view === 'active' ? h('span', { class: 'px-1.5' }, '|') : null,
                    props.view === 'active'
                      ? t('settings.environments.meta.lastUsed', {
                          value: props.formatDate(props.environment.lastUsedAt)
                        })
                      : null
                  ])
                ])
              ])
            ]),
            h('div', { class: 'flex shrink-0 flex-wrap items-center gap-2 md:pl-4' }, [
              h(
                Button,
                {
                  variant: 'outline',
                  size: 'sm',
                  'aria-label': t('settings.environments.actions.open'),
                  onClick: () => emit('open', props.environment.path)
                },
                () => t('settings.environments.actions.open')
              ),
              props.view === 'active'
                ? isDefault()
                  ? h(
                      Button,
                      {
                        variant: 'ghost',
                        size: 'sm',
                        'aria-label': t('settings.environments.actions.clearDefault'),
                        onClick: () => emit('clear-default')
                      },
                      () => t('settings.environments.actions.clearDefault')
                    )
                  : h(
                      Button,
                      {
                        variant: 'ghost',
                        size: 'sm',
                        disabled: !props.environment.exists,
                        'aria-label': t('settings.environments.actions.setDefault'),
                        onClick: () => emit('set-default', props.environment)
                      },
                      () => t('settings.environments.actions.setDefault')
                    )
                : h(
                    Button,
                    {
                      variant: 'ghost',
                      size: 'sm',
                      'aria-label': t('settings.environments.actions.restore'),
                      onClick: () => emit('restore', props.environment)
                    },
                    () => t('settings.environments.actions.restore')
                  ),
              h(DropdownMenu, null, () => [
                h(DropdownMenuTrigger, { asChild: true }, () =>
                  h(
                    Button,
                    {
                      variant: 'ghost',
                      size: 'icon',
                      class: 'h-8 w-8',
                      'aria-label': t('settings.environments.actions.more')
                    },
                    () => h(Icon, { icon: 'lucide:ellipsis', class: 'h-4 w-4' })
                  )
                ),
                h(DropdownMenuContent, { align: 'end', class: 'w-44' }, () => [
                  props.view === 'active'
                    ? [
                        h(
                          DropdownMenuItem,
                          {
                            disabled: !props.canMoveUp,
                            onSelect: () => emit('move-top')
                          },
                          () => t('settings.environments.actions.moveTop')
                        ),
                        h(
                          DropdownMenuItem,
                          {
                            disabled: !props.canMoveUp,
                            onSelect: () => emit('move-up')
                          },
                          () => t('settings.environments.actions.moveUp')
                        ),
                        h(
                          DropdownMenuItem,
                          {
                            disabled: !props.canMoveDown,
                            onSelect: () => emit('move-down')
                          },
                          () => t('settings.environments.actions.moveDown')
                        ),
                        h(
                          DropdownMenuItem,
                          {
                            disabled: !props.canMoveDown,
                            onSelect: () => emit('move-bottom')
                          },
                          () => t('settings.environments.actions.moveBottom')
                        ),
                        h(DropdownMenuSeparator),
                        h(
                          DropdownMenuItem,
                          { onSelect: () => emit('archive', props.environment) },
                          () => t('settings.environments.actions.archive')
                        )
                      ]
                    : [
                        h(
                          DropdownMenuItem,
                          { onSelect: () => emit('restore', props.environment) },
                          () => t('settings.environments.actions.restore')
                        )
                      ],
                  h(DropdownMenuSeparator),
                  h(
                    DropdownMenuItem,
                    {
                      class: 'text-destructive focus:text-destructive',
                      onSelect: () => emit('remove', props.environment)
                    },
                    () => t('settings.environments.actions.remove')
                  )
                ])
              ])
            ])
          ])
        ]
      )
  }
})

onMounted(() => {
  void refreshData()
})

watch(
  [defaultProjectPath, () => projectStore.environments, () => projectStore.archivedEnvironments],
  () => {
    void syncSyntheticDefaultExists()
  },
  { immediate: true, deep: true }
)
</script>

<style scoped>
:deep(.environment-row-ghost) {
  opacity: 0.45;
}

:deep(.environment-row-chosen) {
  background: hsl(var(--accent) / 0.35);
}
</style>
