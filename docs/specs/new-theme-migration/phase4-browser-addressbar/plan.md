# Phase 4: Browser 地址栏整合 - 实现计划

## 架构决策

### 决策 1: 地址栏组件位置

**背景**: 需要在 Browser 页面添加地址栏。

**决策**: 创建独立的 BrowserChrome 组件，包含地址栏和 WebContentsView 容器。

**结构**:
```
BrowserView (页面)
└── BrowserChrome
    ├── AddressBar (地址栏)
    │   ├── BackButton
    │   ├── ForwardButton
    │   ├── RefreshButton
    │   ├── UrlInput
    │   └── NewTabButton (可选)
    └── WebViewContainer (WebContentsView 占位)
```

**理由**:
- 清晰的组件边界
- 便于独立测试
- 与原有 Browser 逻辑解耦

### 决策 2: WebContentsView 管理

**背景**: WebContentsView 仍在 Main process 中管理。

**决策**: BrowserChrome 只负责 UI，WebContentsView 的位置调整仍由 YoBrowserPresenter 处理。

**流程**:
1. BrowserChrome 渲染完成，获取容器尺寸
2. 通过 IPC 通知 Main process 调整 WebContentsView 位置和大小
3. 窗口 resize 时重复上述流程

**理由**:
- 保持现有 WebContentsView 管理逻辑
- Renderer 只负责 UI 层

### 决策 3: 导航状态同步

**背景**: 需要知道是否可以前进/后退。

**决策**: 通过 EventBus 监听 WebContents 的导航事件。

**事件**:
```typescript
BROWSER_EVENTS = {
  NAVIGATE: 'browser:navigate',
  CAN_GO_BACK: 'browser:can-go-back',
  CAN_GO_FORWARD: 'browser:can-go-forward',
  URL_CHANGED: 'browser:url-changed'
}
```

## 涉及的模块

### Browser 页面
- **改动**: 添加 BrowserChrome 组件
- **文件**: `src/renderer/src/views/BrowserView.vue` 或类似文件

### YoBrowserPresenter
- **改动**: 调整 WebContentsView 位置计算
- **文件**: `src/main/presenter/browser/YoBrowserPresenter.ts`

### 新建组件
- **BrowserChrome.vue**: 地址栏容器
- **AddressBar.vue**: 地址栏组件

## 事件流

### 地址导航流程
```
用户在地址栏输入 URL 并按 Enter
  ↓
调用 presenter.browser.navigate(url)
  ↓
Main process 加载 URL
  ↓
发送 URL_CHANGED 事件
  ↓
地址栏更新显示
```

### 后退/前进流程
```
用户点击后退按钮
  ↓
调用 presenter.browser.goBack()
  ↓
Main process 执行后退
  ↓
发送 NAVIGATE 事件
  ↓
地址栏更新
```

### 窗口 Resize 流程
```
窗口大小改变
  ↓
BrowserChrome 获取新尺寸
  ↓
通过 IPC 通知 Main process
  ↓
YoBrowserPresenter 调整 WebContentsView 位置
```

## IPC 接口

### Renderer → Main
```typescript
interface BrowserIPC {
  navigate(url: string): Promise<void>
  goBack(): Promise<void>
  goForward(): Promise<void>
  refresh(): Promise<void>
  setViewBounds(bounds: Rectangle): Promise<void>
}
```

### Main → Renderer (EventBus)
```typescript
interface BrowserEvents {
  'browser:url-changed': { url: string }
  'browser:can-go-back': { canGoBack: boolean }
  'browser:can-go-forward': { canGoForward: boolean }
  'browser:loading': { isLoading: boolean }
}
```

## 组件设计

### AddressBar
```vue
<script setup lang="ts">
const props = defineProps<{
  currentUrl: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
}>()

const emit = defineEmits<{
  navigate: [url: string]
  goBack: []
  goForward: []
  refresh: []
}>()

const urlInput = ref(props.currentUrl)
const onEnter = () => emit('navigate', urlInput.value)
</script>

<template>
  <div class="flex items-center gap-2 px-2 h-10 bg-background border-b">
    <Button 
      variant="ghost" 
      size="icon"
      :disabled="!canGoBack"
      @click="emit('goBack')"
    >
      <ArrowLeft class="h-4 w-4" />
    </Button>
    
    <Button 
      variant="ghost" 
      size="icon"
      :disabled="!canGoForward"
      @click="emit('goForward')"
    >
      <ArrowRight class="h-4 w-4" />
    </Button>
    
    <Button variant="ghost" size="icon" @click="emit('refresh')">
      <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': isLoading }" />
    </Button>
    
    <Input 
      v-model="urlInput"
      class="flex-1"
      @keyup.enter="onEnter"
    />
  </div>
</template>
```

### BrowserChrome
```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import AddressBar from './AddressBar.vue'

const currentUrl = ref('')
const canGoBack = ref(false)
const canGoForward = ref(false)
const isLoading = ref(false)
const webviewContainer = ref<HTMLElement>()

// IPC 调用和事件监听...
</script>

<template>
  <div class="flex flex-col h-full">
    <AddressBar
      :current-url="currentUrl"
      :can-go-back="canGoBack"
      :can-go-forward="canGoForward"
      :is-loading="isLoading"
      @navigate="handleNavigate"
      @go-back="handleGoBack"
      @go-forward="handleGoForward"
      @refresh="handleRefresh"
    />
    
    <div ref="webviewContainer" class="flex-1" />
  </div>
</template>
```

## 测试策略

### 单元测试
- AddressBar 组件测试
- BrowserChrome 组件测试

### 集成测试
- 导航流程测试
- 窗口 resize 测试

### 手动测试
- [ ] 地址栏显示正确
- [ ] 导航按钮工作
- [ ] URL 输入导航工作
- [ ] 页面加载状态同步

## 文件变更清单

### 新建文件
1. `src/renderer/src/components/browser/AddressBar.vue`
2. `src/renderer/src/components/browser/BrowserChrome.vue`

### 修改文件
1. `src/renderer/src/views/BrowserView.vue` - 整合 BrowserChrome
2. `src/main/presenter/browser/YoBrowserPresenter.ts` - 调整 WebContentsView 位置逻辑

## 依赖关系

- 依赖 Phase 1 完成（Browser 窗口直接创建）

## 进入 Phase 5 的前置条件

- [ ] 地址栏功能完整
- [ ] 导航功能工作正常
- [ ] 代码质量检查通过
