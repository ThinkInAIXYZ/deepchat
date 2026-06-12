# 实施计划

## 影响范围
- `src/renderer/settings/components/skills/SkillInstallDialog.vue`（唯一改动的组件）
- `src/renderer/src/i18n/*/settings.json`（文案）

不改动：主进程 `skillPresenter`、IPC 路由契约、preload。

## 设计
### 拖拽状态
在组件内维护 `dragActive`（`'folder' | 'zip' | null`）用于区分高亮哪个区域，避免引入额外依赖。`dragenter/dragover` 时 `preventDefault` 以允许 drop。

### drop 处理（统一函数 `handleDrop(e, zone)`）
1. `installing` 为真时忽略。
2. 取 `e.dataTransfer`。优先用 `items[i].webkitGetAsEntry()`：
   - `entry.isDirectory` → 取对应 `File`，`getPathForFile` 得路径 → `tryInstallFromFolder`。
   - `entry.isFile` 且扩展名 `.zip` → 取路径 → `tryInstallFromZip`。
   - 其他 → toast `dragInvalid`。
3. 只处理第一个有效项；多项或无效项给出错误。

### 路径获取
`window.api.getPathForFile(file)`（settings 渲染进程已暴露，参考 `KnowledgeFile.vue`）。

### 模板
folder / zip 两个 `<div>` 增加 `@dragenter/@dragover/@dragleave/@drop` 与基于 `dragActive` 的高亮 class；保留 `@click`。

## i18n
- 更新 `folderHint` / `zipHint` 文案体现「点击或拖拽」（en-US、zh-CN、zh-HK、zh-TW）。
- 移除已无意义的 `dragNotSupported`，新增 `dragInvalid`（所有语言，非中文用英文兜底）。
- 运行 `pnpm run i18n` 校验。

## 验证
`pnpm run format` → `pnpm run i18n` → `pnpm run lint` → `pnpm run typecheck`。
