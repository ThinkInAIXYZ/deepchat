<script setup lang="ts">
import { onMounted, ref, watch, onBeforeUnmount, computed } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import AppBar from './components/AppBar.vue'
import SideBar from './components/SideBar.vue'
import UpdateDialog from './components/ui/UpdateDialog.vue'
import { usePresenter } from './composables/usePresenter'
import ArtifactDialog from './components/artifacts/ArtifactDialog.vue'
import { useArtifactStore } from './stores/artifact'
import { useChatStore } from '@/stores/chat'
import { NOTIFICATION_EVENTS, SHORTCUT_EVENTS } from './events' // Assuming events are defined here
import { useToast } from './components/ui/toast/use-toast' // Assuming shadcn-vue toast
import Toaster from './components/ui/toast/Toaster.vue' // Assuming shadcn-vue toaster
import { useSettingsStore } from '@/stores/settings'

// 获取 Vue Router 实例
const route = useRoute()
const router = useRouter()

// 获取 Pinia Store 和 Composables
const configPresenter = usePresenter('configPresenter') // 假设这是一个用于与后端通信的 composable
const artifactStore = useArtifactStore()
const chatStore = useChatStore()
const { toast } = useToast() // shadcn-vue toast hook
const settingsStore = useSettingsStore()

// 错误通知队列及当前正在显示的错误状态
interface ErrorNotification {
  id: string;
  title: string;
  message: string;
  type: string; // 可以是 'error', 'warning', 'info' 等
}

const errorQueue = ref<ErrorNotification[]>([]);
const isDisplayingError = ref(false); // 标记当前是否正在显示错误

// 根据当前路由路径计算激活的侧边栏 Tab
const activeTab = computed({
  get: () => {
    const pathSegments = route.path.split('/').filter(Boolean);
    // 如果是根路径，根据路由名称判断，否则取第一个路径段
    return route.path === '/' ? (route.name as string || 'chat') : pathSegments[0] || 'chat';
  },
  set: (newTab) => {
    // 当侧边栏 Tab 改变时，导航到对应的路由
    if (newTab !== activeTab.value) {
      router.push({ name: newTab }).catch(err => {
        console.error('导航到新 Tab 失败:', err);
        // 可选：显示错误通知
        // showErrorToast({ id: 'navigation-error', title: '导航失败', message: `无法导航到 ${newTab}`, type: 'error' });
      });
    }
  }
});


// 监听主题和字体大小变化，直接更新 documentElement class
// 使用 immediate: true 确保在组件挂载后立即应用初始设置
watch(
  [() => settingsStore.theme, () => settingsStore.fontSizeClass],
  ([newTheme, newFontSizeClass], [oldTheme, oldFontSizeClass]) => {
    const htmlEl = document.documentElement;
    if (oldTheme) {
      htmlEl.classList.remove(oldTheme);
    }
    if (oldFontSizeClass) {
      htmlEl.classList.remove(oldFontSizeClass);
    }
    htmlEl.classList.add(newTheme);
    htmlEl.classList.add(newFontSizeClass);
  },
  { immediate: true } // 在组件挂载后立即执行一次
);

// 处理错误通知，将错误添加到队列并尝试显示
const showErrorToast = (error: ErrorNotification) => {
  // 查找队列中是否已存在相同ID的错误，防止重复添加
  const existingErrorIndex = errorQueue.value.findIndex((e) => e.id === error.id);

  if (existingErrorIndex === -1) {
    // 将新错误添加到队列头部，确保最新错误优先显示（或者尾部，取决于需求）
    // 这里选择添加到尾部，按顺序显示
    errorQueue.value.push(error);
    console.log(`[App] 错误添加到队列: ${error.id}. 当前队列长度: ${errorQueue.value.length}`);

    // 如果当前没有错误正在展示，则立即显示队列中的第一个错误
    if (!isDisplayingError.value) {
      displayNextError();
    }
  } else {
      console.log(`[App] 错误已存在于队列中，忽略: ${error.id}`);
  }
};

// 显示队列中的下一个错误
const displayNextError = () => {
  if (errorQueue.value.length > 0 && !isDisplayingError.value) {
    isDisplayingError.value = true;
    const nextError = errorQueue.value.shift(); // 从队列头部取出下一个错误

    if (nextError) {
      console.log(`[App] 开始显示错误: ${nextError.id}`);
      // 显示错误通知
      toast({
        title: nextError.title,
        description: nextError.message,
        variant: 'destructive', // 使用 destructive 变体表示错误
        duration: 5000, // 设置默认显示时长，单位毫秒
        onOpenChange: (open) => {
          if (!open) {
            // 当 toast 关闭时（无论自动还是手动），处理下一个错误
            console.log(`[App] 错误 toast 关闭: ${nextError.id}`);
            isDisplayingError.value = false; // 标记为不再显示错误
            // 延迟一小段时间再检查队列，避免快速连续弹窗
            setTimeout(displayNextError, 300);
          }
        },
      });
    } else {
       isDisplayingError.value = false; // 队列为空，确保状态正确
    }
  } else {
     console.log(`[App] 错误队列为空或正在显示错误，不执行显示`);
     isDisplayingError.value = false; // 队列为空，确保状态正确
  }
};


// 检查初始化是否完成，未完成则跳转到欢迎页
const checkInitComplete = async () => {
  try {
    const initComplete = await configPresenter.getSetting('init_complete');
    if (!initComplete) {
      console.log('[App] 初始化未完成，跳转到欢迎页');
      router.replace({ name: 'welcome' }); // 使用 replace 避免用户返回
    }
  } catch (error) {
    console.error('[App] 检查初始化状态失败:', error);
    // 可选：显示错误通知
    // showErrorToast({ id: 'init-check-error', title: '初始化检查失败', message: '无法加载应用配置。', type: 'error' });
  }
};

// 处理字体缩放快捷键
const handleZoomIn = () => {
  console.log('[App] 处理快捷键: 放大字体');
  settingsStore.updateFontSizeLevel(settingsStore.fontSizeLevel + 1);
};

const handleZoomOut = () => {
  console.log('[App] 处理快捷键: 缩小字体');
  settingsStore.updateFontSizeLevel(settingsStore.fontSizeLevel - 1);
};

const handleZoomResume = () => {
  console.log('[App] 处理快捷键: 重置字体');
  settingsStore.updateFontSizeLevel(1); // 1 对应 'text-base'，默认字体大小
};

// 处理创建新会话快捷键
const handleCreateNewConversation = () => {
  console.log('[App] 处理快捷键: 创建新会话');
  try {
    chatStore.createNewEmptyThread();
    // 导航到新的会话页面（如果需要）
    // router.push({ name: 'chat', params: { threadId: chatStore.activeThreadId } }); // 假设 chat 路由接受 threadId 参数
  } catch (error) {
    console.error('[App] 创建新会话失败:', error);
    showErrorToast({ id: 'create-chat-error', title: '创建会话失败', message: '无法创建新的对话。', type: 'error' });
  }
};

// 处理进入设置页面快捷键
const handleGoSettings = () => {
  console.log('[App] 处理快捷键: 进入设置');
  const currentRoute = router.currentRoute.value;
  // 检查当前路由或其父路由是否已经是settings，避免重复导航
  if (!currentRoute.path.startsWith('/settings')) {
    router.push({ name: 'settings' }).catch(err => {
       console.error('[App] 导航到设置失败:', err);
       // 可选：显示错误通知
       // showErrorToast({ id: 'go-settings-error', title: '导航失败', message: '无法导航到设置页面。', type: 'error' });
    });
  } else {
      console.log('[App] 已在设置页面，跳过导航');
  }
};

// 处理系统通知点击事件
const handleSystemNotificationClick = (_event: Electron.IpcRendererEvent, msg: any) => {
  console.log('[App] 接收到系统通知点击事件:', msg);
  let threadId: string | null = null;

  // 检查 msg 的格式，兼容不同的通知数据结构
  if (typeof msg === 'string' && msg.startsWith('chat/')) {
    // 格式如 'chat/threadId/messageId'
    const parts = msg.split('/');
    if (parts.length >= 2) { // 至少需要 'chat/threadId'
      threadId = parts[1];
    }
  } else if (msg && typeof msg === 'object' && msg.threadId) {
    // 兼容原有对象格式 { threadId: '...' }
    threadId = msg.threadId;
  }

  if (threadId) {
    console.log(`[App] 激活对话线程: ${threadId}`);
    chatStore.setActiveThread(threadId);
    // 导航到聊天页面（如果不在聊天页面）
    if (route.name !== 'chat') {
        router.push({ name: 'chat' }).catch(err => {
            console.error('[App] 导航到聊天页面失败:', err);
            // 可选：显示错误通知
            // showErrorToast({ id: 'nav-to-chat-error', title: '导航失败', message: '无法导航到聊天页面。', type: 'error' });
        });
    }
  } else {
      console.warn('[App] 系统通知点击事件未包含有效的 threadId');
  }
};


// 在组件挂载后执行
onMounted(() => {
  console.log('[App] 组件已挂载');

  // 检查初始化状态并决定是否跳转
  checkInitComplete();

  // 监听全局错误通知事件 (来自 Electron 主进程或其他地方)
  // 使用具体的监听函数引用，方便在 onBeforeUnmount 中移除
  window.electron.ipcRenderer.on(NOTIFICATION_EVENTS.SHOW_ERROR, showErrorToast);

  // 监听快捷键事件
  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.ZOOM_IN, handleZoomIn);
  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.ZOOM_OUT, handleZoomOut);
  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.ZOOM_RESUME, handleZoomResume);
  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.CREATE_NEW_CONVERSATION, handleCreateNewConversation);
  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.GO_SETTINGS, handleGoSettings);
  window.electron.ipcRenderer.on(NOTIFICATION_EVENTS.SYS_NOTIFY_CLICKED, handleSystemNotificationClick);


  // 监听当前对话变化，关闭 artifacts 页面
  watch(
    () => chatStore.activeThreadId,
    (newThreadId, oldThreadId) => {
      if (newThreadId !== oldThreadId) {
         console.log(`[App] 切换对话线程: ${oldThreadId} -> ${newThreadId}. 关闭 Artifacts.`);
        artifactStore.hideArtifact();
      }
    }
  );

  // 监听 Artifacts 页面打开状态，关闭侧边栏
  watch(
    () => artifactStore.isOpen,
    (isOpen) => {
      if (isOpen) {
        console.log('[App] Artifacts 页面打开，关闭侧边栏');
        chatStore.isSidebarOpen = false;
      }
    }
  );

   // 初始应用主题和字体大小 class (确保在 watch immediate: true 之前或同时执行)
   // 由于 watch 已经设置了 immediate: true，这里的 document.documentElement 上的添加可以移除或作为备用
   // document.documentElement.classList.add(settingsStore.theme);
   // document.documentElement.classList.add(settingsStore.fontSizeClass);

});

// 在组件卸载前清除定时器和事件监听
onBeforeUnmount(() => {
  console.log('[App] 组件即将卸载，清理监听器和定时器');

  // 移除 Electron IPC 监听器，使用具体的监听函数引用
  window.electron.ipcRenderer.removeListener(NOTIFICATION_EVENTS.SHOW_ERROR, showErrorToast);
  window.electron.ipcRenderer.removeListener(SHORTCUT_EVENTS.ZOOM_IN, handleZoomIn);
  window.electron.ipcRenderer.removeListener(SHORTCUT_EVENTS.ZOOM_OUT, handleZoomOut);
  window.electron.ipcRenderer.removeListener(SHORTCUT_EVENTS.ZOOM_RESUME, handleZoomResume);
  window.electron.ipcRenderer.removeListener(SHORTCUT_EVENTS.CREATE_NEW_CONVERSATION, handleCreateNewConversation);
  window.electron.ipcRenderer.removeListener(SHORTCUT_EVENTS.GO_SETTINGS, handleGoSettings);
  window.electron.ipcRenderer.removeListener(NOTIFICATION_EVENTS.SYS_NOTIFY_CLICKED, handleSystemNotificationClick);

  // 清理错误显示定时器 (如果存在)
  // 注意：这里的定时器逻辑已经被 displayNextError 的 onOpenChange 取代，理论上不需要手动清除
  // 但为了安全起见，保留清除逻辑
  // if (errorDisplayTimer.value) {
  //   clearTimeout(errorDisplayTimer.value);
  //   errorDisplayTimer.value = null;
  // }
});
</script>

<template>
  <div class="flex flex-col h-screen">
    <AppBar />

    <div class="flex flex-row h-0 flex-grow relative overflow-hidden">

      <SideBar
        v-show="route.name !== 'welcome'"
        v-model:model-value="activeTab"
        class="h-full z-10"
      />

      <div
        :class="{
          'flex-1 w-0 h-full transition-all duration-200': true,
          'mr-[calc(60%_-_104px)]': artifactStore.isOpen && route.name === 'chat' // 当 artifacts 打开且在聊天页时，为主内容区域留出空间
        }"
      >
        <RouterView />
      </div>

      <ArtifactDialog />
    </div>

    <UpdateDialog />

    <Toaster />
  </div>
</template>
