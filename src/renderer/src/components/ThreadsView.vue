<template>
  <div
    class="w-full h-full overflow-hidden p-2 space-y-3 flex-shrink-0 border-r flex flex-col bg-background"
  >
    <!-- 固定在顶部的"新会话"按钮 -->
    <div class="flex-none flex flex-row gap-2">
      <Button
        v-if="windowSize.width.value < 1024"
        variant="outline"
        size="icon"
        class="flex-shrink-0 text-xs justify-center h-7 w-7"
        @click="chatStore.isSidebarOpen = false"
      >
        <Icon icon="lucide:panel-left-close" class="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        class="w-0 flex-1 text-xs justify-start gap-2 h-7"
        @click="createNewThread"
      >
        <Icon icon="lucide:pen-line" class="h-4 w-4" />
        <span>{{ t('common.newChat') }}</span>
      </Button>
    </div>

    <!-- 可滚动的会话列表 - 使用动态虚拟滚动 -->
    <div class="flex-1 overflow-hidden">
      <DynamicScroller
        ref="dynamicScrollerRef"
        class="h-full"
        :items="flattenedThreads"
        :min-item-size="30"
        key-field="id"
        @scroll-end="handleScrollEnd"
      >
        <template v-slot="{ item, index, active }">
          <DynamicScrollerItem
            :item="item"
            :active="active"
            :size-dependencies="[item.data]"
            :data-index="index"
          >
            <!-- 日期标题 -->
            <div
              v-if="item.type === 'date'"
              class="text-xs font-bold text-muted-foreground px-2 py-2"
            >
              {{ item.data }}
            </div>

            <!-- 线程项 -->
            <div v-else-if="item.type === 'thread'" class="px-0 py-1">
              <ThreadItem
                :thread="item.data"
                :is-active="item.data.id === chatStore.getActiveThreadId()"
                :working-status="chatStore.getThreadWorkingStatus(item.data.id)"
                @select="handleThreadSelect"
                @rename="showRenameDialog(item.data)"
                @delete="showDeleteDialog(item.data)"
                @cleanmsgs="showCleanMessagesDialog(item.data)"
              />
            </div>

            <!-- 分隔间距 -->
            <div v-else-if="item.type === 'spacer'" class="h-3"></div>
          </DynamicScrollerItem>
        </template>
      </DynamicScroller>

      <!-- 加载状态提示 -->
      <div
        v-if="chatStore.threads.length === 0"
        class="text-xs text-center text-muted-foreground py-2"
      >
        {{ t('common.loading') }}
      </div>
    </div>
    <Dialog v-model:open="deleteDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('dialog.delete.title') }}</DialogTitle>
          <DialogDescription>
            {{ t('dialog.delete.description') }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="handleDeleteDialogCancel">{{
            t('dialog.cancel')
          }}</Button>
          <Button variant="destructive" @click="handleThreadDelete">{{
            t('dialog.delete.confirm')
          }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog v-model:open="renameDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('dialog.rename.title') }}</DialogTitle>
          <DialogDescription>{{ t('dialog.rename.description') }}</DialogDescription>
        </DialogHeader>
        <Input v-if="renameThread" v-model="renameThread.title" />
        <DialogFooter>
          <Button variant="outline" @click="handleRenameDialogCancel">{{
            t('dialog.cancel')
          }}</Button>
          <Button variant="default" @click="handleThreadRename">{{ t('dialog.confirm') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog v-model:open="cleanMessagesDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('dialog.cleanMessages.title') }}</DialogTitle>
          <DialogDescription>
            {{ t('dialog.cleanMessages.description') }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="handleCleanMessagesDialogCancel">{{
            t('dialog.cancel')
          }}</Button>
          <Button variant="destructive" @click="handleThreadCleanMessages">{{
            t('dialog.cleanMessages.confirm')
          }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'
import ThreadItem from './ThreadItem.vue'
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { Input } from '@/components/ui/input'
import { useChatStore } from '@/stores/chat'
import { CONVERSATION } from '@shared/presenter'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useWindowSize } from '@vueuse/core'
import { SHORTCUT_EVENTS } from '@/events'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'

const { t } = useI18n()
const chatStore = useChatStore()
const threadP = usePresenter('threadPresenter')
const dynamicScrollerRef = ref<InstanceType<typeof DynamicScroller> | null>(null)
const deleteDialog = ref(false)
const deleteThread = ref<CONVERSATION | null>(null)
const renameDialog = ref(false)
const renameThread = ref<CONVERSATION | null>(null)
const cleanMessagesDialog = ref(false)
const cleanMessagesThread = ref<CONVERSATION | null>(null)

// 加载更多状态 - 只用于防重复触发
let isLoadingMore = false
const hasMoreThreads = ref(true)

const windowSize = useWindowSize()

// 虚拟滚动项目类型定义
type VirtualScrollItem = {
  id: string
  type: 'date' | 'thread' | 'spacer'
  data: string | CONVERSATION | null
}

// 扁平化线程数据，用于虚拟滚动
const flattenedThreads = computed<VirtualScrollItem[]>(() => {
  const items: VirtualScrollItem[] = []

  chatStore.threads.forEach((thread, threadIndex) => {
    // 添加日期标题
    items.push({
      id: `date-${thread.dt}`,
      type: 'date',
      data: thread.dt
    })

    // 添加该日期下的所有线程
    thread.dtThreads.forEach((dtThread) => {
      items.push({
        id: `thread-${dtThread.id}`,
        type: 'thread',
        data: dtThread
      })
    })

    // 在组之间添加分隔间距(除了最后一组)
    if (threadIndex < chatStore.threads.length - 1) {
      items.push({
        id: `spacer-${thread.dt}`,
        type: 'spacer',
        data: null
      })
    }
  })

  return items
})

// 创建新会话
const createNewThread = async () => {
  try {
    await chatStore.createNewEmptyThread()
    chatStore.isSidebarOpen = false
    chatStore.isMessageNavigationOpen = false
  } catch (error) {
    console.error(t('common.error.createChatFailed'), error)
  }
}

// 选择会话
const handleThreadSelect = async (thread: CONVERSATION) => {
  try {
    await chatStore.setActiveThread(thread.id)
    if (windowSize.width.value < 1024) {
      chatStore.isSidebarOpen = false
      chatStore.isMessageNavigationOpen = false
    }
  } catch (error) {
    console.error(t('common.error.selectChatFailed'), error)
  }
}

// 重命名会话
const handleThreadRename = async () => {
  try {
    if (!renameThread.value) {
      return
    }
    await chatStore.renameThread(renameThread.value.id, renameThread.value.title)
  } catch (error) {
    console.error(t('common.error.renameChatFailed'), error)
  }

  renameDialog.value = false
  renameThread.value = null
}

const showDeleteDialog = (thread: CONVERSATION) => {
  deleteDialog.value = true
  deleteThread.value = thread
}

const handleDeleteDialogCancel = () => {
  deleteDialog.value = false
  deleteThread.value = null
}

// 删除会话 - 逻辑已移至主进程，此处仅触发
const handleThreadDelete = async () => {
  try {
    if (!deleteThread.value) {
      return
    }
    // 只需调用presenter方法，后续的UI更新（tab关闭/重置、列表刷新）
    // 将由主进程编排并通过事件广播回来。
    await threadP.deleteConversation(deleteThread.value.id)
  } catch (error) {
    console.error(t('common.error.deleteChatFailed'), error)
  }

  deleteDialog.value = false
  deleteThread.value = null
}

// 显示清空消息对话框
const showCleanMessagesDialog = (thread: CONVERSATION) => {
  cleanMessagesDialog.value = true
  cleanMessagesThread.value = thread
}

// 取消清空消息对话框
const handleCleanMessagesDialogCancel = () => {
  cleanMessagesDialog.value = false
  cleanMessagesThread.value = null
}

// 清空会话消息
const handleThreadCleanMessages = async () => {
  try {
    if (!cleanMessagesThread.value) {
      return
    }
    await chatStore.clearAllMessages(cleanMessagesThread.value.id)
  } catch (error) {
    console.error(t('common.error.cleanMessagesFailed'), error)
  }

  cleanMessagesDialog.value = false
  cleanMessagesThread.value = null
}

const showRenameDialog = (thread: CONVERSATION) => {
  renameDialog.value = true
  renameThread.value = thread
}

const handleRenameDialogCancel = () => {
  renameDialog.value = false
  renameThread.value = null
}

// 处理清除聊天历史
const handleCleanChatHistory = () => {
  if (chatStore.activeThread) {
    showCleanMessagesDialog(chatStore.activeThread)
  }
}

// 在组件挂载时加载会话列表
onMounted(async () => {
  // 初始化hasMoreThreads状态，默认为true，让用户可以尝试加载更多
  hasMoreThreads.value = true

  // 监听快捷键事件
  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.CLEAN_CHAT_HISTORY, () => {
    handleCleanChatHistory()
  })

  // 快捷键删除时弹出确认框
  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.DELETE_CONVERSATION, () => {
    if (chatStore.activeThread) {
      showDeleteDialog(chatStore.activeThread)
    }
  })
})

// 在组件卸载前移除事件监听
onBeforeUnmount(() => {
  // 移除清除聊天历史的事件监听
  window.electron.ipcRenderer.removeAllListeners(SHORTCUT_EVENTS.CLEAN_CHAT_HISTORY)
  // 确保快捷键监听被移除
  window.electron.ipcRenderer.removeAllListeners(SHORTCUT_EVENTS.DELETE_CONVERSATION)
})

const handleScrollEnd = async () => {
  // 如果正在加载或者没有更多会话，则不执行
  if (isLoadingMore || !hasMoreThreads.value) {
    return
  }

  try {
    isLoadingMore = true

    // 调用loadMoreThreads方法
    const result = await threadP.loadMoreThreads()

    // 更新是否还有更多会话的状态
    hasMoreThreads.value = result.hasMore

    // 如果没有更多会话了，可以在这里添加一些提示逻辑
    if (!result.hasMore) {
      console.log('所有会话已加载完成')
    }
  } catch (error) {
    console.error('加载更多会话失败:', error)
  } finally {
    isLoadingMore = false
  }
}
</script>

<style scoped>
/* 组件特定样式 */
</style>
