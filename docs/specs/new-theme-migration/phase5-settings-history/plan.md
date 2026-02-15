# Phase 5: Settings 和历史会话整合 - 实现计划

## 架构决策

### 决策 1: Settings 显示方案

**背景**: 需要确定 Settings 的显示方式。

**决策**: 使用**方案 C - 独立弹窗**。

**理由**:
- Settings 内容较多，不适合侧边栏的狭窄空间
- 弹窗模式不占用主界面空间
- 符合用户习惯（大多数应用使用弹窗设置）
- 实现简单，复用现有 Settings 组件

### 决策 2: Settings 弹窗实现方式

**背景**: 需要创建 Settings 弹窗。

**决策**: 使用 shadcn/ui 的 Dialog 组件包裹现有的 Settings 页面内容。

**结构**:
```
SettingsDialog
├── Dialog (shadcn/ui)
│   ├── DialogHeader
│   │   └── Settings Tabs (General/Models/MCP...)
│   └── DialogContent
│       └── SettingsContent (复用现有设置组件)
```

**理由**:
- 复用现有的设置组件，减少工作量
- shadcn Dialog 已集成主题和动画

### 决策 3: Settings 按钮位置

**背景**: Settings 按钮放在 WindowSideBar 左侧。

**决策**: 放在 Agent 按钮列的最下方，与其他功能按钮分开。

**布局**:
```
LeftColumn (48px)
├── AgentButtons (上部)
│   ├── All Agents
│   ├── ACP Agents
│   └── Local Models
├── Spacer (flex-1)
└── SettingsButton (底部)
```

**理由**:
- 设置是全局功能，与 Agent 选择区分开
- 底部位置符合常见设计模式

## 涉及的模块

### WindowSideBar
- **改动**: 添加 Settings 按钮
- **文件**: `src/renderer/src/components/WindowSideBar.vue`

### LeftAgentColumn
- **改动**: 添加 Settings 按钮
- **文件**: `src/renderer/src/components/LeftAgentColumn.vue`

### SettingsDialog（新建）
- **功能**: Settings 弹窗容器
- **文件**: 新建 `src/renderer/src/components/SettingsDialog.vue`

### 现有 Settings 组件
- **改动**: 确保可以被 Dialog 包裹使用
- **文件**: `src/renderer/settings/` 下的组件

## 事件流

### Settings 打开流程
```
用户点击 Settings 按钮
  ↓
LeftAgentColumn 触发 open-settings 事件
  ↓
WindowSideBar 接收事件，设置 showSettings = true
  ↓
SettingsDialog 显示
  ↓
加载现有设置配置
```

### Settings 关闭流程
```
用户点击关闭或取消
  ↓
SettingsDialog 关闭
  ↓
如有修改，询问是否保存
  ↓
WindowSideBar 设置 showSettings = false
```

## 组件设计

### LeftAgentColumn（更新后）
```vue
<template>
  <div class="flex flex-col h-full w-12">
    <!-- Agent 按钮 -->
    <div class="flex flex-col gap-1 p-1">
      <AgentButton 
        v-for="mode in modes" 
        :key="mode.id"
        :active="currentMode === mode.id"
        @click="selectMode(mode.id)"
      />
    </div>
    
    <!-- 占位 -->
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

### SettingsDialog
```vue
<script setup lang="ts">
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog'
import SettingsContent from '@/settings/components/SettingsContent.vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-4xl h-[80vh]">
      <DialogHeader>Settings</DialogHeader>
      <SettingsContent />
    </DialogContent>
  </Dialog>
</template>
```

## 与现有设置的整合

### 复用策略
1. 创建 `SettingsContent` 组件，提取 `src/renderer/settings/App.vue` 的核心内容
2. `settings/App.vue` 使用 `SettingsContent` 作为主内容
3. `SettingsDialog` 也使用 `SettingsContent`
4. 确保两者使用相同的设置 store

### Store 兼容性
- 现有设置使用 `configPresenter` 获取和保存配置
- `SettingsContent` 组件继续使用相同的接口
- 无需改动设置数据的存储方式

## 测试策略

### 单元测试
- SettingsDialog 组件测试
- Settings 按钮交互测试

### 集成测试
- Settings 打开/关闭流程
- 设置修改保存流程

### 手动测试
- [ ] Settings 按钮显示正确
- [ ] 点击打开 Settings 弹窗
- [ ] 所有设置项可用
- [ ] 设置修改可以保存
- [ ] 关闭弹窗返回主界面

## 文件变更清单

### 新建文件
1. `src/renderer/src/components/SettingsDialog.vue` - 设置弹窗
2. `src/renderer/settings/components/SettingsContent.vue` - 可复用的设置内容

### 修改文件
1. `src/renderer/src/components/LeftAgentColumn.vue` - 添加 Settings 按钮
2. `src/renderer/src/components/WindowSideBar.vue` - 整合 SettingsDialog
3. `src/renderer/settings/App.vue` - 使用 SettingsContent

## 历史会话确认

Phase 2 已完成历史会话整合，本 Phase 只需确认：
- [ ] 历史会话列表正常显示
- [ ] 点击会话可以打开聊天

如有问题，在 Phase 5 中修复。

## 进入最终验收的前置条件

- [ ] Settings 按钮工作正常
- [ ] Settings 弹窗功能完整
- [ ] 历史会话功能正常
- [ ] 代码质量检查通过
