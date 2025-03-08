<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import AppBar from './components/AppBar.vue'
import SideBar from './components/SideBar.vue'
import UpdateDialog from './components/ui/UpdateDialog.vue'
import { usePresenter } from './composables/usePresenter'
import ArtifactsPreview from './components/artifacts/ArtifactsPreview.vue'
import { useArtifactsPreview } from './composables/useArtifactsPreview'

const route = useRoute()
const configPresenter = usePresenter('configPresenter')
const router = useRouter()
const activeTab = ref(route.name as string || 'chat')

// 使用artifacts预览composable
const { 
  showArtifactsPreview, 
  currentArtifact, 
  closeArtifactsPreview,
  exposeGlobalMethods,
  setupKeyboardListener
} = useArtifactsPreview()

const getInitComplete = async () => {
  const initComplete = await configPresenter.getSetting('init_complete')
  if (!initComplete) {
    router.push({ name: 'welcome' })
  }
}

getInitComplete()

onMounted(() => {
  // 暴露artifacts预览的全局方法
  exposeGlobalMethods()
  
  // 设置键盘事件监听
  setupKeyboardListener()
  
  // 此处不需要监听路由变化，因为useArtifactsPreview中已经有监听了
  // 只监听activeTab的变化
  watch(
    () => activeTab.value,
    (newVal) => {
      router.push({ name: newVal })
      // 确保点击会话标签时关闭预览窗口
      if (newVal === 'chat') {
        closeArtifactsPreview()
      }
    }
  )

  watch(
    () => route.fullPath,
    (newVal) => {
      const pathWithoutQuery = newVal.split('?')[0]
      const newTab =
        pathWithoutQuery === '/'
          ? (route.name as string)
          : pathWithoutQuery.split('/').filter(Boolean)[0] || ''
      if (newTab !== activeTab.value) {
        activeTab.value = newTab
      }
    }
  )
})
</script>

<template>
  <div class="flex flex-col h-screen">
    <AppBar />
    <div class="flex flex-row h-0 flex-grow">
      <!-- 侧边导航栏 -->
      <SideBar 
        v-show="route.name !== 'welcome'" 
        v-model:model-value="activeTab" 
        class="h-full"
      />

      <!-- 主内容区域 -->
      <div class="flex-1 w-0 h-full flex">
        <!-- RouterView占用剩余的空间 -->
        <div :class="showArtifactsPreview ? 'w-[calc(50%+104px)]' : 'flex-1'">
          <RouterView />
        </div>
        
        <!-- Artifacts预览窗口占用一半空间(减去ThreadsView的宽度的一半) -->
        <div 
          v-if="showArtifactsPreview" 
          class="w-[calc(50%-104px)] border-l border-border h-full"
          @click="closeArtifactsPreview"
        >
          <ArtifactsPreview 
            :artifact="currentArtifact" 
            @close="closeArtifactsPreview" 
          />
        </div>
      </div>
    </div>
    <!-- 全局更新弹窗 -->
    <UpdateDialog />
  </div>
</template>

<style></style>
