<template>
  <div class="flex items-center justify-end w-full p-2">
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
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import { useChatStore } from '@/stores/chat'

const emit = defineEmits(['messageNavigationToggle'])

const chatStore = useChatStore()

// 新增的事件处理函数
const onMessageNavigationButtonClick = () => {
  emit('messageNavigationToggle')
}
</script>

<style scoped></style>
