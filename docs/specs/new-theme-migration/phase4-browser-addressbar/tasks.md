# Phase 4: Browser 地址栏整合 - 任务分解

## 任务清单

### 1. 研究 Browser 页面现状

**任务**: 了解当前 Browser 页面的实现

**详情**:
- [ ] 查找 Browser 页面文件位置
- [ ] 了解当前 Browser 如何加载和显示
- [ ] 了解 YoBrowserPresenter 如何管理 WebContentsView
- [ ] 确定 BrowserChrome 的整合点

**输出**: 现状分析报告

**验收**:
- [ ] 清楚 Browser 页面结构
- [ ] 了解 WebContentsView 管理方式

---

### 2. 创建 AddressBar 组件

**任务**: 实现地址栏 UI 组件

**详情**:
- [ ] 新建 `src/renderer/src/components/browser/AddressBar.vue`
- [ ] 实现后退按钮（ArrowLeft 图标）
- [ ] 实现前进按钮（ArrowRight 图标）
- [ ] 实现刷新按钮（RefreshCw 图标，支持 loading 动画）
- [ ] 实现 URL 输入框
- [ ] 根据 props 禁用/启用按钮

**Props**:
```typescript
interface Props {
  currentUrl: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
}
```

**Emits**:
```typescript
interface Emits {
  navigate: [url: string]
  goBack: []
  goForward: []
  refresh: []
}
```

**验收**:
- [ ] 组件 UI 正确
- [ ] 按钮状态根据 props 变化
- [ ] URL 输入框可以编辑

---

### 3. 创建 BrowserChrome 组件

**任务**: 实现 Browser Chrome 容器

**详情**:
- [ ] 新建 `src/renderer/src/components/browser/BrowserChrome.vue`
- [ ] 整合 AddressBar 组件
- [ ] 实现 WebView 容器（div 占位）
- [ ] 实现容器尺寸获取和通知逻辑
- [ ] 监听窗口 resize 事件

**状态管理**:
```typescript
const currentUrl = ref('')
const canGoBack = ref(false)
const canGoForward = ref(false)
const isLoading = ref(false)
```

**验收**:
- [ ] 组件布局正确
- [ ] 可以获取容器尺寸
- [ ] resize 时更新尺寸

---

### 4. 更新 YoBrowserPresenter 支持视图位置调整

**任务**: 修改 YoBrowserPresenter 接收视图边界

**详情**:
- [ ] 修改 `src/main/presenter/browser/YoBrowserPresenter.ts`
- [ ] 添加 `setViewBounds(bounds: Rectangle)` 方法
- [ ] 调整 WebContentsView 的位置和大小
- [ ] 考虑地址栏高度（约 40px）

**接口**:
```typescript
setViewBounds(bounds: {
  x: number
  y: number  // 从地址栏下方开始
  width: number
  height: number
}): void
```

**验收**:
- [ ] 方法可以正确调整 WebContentsView 位置
- [ ] WebContentsView 显示在地址栏下方

---

### 5. 添加 Browser IPC 接口

**任务**: 确保 Browser 导航功能可通过 IPC 调用

**详情**:
- [ ] 检查现有的 Browser IPC 接口
- [ ] 确保以下方法可用:
  - `navigate(url: string)`
  - `goBack()`
  - `goForward()`
  - `refresh()`
  - `setViewBounds(bounds)`
- [ ] 如有必要，更新 preload 类型定义

**验收**:
- [ ] Renderer 可以调用所有导航方法

---

### 6. 添加 Browser 事件监听

**任务**: 监听 Browser 导航事件

**详情**:
- [ ] 在 BrowserChrome 中设置 EventBus 监听
- [ ] 监听事件:
  - `browser:url-changed` → 更新 currentUrl
  - `browser:can-go-back` → 更新 canGoBack
  - `browser:can-go-forward` → 更新 canGoForward
  - `browser:loading` → 更新 isLoading

**验收**:
- [ ] 导航事件正确更新 UI 状态

---

### 7. 整合 BrowserChrome 到 Browser 页面

**任务**: 修改 Browser 页面使用 BrowserChrome

**详情**:
- [ ] 找到 Browser 页面文件
- [ ] 导入 BrowserChrome 组件
- [ ] 替换现有布局
- [ ] 确保 WebContentsView 正确显示

**验收**:
- [ ] Browser 页面显示地址栏
- [ ] WebContentsView 显示在地址栏下方

---

### 8. 添加 i18n 支持

**任务**: 地址栏文本使用 i18n

**详情**:
- [ ] 添加键值:
  - `browser.addressBar.back`
  - `browser.addressBar.forward`
  - `browser.addressBar.refresh`
  - `browser.addressBar.placeholder`
- [ ] 更新 AddressBar 组件使用 i18n

**验收**:
- [ ] 所有文本通过 i18n 获取

---

### 9. 运行代码质量检查

**任务**: 确保代码质量

**详情**:
```bash
pnpm run format
pnpm run lint
pnpm run typecheck
```

**验收**:
- [ ] 格式化无问题
- [ ] Lint 无错误
- [ ] 类型检查通过

---

### 10. 执行测试套件

**任务**: 运行自动化测试

**详情**:
```bash
pnpm test:renderer
```

**验收**:
- [ ] 所有测试通过

---

### 11. 手动验收测试

**任务**: 手动验证功能

**详情**:
- [ ] 打开 Browser 窗口，地址栏显示
- [ ] 后退/前进按钮状态正确
- [ ] 输入 URL 并导航，页面加载
- [ ] 后退按钮工作
- [ ] 前进按钮工作
- [ ] 刷新按钮工作
- [ ] 页面加载时刷新按钮显示 loading
- [ ] 调整窗口大小，WebContentsView 正确调整

**验收**:
- [ ] 所有手动测试项通过

---

## Phase 4 验收标准

Phase 4 完成的标准：

1. **组件层面**
   - [ ] AddressBar 组件工作正常
   - [ ] BrowserChrome 组件工作正常

2. **功能层面**
   - [ ] 地址栏显示在 Browser 页面
   - [ ] 后退/前进/刷新功能工作
   - [ ] URL 输入导航工作
   - [ ] WebContentsView 位置和大小正确

3. **质量层面**
   - [ ] `pnpm run format` 通过
   - [ ] `pnpm run lint` 通过
   - [ ] `pnpm run typecheck` 通过
   - [ ] `pnpm test:renderer` 通过

---

## 进入 Phase 5 的前置条件

- [ ] Phase 4 所有任务完成
- [ ] Phase 4 所有验收标准满足
- [ ] 代码审查通过
