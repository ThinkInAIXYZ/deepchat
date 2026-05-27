# Data Settings Danger Zone Entry

## User Story

用户在数据设置页查看常规数据操作时，Danger Zone 不应以三个高权重红色按钮长期占据页面注意力；只有主动进入重置流程后，才需要看到具体的破坏性重置类型。

## Acceptance Criteria

- Danger Zone 默认只显示一个低噪声的重置入口。
- 重置入口使用 outline/destructive text 风格，不使用大面积红色背景。
- 具体重置类型仍在确认弹窗中选择，包含聊天、知识库、配置和完全重置。
- 默认重置类型为聊天数据。
- 现有重置调用语义保持不变。

## Non-goals

- 不改变任何重置数据语义。
- 不新增 IPC、Presenter 方法或持久化格式。
- 不调整 YoBrowser、数据库修复、模型配置更新等相邻操作。
