<template>
  <div
    class="relative h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
    :style="{ width: `${panelWidth}px` }"
  >
    <aside
      v-if="props.sessionId"
      class="absolute inset-y-0 right-0 flex h-full w-full flex-col border-l bg-background shadow-lg transition-all duration-200 ease-out"
      :class="
        shouldShow
          ? 'translate-x-0 opacity-100'
          : 'pointer-events-none translate-x-4 opacity-0 shadow-none'
      "
    >
      <button
        v-if="shouldShow"
        class="absolute inset-y-0 left-0 w-1 -translate-x-1/2 cursor-col-resize"
        type="button"
        @mousedown="startResize"
      ></button>

      <div class="flex h-11 items-center justify-between border-b px-3">
        <div class="flex items-center gap-1 rounded-lg bg-muted p-0.5">
          <button
            class="rounded-md px-2.5 py-1 text-xs transition-colors"
            :class="
              sidepanelStore.activeTab === 'workspace'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground'
            "
            type="button"
            @click="sidepanelStore.openWorkspace(props.sessionId)"
          >
            {{ t('chat.workspace.title') }}
          </button>
          <button
            class="rounded-md px-2.5 py-1 text-xs transition-colors"
            :class="
              sidepanelStore.activeTab === 'browser'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground'
            "
            type="button"
            @click="sidepanelStore.openBrowser()"
          >
            {{ t('common.browser.name') }}
          </button>
        </div>

        <Button variant="ghost" size="icon" class="h-7 w-7" @click="sidepanelStore.closePanel()">
          <Icon icon="lucide:x" class="h-4 w-4" />
        </Button>
      </div>

      <WorkspacePanel
        v-if="sidepanelStore.activeTab === 'workspace'"
        :session-id="props.sessionId"
        :workspace-path="props.workspacePath"
      />
      <BrowserPanel v-else :session-id="props.sessionId" />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import BrowserPanel from './BrowserPanel.vue'
import WorkspacePanel from './WorkspacePanel.vue'
import { YO_BROWSER_EVENTS } from '@/events'
import { useSidepanelStore } from '@/stores/ui/sidepanel'

const props = defineProps<{
  sessionId: string | null
  workspacePath: string | null
}>()

const { t } = useI18n()
const sidepanelStore = useSidepanelStore()

const shouldShow = computed(() => sidepanelStore.open && Boolean(props.sessionId))
const panelWidth = computed(() => (shouldShow.value ? sidepanelStore.width : 0))

const handleBrowserOpenRequested = (_event: unknown, payload: unknown) => {
  const currentWindowId = window.api.getWindowId?.() ?? null
  const requestedWindowId =
    payload && typeof payload === 'object' && 'windowId' in payload ? payload.windowId : null
  const requestedSessionId =
    payload && typeof payload === 'object' && 'sessionId' in payload ? payload.sessionId : null

  if (
    !props.sessionId ||
    requestedSessionId !== props.sessionId ||
    typeof requestedWindowId !== 'number' ||
    requestedWindowId !== currentWindowId
  ) {
    return
  }

  sidepanelStore.openBrowser()
}

const startResize = (event: MouseEvent) => {
  const startX = event.clientX
  const startWidth = sidepanelStore.width

  const onMouseMove = (moveEvent: MouseEvent) => {
    sidepanelStore.setWidth(startWidth - (moveEvent.clientX - startX))
  }

  const onMouseUp = () => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

onMounted(() => {
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.OPEN_REQUESTED, handleBrowserOpenRequested)
})

onBeforeUnmount(() => {
  window.electron.ipcRenderer.removeListener(
    YO_BROWSER_EVENTS.OPEN_REQUESTED,
    handleBrowserOpenRequested
  )
})
</script>
