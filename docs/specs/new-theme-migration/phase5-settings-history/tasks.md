# Phase 5: Settings 和历史会话整合 - 任务分解

## 任务清单

### 1. 研究现有 Settings 实现

**任务**: 了解当前 Settings 页面的实现

**详情**:
- [ ] 查看 `src/renderer/settings/` 目录结构
- [ ] 了解 Settings 页面如何加载和显示
- [ ] 了解设置数据如何获取和保存
- [ ] 确定如何复用 Settings 内容

**输出**: Settings 结构分析报告

**验收**:
- [ ] 清楚 Settings 页面结构
- [ ] 了解 settings presenter 接口

---

### 2. 创建 SettingsContent 组件

**任务**: 提取可复用的设置内容组件

**详情**:
- [ ] 新建 `src/renderer/settings/components/SettingsContent.vue`
- [ ] 从 `src/renderer/settings/App.vue` 提取核心内容
- [ ] 保留所有设置功能:
  - General 设置
  - Models 设置
  - MCP 设置
  - 其他设置页面
- [ ] 确保不依赖特定的容器布局

**验收**:
- [ ] 组件可以独立使用
- [ ] 所有设置功能正常工作

---

### 3. 更新 settings/App.vue 使用 SettingsContent

**任务**: 让现有 Settings 页面使用新的组件

**详情**:
- [ ] 修改 `src/renderer/settings/App.vue`
- [ ] 导入并使用 SettingsContent
- [ ] 保留窗口标题和其他框架

**验收**:
- [ ] 原有 Settings 窗口功能正常
- [ ] 使用 SettingsContent 组件

---

### 4. 创建 SettingsDialog 组件

**任务**: 实现设置弹窗

**详情**:
- [ ] 新建 `src/renderer/src/components/SettingsDialog.vue`
- [ ] 使用 shadcn Dialog 组件
- [ ] 整合 SettingsContent
- [ ] 设置合适的弹窗尺寸（max-w-4xl, h-[80vh]）
- [ ] 实现 open/close 控制

**Props**:
```typescript
interface Props {
  open: boolean
}
```

**Emits**:
```typescript
interface Emits {
  'update:open': [value: boolean]
}
```

**验收**:
- [ ] 弹窗可以打开和关闭
- [ ] SettingsContent 正确显示
- [ ] 弹窗尺寸合适

---

### 5. 修改 LeftAgentColumn 添加 Settings 按钮

**任务**: 在左侧栏添加设置按钮

**详情**:
- [ ] 修改 `src/renderer/src/components/LeftAgentColumn.vue`
- [ ] 在 Agent 按钮列下方添加 spacer
- [ ] 在底部添加 Settings 按钮（齿轮图标）
- [ ] 点击触发 `open-settings` 事件

**布局更新**:
```vue
<template>
  <div class="flex flex-col h-full w-12">
    <!-- Agent 按钮列 -->
    <div class="flex flex-col gap-1 p-1">
      <!-- ... -->
    </div>
    
    <!-- Spacer -->
    <div class="flex-1" />
    
    <!-- Settings 按钮 -->
    <div class="p-1">
      <Button 
        variant="ghost" 
        size="icon"
        @click="$emit('open-settings')"
      >
        <Settings class="h-5 w-5" />
      </Button>
    </div>
  </div>
</template>
```

**验收**:
- [ ] Settings 按钮显示在底部
- [ ] 点击触发事件

---

### 6. 修改 WindowSideBar 整合 SettingsDialog

**任务**: 在 WindowSideBar 中整合设置弹窗

**详情**:
- [ ] 修改 `src/renderer/src/components/WindowSideBar.vue`
- [ ] 导入 SettingsDialog
- [ ] 添加 `showSettings` 状态
- [ ] 处理 `open-settings` 事件
- [ ] 传递 open 状态给 SettingsDialog

**代码**:
```vue
<script setup>
import { ref } from 'vue'
import SettingsDialog from './SettingsDialog.vue'

const showSettings = ref(false)
</script>

<template>
  <!-- ... 现有布局 ... -->
  
  <SettingsDialog v-model:open="showSettings" />
</template>
```

**验收**:
- [ ] 点击 Settings 按钮打开弹窗
- [ ] 弹窗关闭后返回主界面

---

### 7. 添加 i18n 支持

**任务**: Settings 按钮和弹窗使用 i18n

**详情**:
- [ ] 添加键值:
  - `sidebar.settings.tooltip`
  - `settings.dialog.title`
- [ ] 更新 LeftAgentColumn 使用 i18n
- [ ] 更新 SettingsDialog 使用 i18n

**验收**:
- [ ] 所有文本通过 i18n 获取
- [ ] 中英文显示正确

---

### 8. 确认历史会话功能

**任务**: 验证 Phase 2 的历史会话实现

**详情**:
- [ ] 启动应用，检查右侧历史会话列表
- [ ] 验证历史会话按时间分组
- [ ] 验证点击会话打开对应聊天
- [ ] 如有问题，记录并修复

**验收**:
- [ ] 历史会话列表正常显示
- [ ] 点击会话可以打开聊天

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
- [ ] 所有现有测试通过
- [ ] 新增测试通过（如添加了组件测试）

---

### 11. 手动验收测试

**任务**: 手动验证所有功能

**详情**:
- [ ] WindowSideBar 左侧显示 Settings 按钮
- [ ] Settings 按钮在 Agent 按钮下方
- [ ] 点击 Settings 按钮打开弹窗
- [ ] 弹窗显示所有设置项
- [ ] 可以修改设置
- [ ] 设置修改可以保存
- [ ] 关闭弹窗返回主界面
- [ ] 历史会话列表正常显示
- [ ] 点击历史会话打开对应聊天
- [ ] 当前会话高亮显示

**验收**:
- [ ] 所有手动测试项通过

---

## Phase 5 验收标准

Phase 5 完成的标准：

1. **Settings 功能**
   - [ ] Settings 按钮显示正确
   - [ ] Settings 弹窗功能完整
   - [ ] 所有设置项可用
   - [ ] 设置可以保存

2. **历史会话功能**
   - [ ] 历史会话列表正常显示
   - [ ] 点击会话可以打开聊天

3. **质量层面**
   - [ ] `pnpm run format` 通过
   - [ ] `pnpm run lint` 通过
   - [ ] `pnpm run typecheck` 通过
   - [ ] `pnpm test:renderer` 通过

4. **UI 层面**
   - [ ] i18n 支持完整
   - [ ] 深色/浅色主题正常

---

## 整体项目验收标准

所有 Phase 完成后，项目验收标准：

### 架构层面
- [ ] Shell 架构已移除
- [ ] WindowSideBar 整合到 Chat 页面
- [ ] NewThread 支持三模式
- [ ] Browser 地址栏已整合
- [ ] Settings 入口整合到侧边栏

### 功能层面
- [ ] Chat 窗口正常工作
- [ ] Browser 窗口正常工作
- [ ] 三模式切换功能完整
- [ ] Session 管理功能工作
- [ ] 历史会话功能工作
- [ ] Settings 功能工作

### 质量层面
- [ ] `pnpm run format` 通过
- [ ] `pnpm run lint` 通过
- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm test` 通过（main + renderer）

### 文档层面
- [ ] 如有需要，更新用户文档
- [ ] 架构变更记录在 CHANGELOG

---

## 项目完成的前置条件

- [ ] 所有 5 个 Phase 完成
- [ ] 所有验收标准满足
- [ ] 代码审查通过
- [ ] 最终测试通过
