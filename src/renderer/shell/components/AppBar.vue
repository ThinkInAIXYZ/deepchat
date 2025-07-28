<template>
  <div class="flex flex-row h-10" :dir="langStore.dir">
    <div
      class="h-10 flex-shrink-0 w-0 flex-1 flex select-none text-center text-sm font-medium flex-row items-center justify-start window-drag-region"
      :class="['', isMacOS ? (isFullscreened ? 'pl-2 pr-2' : 'pl-20 pr-2') : 'px-2']"
    >
      <!-- App title/content in center -->
      <Button
        v-if="isTabContainerOverflowingLeft"
        variant="ghost"
        class="flex-shrink-0 text-xs font-medium px-2 h-6 mt-0.5 bg-transparent rounded-md flex items-center justify-center hover:bg-zinc-500/20 mr-1"
        @click="scrollTabContainer('left')"
      >
        <Icon icon="lucide:chevron-left" class="w-4 h-4" />
      </Button>
      <Button
        v-if="isTabContainerOverflowingRight"
        variant="ghost"
        class="flex-shrink-0 text-xs font-medium px-2 h-6 mt-0.5 bg-transparent rounded-md flex items-center justify-center hover:bg-zinc-500/20 mr-1"
        @click="scrollTabContainer('right')"
      >
        <Icon icon="lucide:chevron-right" class="w-4 h-4" />
      </Button>
      <div
        ref="tabContainerWrapper"
        class="h-full flex flex-row items-center justify-start overflow-y-hidden overflow-x-auto scrollbar-hide"
        @scroll="onTabContainerWrapperScroll"
      >
        <div
          ref="tabContainer"
          class="h-full flex flex-row items-center justify-start gap-1 relative"
          @dragover="onTabContainerDragOver"
          @drop="onTabContainerDrop"
        >
          <AppBarTabItem
            v-for="(tab, idx) in tabStore.tabs"
            :key="tab.id"
            :active="tab.id === tabStore.currentTabId"
            :size="tabStore.tabs.length"
            :index="idx"
            class="window-no-drag-region"
            @click="tabStore.setCurrentTabId(tab.id)"
            @close="tabStore.removeTab(tab.id)"
            @dragstart="onTabDragStart(tab.id, $event)"
            @dragover="onTabItemDragOver(idx, $event)"
          >
            <img src="@/assets/logo.png" class="w-4 h-4 mr-2 rounded-sm" />
            <span class="truncate">{{ tab.title ?? 'DeepChat' }}</span>
          </AppBarTabItem>
          <!-- 拖拽插入指示器 -->
          <div
            v-if="dragInsertIndex !== -1"
            class="absolute top-0 bottom-0 w-0.5 bg-blue-500 z-10 pointer-events-none"
            :style="{ left: dragInsertPosition + 'px' }"
          ></div>
          <div ref="endOfTabs" class="w-0 flex-shrink-0 h-full"></div>
        </div>
      </div>

      <Button
        variant="ghost"
        class="flex-shrink-0 text-xs ml-1 font-medium px-2 h-6 bg-transparent rounded-md flex items-center justify-center hover:bg-zinc-500/20"
        @click="openNewTab"
      >
        <Icon icon="lucide:plus" class="w-4 h-4" />
      </Button>
      <div class="flex-1"></div>

      <Button
        variant="ghost"
        class="text-xs font-medium px-2 h-7 bg-transparent rounded-md flex items-center justify-center hover:bg-zinc-500/20"
        @click="onThemeClick"
      >
        <Icon v-if="themeStore.themeMode === 'dark'" icon="lucide:moon" class="w-4 h-4" />
        <Icon v-else-if="themeStore.themeMode === 'light'" icon="lucide:sun" class="w-4 h-4" />
        <Icon v-else icon="lucide:monitor" class="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        class="text-xs font-medium px-2 h-7 bg-transparent rounded-md flex items-center justify-center hover:bg-zinc-500/20"
        @click="openSettings"
      >
        <Icon icon="lucide:settings" class="w-4 h-4" />
      </Button>
      <!-- <Button
        class="text-xs font-medium px-2 h-7 bg-transparent rounded-md flex items-center justify-center"
        @click="openNewWindow"
      >
        <Icon v-if="isMacOS" icon="lucide:app-window-mac" class="w-4 h-4" />
        <Icon v-else icon="lucide:app-window" class="w-4 h-4" />
      </Button> -->
    </div>

    <div v-if="!isMacOS" class="flex h-10">
      <button
        class="inline-flex items-center justify-center h-full w-12 hover:bg-zinc-500/20"
        @click="minimizeWindow"
      >
        <MinusIcon class="h-4 w-4" />
      </button>
      <button
        class="inline-flex items-center justify-center h-full w-12 hover:bg-zinc-500/20"
        @click="toggleMaximize"
      >
        <MaximizeIcon v-if="!isMaximized" class="h-4 w-4" />
        <RestoreIcon v-else class="h-4 w-4" />
      </button>
      <button
        class="inline-flex items-center justify-center h-full w-12 hover:bg-destructive hover:text-destructive-foreground"
        @click="closeWindow"
      >
        <XIcon class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed } from 'vue'
import { MinusIcon, XIcon } from 'lucide-vue-next'
import MaximizeIcon from './icons/MaximizeIcon.vue'
import RestoreIcon from './icons/RestoreIcon.vue'
import { usePresenter } from '@/composables/usePresenter'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'
import AppBarTabItem from './app-bar/AppBarTabItem.vue'
import { useTabStore } from '@shell/stores/tab'
import { useThemeStore } from '@/stores/theme'
import { useElementSize } from '@vueuse/core'
import { useLanguageStore } from '@/stores/language'
const tabStore = useTabStore()
const langStore = useLanguageStore()
const windowPresenter = usePresenter('windowPresenter')
const devicePresenter = usePresenter('devicePresenter')
const tabPresenter = usePresenter('tabPresenter')
const endOfTabs = ref<HTMLElement | null>(null)

const isMacOS = ref(false)
const isMaximized = ref(false)
const isFullscreened = ref(false)

const { ipcRenderer } = window.electron

const themeStore = useThemeStore()
const tabContainerWrapper = ref<HTMLElement | null>(null)
const tabContainer = ref<HTMLElement | null>(null)

let draggedTabId: number | null = null
const dragInsertIndex = ref(-1)
const dragInsertPosition = ref(0)

const tabContainerWrapperSize = useElementSize(tabContainerWrapper)
const tabContainerSize = useElementSize(tabContainer)
const tabContainerWrapperScrollLeft = ref(0)

const onTabContainerWrapperScroll = () => {
  requestAnimationFrame(() => {
    tabContainerWrapperScrollLeft.value = tabContainerWrapper.value?.scrollLeft ?? 0
  })
}

const isTabContainerOverflowingLeft = computed(() => {
  return (
    tabContainerWrapperSize.width.value < tabContainerSize.width.value &&
    tabContainerWrapperScrollLeft.value > 0
  )
})

const isTabContainerOverflowingRight = computed(() => {
  return (
    tabContainerWrapperSize.width.value < tabContainerSize.width.value &&
    tabContainerWrapperScrollLeft.value <
      (tabContainerWrapper.value?.scrollWidth ?? 0) - tabContainerWrapperSize.width.value
  )
})

const onTabDragStart = (tabId: number, event: DragEvent) => {
  const tab = tabStore.tabs.find((t) => t.id === tabId)
  if (!tab) {
    console.warn(`Tab with id ${tabId} not found for drag start.`)
    return
  }

  if (event.dataTransfer) {
    event.dataTransfer.setData('text/plain', tabId.toString())
    event.dataTransfer.effectAllowed = 'all' // 允许所有拖拽效果，动态判断
    draggedTabId = tabId
    console.log('onTabDragStart - Tab ID:', tabId, 'Name:', tab.title)

    // Create the drag preview element
    const preview = document.createElement('div')
    preview.style.position = 'absolute'
    preview.style.top = '-1000px'
    preview.style.left = '-1000px'
    preview.style.backgroundColor = 'hsl(var(--background))'
    preview.style.color = 'hsl(var(--foreground))'
    preview.style.border = `1px solid hsl(var(--border))`
    preview.style.borderRadius = '6px'
    preview.style.padding = '48px'
    preview.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1), 0 4px 8px rgba(0,0,0,0.1)'
    preview.style.fontSize = '13px'
    preview.style.fontFamily = 'inherit'
    preview.style.display = 'inline-block'
    preview.style.whiteSpace = 'nowrap'
    preview.style.zIndex = '9999'

    preview.textContent = tab.title || 'Untitled Tab'

    document.body.appendChild(preview)
    event.dataTransfer.setDragImage(preview, 10, 10)

    setTimeout(() => {
      if (preview.parentNode === document.body) {
        document.body.removeChild(preview)
      }
    }, 0)
  }
}

// 标签页项目拖拽悬停处理（窗口内重排序）
const onTabItemDragOver = (index: number, event: DragEvent) => {
  event.preventDefault()
  event.stopPropagation()

  // 检查是否是当前窗口的标签页拖拽
  const isCurrentWindowDrag = draggedTabId !== null
  // 检查是否是外部拖拽（跨窗口）
  const isExternalDrag = !isCurrentWindowDrag && event.dataTransfer?.types.includes('text/plain')

  if (!isCurrentWindowDrag && !isExternalDrag) return

  // 窗口内拖拽使用 move
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }

  // 计算插入位置
  const tabElement = event.currentTarget as HTMLElement
  const rect = tabElement.getBoundingClientRect()
  const containerRect = tabContainer.value?.getBoundingClientRect()

  if (containerRect) {
    const mouseX = event.clientX
    const tabCenterX = rect.left + rect.width / 2

    // 判断插入到左侧还是右侧
    if (mouseX < tabCenterX) {
      dragInsertIndex.value = index
      dragInsertPosition.value = rect.left - containerRect.left
    } else {
      dragInsertIndex.value = index + 1
      dragInsertPosition.value = rect.right - containerRect.left
    }
  }
}

// 标签页容器拖拽悬停处理
const onTabContainerDragOver = (event: DragEvent) => {
  // 检查是否是当前窗口的标签页拖拽或外部拖拽
  const isCurrentWindowDrag = draggedTabId !== null
  const isExternalDrag = !isCurrentWindowDrag && event.dataTransfer?.types.includes('text/plain')

  if (!isCurrentWindowDrag && !isExternalDrag) return

  event.preventDefault()
  // 设置正确的 dropEffect 以支持窗口内拖拽
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

// 标签页容器放置处理（窗口内重排序和跨窗口拖拽）
const onTabContainerDrop = async (event: DragEvent) => {
  event.preventDefault()

  // Helper to reset drag state
  const resetDragState = () => {
    dragInsertIndex.value = -1
    dragInsertPosition.value = 0
  }

  if (dragInsertIndex.value === -1) {
    resetDragState()
    return
  }

  // 获取拖拽的标签页ID
  const draggedTabIdFromEvent = event.dataTransfer?.getData('text/plain')
  const finalDraggedTabId =
    draggedTabId || (draggedTabIdFromEvent ? parseInt(draggedTabIdFromEvent) : null)

  if (!finalDraggedTabId) {
    resetDragState()
    return
  }

  const currentWindowId = window.api.getWindowId()
  if (!currentWindowId) {
    resetDragState()
    return
  }

  try {
    // 检查是否是当前窗口的标签页
    const isFromCurrentWindow = tabStore.tabs.some((tab) => tab.id === finalDraggedTabId)

    if (isFromCurrentWindow) {
      // 窗口内重排序
      const draggedTabIndex = tabStore.tabs.findIndex((tab) => tab.id === finalDraggedTabId)
      if (draggedTabIndex === -1) {
        resetDragState()
        return
      }

      let targetIndex = dragInsertIndex.value

      // 如果拖拽到原位置，不需要重排序
      if (targetIndex === draggedTabIndex || targetIndex === draggedTabIndex + 1) {
        resetDragState()
        return
      }

      // 调整目标索引（如果拖拽到后面的位置，需要减1）
      if (targetIndex > draggedTabIndex) {
        targetIndex -= 1
      }

      // 创建新的标签页顺序
      const newTabs = [...tabStore.tabs]
      const [draggedTab] = newTabs.splice(draggedTabIndex, 1)
      newTabs.splice(targetIndex, 0, draggedTab)

      // 调用后端重排序方法，同步到主进程
      const newTabIds = newTabs.map((tab) => tab.id)
      const success = await tabStore.reorderTabs(newTabIds)
      if (!success) {
        console.error('Failed to reorder tabs')
      }
    } else {
      // 跨窗口拖拽
      console.log(
        'Cross-window drag detected:',
        finalDraggedTabId,
        'to window:',
        currentWindowId,
        'at index:',
        dragInsertIndex.value
      )

      // 调用主进程的 moveTab 方法
      const success = await tabPresenter.moveTab(
        finalDraggedTabId,
        currentWindowId,
        dragInsertIndex.value
      )
      if (success) {
        console.log('Tab moved successfully')
      } else {
        console.error('Failed to move tab')
      }
    }
  } catch (error) {
    console.error('Error during tab drop operation:', error)
  } finally {
    resetDragState()
  }
}

const handleDragOver = (event: DragEvent) => {
  // 只处理当前窗口的标签页拖拽
  if (!draggedTabId) return

  // 检查鼠标是否在标签页容器区域内
  const containerRect = tabContainer.value?.getBoundingClientRect()
  if (containerRect) {
    const isOverTabContainer =
      event.clientX >= containerRect.left &&
      event.clientX <= containerRect.right &&
      event.clientY >= containerRect.top &&
      event.clientY <= containerRect.bottom

    if (isOverTabContainer) {
      // 在标签页区域内，允许拖拽
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
    } else {
      // 在标签页区域外，设置为 none 以支持拖拽到窗口外
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'none'
      }
    }
  }
}

const handleDragEnd = async (event: DragEvent) => {
  console.log(
    'handleDragEnd',
    event.clientX,
    event.clientY,
    window.innerWidth,
    window.innerHeight,
    'dropEffect:',
    event.dataTransfer?.dropEffect
  )

  // 清理拖拽状态
  dragInsertIndex.value = -1

  if (tabStore.tabs.length <= 1) {
    event.preventDefault()
    draggedTabId = null
    return
  }

  // 检查是否拖拽到窗口外创建新窗口
  // 当 dropEffect 为 'none' 时，说明没有有效的放置目标
  if (draggedTabId && event.dataTransfer?.dropEffect === 'none') {
    // Check if the mouse is outside the window bounds or in non-droppable area
    const isOutsideWindow =
      event.clientX <= 0 ||
      event.clientY <= 0 ||
      event.clientX >= window.innerWidth ||
      event.clientY >= window.innerHeight

    if (isOutsideWindow) {
      console.log('Tab dragged outside window:', draggedTabId)
      // Call main process to move tab to new window
      await tabPresenter.moveTabToNewWindow(draggedTabId, event.clientX, event.clientY)
    }
  }
  draggedTabId = null
}

const onThemeClick = () => {
  console.log('onThemeClick')
  themeStore.cycleTheme()
}

onMounted(() => {
  console.log('onMounted', tabStore.tabs)
  // Listen for window maximize/unmaximize events
  devicePresenter.getDeviceInfo().then((deviceInfo) => {
    isMacOS.value = deviceInfo.platform === 'darwin'
  })
  ipcRenderer?.on('window:maximized', () => {
    isMaximized.value = true
  })
  ipcRenderer?.on('window-fullscreened', () => {
    isFullscreened.value = true
  })
  ipcRenderer?.on('window:unmaximized', () => {
    isMaximized.value = false
  })
  ipcRenderer?.on('window-unfullscreened', () => {
    isFullscreened.value = false
  })

  window.addEventListener('dragover', handleDragOver)
  window.addEventListener('dragend', handleDragEnd)
})

const openNewTab = () => {
  tabStore.addTab({
    name: 'New Tab',
    icon: 'lucide:plus',
    viewType: 'chat'
  })
  setTimeout(() => {
    nextTick(() => {
      if (endOfTabs.value) {
        console.log('newTabButton', endOfTabs.value)
        endOfTabs.value.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    })
  }, 300)
}

const scrollTabContainer = (direction: 'left' | 'right') => {
  if (tabContainerWrapper.value) {
    tabContainerWrapper.value.scrollTo({
      left: tabContainerWrapper.value.scrollLeft + (direction === 'left' ? -100 : 100),
      behavior: 'smooth'
    })
  }
}

// const openNewWindow = () => {
//   windowPresenter.createShellWindow({
//     initialTab: {
//       url: 'local://chat'
//     }
//   })
// }

const minimizeWindow = () => {
  const id = window.api.getWindowId()
  if (id != null) {
    windowPresenter.minimize(id)
  }
}

const toggleMaximize = () => {
  const id = window.api.getWindowId()
  if (id != null) {
    windowPresenter.maximize(id)
  }
}

const closeWindow = () => {
  const id = window.api.getWindowId()
  if (id != null) {
    windowPresenter.close(id)
  }
}

const openSettings = () => {
  // 检查是否已经存在设置标签页
  const existingSettingsTab = tabStore.tabs.find((tab) => tab.url.includes('#/settings'))

  if (existingSettingsTab) {
    // 如果已经存在设置标签页，切换到该标签页
    tabStore.setCurrentTabId(existingSettingsTab.id)
  } else {
    // 如果不存在设置标签页，创建新的
    tabStore.addTab({
      name: 'Settings',
      icon: 'lucide:settings',
      viewType: 'settings'
    })
  }
}
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

.window-no-drag-region {
  -webkit-app-region: no-drag;
}

button {
  -webkit-app-region: no-drag;
}

/* For Webkit-based browsers (Chrome, Safari, newer versions of Edge) */
.overflow-x-auto::-webkit-scrollbar {
  height: 4px;
  /* Adjust as needed for thickness */
}

.overflow-x-auto::-webkit-scrollbar-track {
  background: transparent;
  /* Or a very subtle color like #f1f1f1 or theme background */
}

.overflow-x-auto::-webkit-scrollbar-thumb {
  background: #a1a1aa;
  /* Scrollbar thumb color - zinc-400 */
  border-radius: 2px;
  /* Rounded corners for the thumb */
}

.overflow-x-auto::-webkit-scrollbar-thumb:hover {
  background: #71717a;
  /* Scrollbar thumb color on hover - zinc-500 */
}

/* For Firefox - already handled by inline style for simplicity, can also be moved here */
/*
.overflow-x-auto {
  scrollbar-width: thin;
  scrollbar-color: #a1a1aa transparent;
}
*/
</style>
