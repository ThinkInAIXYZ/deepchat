<template>
  <div class="w-52 h-full bg-muted overflow-y-auto p-2 space-y-3 border-r">
    <div>
      <Button
        variant="outline"
        size="sm"
        class="w-full text-xs text-muted-foreground justify-start gap-2"
        @click="createNewThread"
      >
        <Icon icon="lucide:pen-line" class="h-4 w-4" />
        <span>{{ t('common.newChat') }}</span>
      </Button>
    </div>

    <ScrollArea ref="scrollAreaRef" class="space-y-3" @scroll="handleScroll">
      <!-- 最近 -->
      <div v-for="thread in chatStore.threads" :key="thread.dt" class="space-y-1.5 mb-3">
        <div class="text-xs font-bold text-secondary-foreground px-2">{{ thread.dt }}</div>
        <ul class="space-y-1.5">
          <ThreadItem
            v-for="dtThread in thread.dtThreads"
            :key="dtThread.id"
            :thread="dtThread"
            :is-active="dtThread.id === chatStore.activeThreadId"
            @select="handleThreadSelect"
            @rename="showRenameDialog(dtThread)"
            @delete="showDeleteDialog(dtThread)"
            @cleanmsgs="showCleanMessagesDialog(dtThread)"
          />
        </ul>
      </div>

      <!-- 加载状态提示 -->
      <div v-if="chatStore.isLoading" class="text-xs text-center text-muted-foreground py-2">
        {{ t('common.loading') }}
      </div>
    </ScrollArea>
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
import { ref, onMounted } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useChatStore } from '@/stores/chat'
import { CONVERSATION } from '@shared/presenter'

const { t } = useI18n()
const chatStore = useChatStore()
const threadP = usePresenter('threadPresenter')
const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null)
const deleteDialog = ref(false)
const deleteThread = ref<CONVERSATION | null>(null)
const renameDialog = ref(false)
const renameThread = ref<CONVERSATION | null>(null)
const cleanMessagesDialog = ref(false)
const cleanMessagesThread = ref<CONVERSATION | null>(null)

// 创建新会话
const createNewThread = async () => {
  try {
    await chatStore.clearActiveThread()
  } catch (error) {
    console.error(t('common.error.createChatFailed'), error)
  }
}

// 处理滚动事件
const handleScroll = async (event: Event) => {
  const target = event.target as HTMLElement
  const { scrollTop, scrollHeight, clientHeight } = target

  // 当滚动到距离底部 50px 时加载更多
  if (scrollHeight - scrollTop - clientHeight < 50 && !chatStore.isLoading && chatStore.hasMore) {
    await chatStore.loadThreads(Math.ceil(chatStore.threads.length / 20) + 1)
  }
}

// 选择会话
const handleThreadSelect = async (thread: CONVERSATION) => {
  try {
    await chatStore.setActiveThread(thread.id)
    // 确保在选择会话时关闭预览窗口
    if (window.closeArtifactsPreview) {
      window.closeArtifactsPreview()
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

// 删除会话
const handleThreadDelete = async () => {
  try {
    if (!deleteThread.value) {
      return
    }
    await threadP.deleteConversation(deleteThread.value.id)
    chatStore.loadThreads(1)
    if (chatStore.threads.length > 0 && chatStore.threads[0].dtThreads.length > 0) {
      chatStore.setActiveThread(chatStore.threads[0].dtThreads[0].id)
    } else {
      chatStore.createThread(t('common.newChat'), {
        systemPrompt: '',
        temperature: 0.7,
        contextLength: 1000,
        maxTokens: 2000,
        providerId: '',
        modelId: ''
      })
    }
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

// 在组件挂载时加载会话列表
onMounted(async () => {
  await chatStore.loadThreads(1)
})
</script>

<style scoped></style>
