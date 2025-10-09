<template>
  <div class="flex items-center justify-between w-full p-2">
    <div class="flex flex-row gap-2 items-center">
      <Button
        class="w-7 h-7 rounded-md"
        size="icon"
        variant="outline"
        @click="onSidebarButtonClick"
      >
        <Icon v-if="chatStore.isSidebarOpen" icon="lucide:panel-left-close" class="w-4 h-4" />
        <Icon v-else icon="lucide:panel-left-open" class="w-4 h-4" />
      </Button>
    </div>

    <div class="flex items-center gap-2">
      <Button
        class="w-7 h-7 rounded-md relative"
        size="icon"
        variant="outline"
        :class="{ 'bg-accent': chatStore.isMessageNavigationOpen }"
        @click="onMessageNavigationButtonClick"
      >
        <Icon icon="lucide:list" class="w-4 h-4" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { useChatStore } from '@/stores/chat'

const emit = defineEmits(['messageNavigationToggle'])

const chatStore = useChatStore()

const onSidebarButtonClick = () => {
  chatStore.isSidebarOpen = !chatStore.isSidebarOpen
}

// 新增的事件处理函数
const onMessageNavigationButtonClick = () => {
  emit('messageNavigationToggle')
}
</script>

<style scoped></style>
