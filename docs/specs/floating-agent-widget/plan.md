# 悬浮 DeepChat Agent 小部件实施计划

## 设计决策

1. 保留现有独立悬浮窗口入口，但将其内容从“按钮 + 外部悬浮聊天窗入口”收敛为“任务小部件”。
2. 小部件数据由主进程聚合，renderer 只负责展示和交互。
3. 仅复用 `agentSessionPresenter.getSessionList()` 与 `AgentRuntimePresenter` 的状态事件，不新增独立数据库表。
4. 点击会话时不再打开旧的 `FloatingChatWindow`，而是唤起主窗口并激活对应会话。

## 数据模型

新增共享类型：

- `FloatingWidgetSessionStatus`
- `FloatingWidgetSessionItem`
- `FloatingWidgetSnapshot`

状态来源：

- 会话列表：`agentSessionPresenter.getSessionList({ agentId: 'deepchat' })`
- 会话状态：`SessionWithState.status`
- 语言：`configPresenter.getLanguage()`

本地映射：

- `generating` -> `in_progress`
- `idle` -> `done`
- `error` -> `error`

## 事件流

### 初始化

1. 主进程创建悬浮窗口
2. 悬浮 renderer 通过 preload 拉取初始 snapshot + language
3. 主进程将当前 snapshot 推送给悬浮 renderer

### 会话同步

以下场景统一触发 `floatingButtonPresenter.refreshWidgetState()`：

- `agentSessionPresenter` 发出列表更新时
- `agentRuntimePresenter` 会话状态变化时
- 标题自动生成完成时

主进程刷新后向悬浮 renderer 发送最新 snapshot。

### 会话跳转

1. 悬浮 renderer 发送 `open-session(sessionId)`
2. 主进程选择目标 chat 窗口；若不存在则创建
3. 主进程调用 `agentSessionPresenter.activateSession(targetWebContentsId, sessionId)`
4. 主进程显示并聚焦目标窗口
5. 目标 renderer 收到 `SESSION_EVENTS.ACTIVATED` 后切换到对应 chat route

### 展开与折叠

1. 悬浮 renderer 发送 `set-expanded(boolean)`
2. 主进程更新悬浮窗口尺寸
3. 如果当前吸附在右侧，扩展时保持右边缘不动；左侧同理

### 拖拽与吸附

1. renderer 继续通过 preload 发送拖拽开始/移动/结束
2. 主进程按屏幕坐标移动窗口
3. 拖拽结束时取 `screen.getDisplayMatching(bounds)` 获取目标显示器
4. 将 X 吸附到该显示器工作区左右边缘之一，Y 仅做边界裁剪

## 测试策略

1. 主进程纯函数测试：
   - 会话排序 / 快照构建
   - 吸附与尺寸重定位
2. renderer store 测试：
   - `SESSION_EVENTS.ACTIVATED` 时主界面 route 同步到 chat
3. 手工验证：
   - 折叠态图标与计数切换
   - 展开态列表
   - 点击会话唤起主窗口
   - 多显示器拖拽吸附

## 风险与缓解

1. 风险：悬浮窗口不是常规 renderer 入口，没有现成全局 i18n
   - 缓解：在 floating entry 单独初始化 `vue-i18n`，语言由 preload 提供
2. 风险：动态尺寸与持久化窗口状态冲突
   - 缓解：仅复用持久化位置，启动时始终使用折叠尺寸
3. 风险：主进程激活会话后页面未切换到 chat
   - 缓解：补齐 `sessionStore` 对外部 `ACTIVATED` 事件的 route 同步
