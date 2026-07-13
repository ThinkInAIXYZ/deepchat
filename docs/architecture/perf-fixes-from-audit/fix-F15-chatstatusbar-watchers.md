# 修复 F15：ChatStatusBar watcher 链去 deep + 同 tick 去重

## 目标
（移除 `deep:true` 带来的深层遍历，并在不打散现有职责边界的前提下减少 session 切换时的重复调度）

## 定位
- 问题代码：`src/renderer/src/components/chat/ChatStatusBar.vue:2297-2310`，watcher 依赖 `[hasActiveSession, isAcpAgent, () => agentStore.selectedAgentId, () => modelStore.initialized, () => modelStore.chatSelectableModelGroups]`，配置 `{ immediate: true, deep: true }`
- 问题代码：`src/renderer/src/components/chat/ChatStatusBar.vue:2312-2337`，permission watcher 依赖 `[() => sessionStore.activeSessionId, canSelectPermissionMode, () => draftStore.permissionMode]`，配置 `{ immediate: true }`
- 问题代码：`src/renderer/src/components/chat/ChatStatusBar.vue:2339-2359`，subagent watcher 依赖 `[() => sessionStore.activeSessionId, showSubagentToggle, () => sessionStore.activeSession?.subagentEnabled, () => draftStore.subagentEnabled]`，配置 `{ immediate: true }`
- 问题代码：`src/renderer/src/components/chat/ChatStatusBar.vue:2362-2375`，generation settings watcher 依赖 `[() => sessionStore.activeSessionId, () => sessionStore.activeSession?.providerId, () => sessionStore.activeSession?.modelId, () => draftModelSelection.value?.providerId, () => draftModelSelection.value?.modelId, () => isAcpAgent.value]`，配置 `{ immediate: true }`
- 问题代码：`src/renderer/src/components/chat/ChatStatusBar.vue:2377-2395`，ACP config watcher 依赖 `[() => sessionStore.activeSessionId, () => sessionStore.activeSession?.providerId, () => sessionStore.activeSession?.modelId, () => sessionStore.activeSession?.projectDir, () => agentStore.selectedAgentId, () => projectStore.selectedProject?.path, () => props.acpDraftSessionId, () => isAcpAgent.value]`，配置 `{ immediate: true }`
- 定义位置：`src/renderer/src/components/chat/ChatStatusBar.vue:1081` 导入 `scheduleStartupDeferredTask`
- 定义位置：`src/renderer/src/components/chat/ChatStatusBar.vue:1164-1171`，`permissionSyncToken`、`generationSyncToken`、`cancelAcpConfigSyncTask` 等同步守卫变量
- 定义位置：`src/renderer/src/components/chat/ChatStatusBar.vue:1357-1363`，`modelGroups` 直接读取 `modelStore.chatSelectableModelGroups`
- 定义位置：`src/renderer/src/components/chat/ChatStatusBar.vue:1448-1477`，`modelSettingsTarget` 的异步配置拉取 watcher 已采用 token 守卫
- 定义位置：`src/renderer/src/components/chat/ChatStatusBar.vue:1479-1497`，`normalizePermissionMode` 等权限相关逻辑
- 定义位置：`src/renderer/src/stores/modelStore.ts:893-931`，`chatSelectableModelGroups` 已定义为 computed，依赖 `providerStore.sortedProviders` / `providerStore.providers` 与 `enabledModels`
- 定义位置：`src/renderer/src/stores/ui/session.ts:282-283`，`activeSessionId` 为单一 `ref<string | null>`
- 定位补充：`test/renderer/components/ChatStatusBar.test.ts:1-2637`，已存在 `ChatStatusBar` 组件测试文件，可作为 watcher 行为回归测试载体

根因：
- 模型组 watcher 使用 `deep:true` 监听 `chatSelectableModelGroups`，会递归遍历 provider 分组与组内模型，放大常驻组件的响应成本。
- `chatSelectableModelGroups` 的结果不仅取决于数组引用是否替换，还取决于 provider 名称、排序、启用状态，以及 `enabledModels` 中组内模型内容；若仅依赖浅层数组引用，又没有一个被完整维护的 revision 信号，就会出现漏同步。
- `activeSessionId` 是 session 切换主驱动，但 generation watcher 与 ACP watcher 已各自承担不同同步职责；问题主要在于同一 tick 内重复排队，而不是必须把两个 watcher 合并成一个大 watcher。

## 修复方案
推荐采用“先补全 store 级浅层 revision，再在组件侧去 deep，并对异步同步做 coalescing”的保守方案。

### 1. 先在 modelStore 建立并全面维护 `chatSelectableModelGroupsRevision`
- `src/renderer/src/stores/modelStore.ts:893-931` 已确认存在 `chatSelectableModelGroups` 定义，因此不需要新增同名 computed；需要新增的是与它配套的浅层修订信号，例如 `chatSelectableModelGroupsRevision: Ref<number>`。
- 该 revision 必须作为**硬前置步骤**先落地，再修改 `ChatStatusBar.vue` watcher；否则去掉 `deep:true` 后会失去对组内深层变化的感知。
- revision 自增范围必须覆盖所有会影响 `chatSelectableModelGroups` 结果的路径，至少包括：
  - provider 名称变化（影响 `providerName`）
  - provider 排序变化（影响 `sortedProviders` / 展示顺序）
  - provider 启用状态变化（影响是否出现在结果中）
  - `enabledModels` 的 provider 组新增/删除
  - provider 组内模型新增/删除
  - provider 组内模型属性变化，只要会影响 `isChatSelectableModelType(model.type)` 或最终展示结果
- 由于 `chatSelectableModelGroups` 依赖 `providerStore.sortedProviders` / `providerStore.providers` 与 `enabledModels`，如果 revision 只在部分更新路径自增，例如只覆盖数组替换而漏掉 provider rename、enable toggle、或组内模型就地修改，就会让 watcher 在“结果已变但 revision 未变”的情况下漏判。

### 2. ChatStatusBar 模型组 watcher 改为监听浅层依赖
- 将 `src/renderer/src/components/chat/ChatStatusBar.vue:2297-2310` 的 watcher 从 `deep:true` 改为浅层监听。
- watcher 依赖应改为：`hasActiveSession`、`isAcpAgent`、`agentStore.selectedAgentId`、`modelStore.initialized`、`modelStore.chatSelectableModelGroupsRevision`（或等价且被完整维护的浅层信号）。
- `modelGroups` 的实际读取仍保持 `modelStore.chatSelectableModelGroups`，不需要改组件消费方式；revision 只负责提供低成本、可预测的变更触发信号。
- 不建议用 `length` 替代 revision，因为 provider 名称变化、排序变化、组内模型类型过滤变化都可能改变最终可选结果，却不改变顶层长度。

### 3. 保留 watcher 拆分，改做同 tick coalescing
- `src/renderer/src/components/chat/ChatStatusBar.vue:2362-2375` 的 generation watcher 与 `src/renderer/src/components/chat/ChatStatusBar.vue:2377-2395` 的 ACP watcher 目前职责边界清晰：前者负责生成设置同步，后者负责 ACP 配置同步。
- 本项不再把“合并 activeSessionId watcher”为默认方案；推荐保留拆分，避免把权限、生成设置、ACP 配置耦合成一个大型 watcher。
- 优先做的改动应是：
  - `syncGenerationSettings()` 增加同 tick coalescing / pending 门闩，保证多次触发只排队一次。
  - `syncAcpConfigOptions()` 保留现有 `cancelAcpConfigSyncTask?.()` + `scheduleStartupDeferredTask(...)` 的取消重建模型，并确认同一 tick 内不会重复创建无意义任务。
  - permission watcher、subagent watcher 保持现状，只在确有无变化重复写入时增加本地短路比较。
- 若后续 profiling 证明拆分 watcher 仍然是主要热点，再单独评估是否需要更上层的 session-scope scheduler；这不是本次修复的硬要求。

## 步骤拆分
1. **先**在 `modelStore` 增加 `chatSelectableModelGroupsRevision`，并把所有影响 `chatSelectableModelGroups` 结果的更新路径接通到 revision 自增。
2. 再修改 `ChatStatusBar.vue:2297-2310`，移除 `deep:true`，改监听 revision 等浅层依赖。
3. 为 `syncGenerationSettings()` 增加同 tick coalescing，复核 `syncAcpConfigOptions()` 的取消/重建去重路径。
4. 最后补测试，覆盖 revision 完整性与 watcher 去重行为。

## 验证
- 单元/组件测试：更新 `test/renderer/components/ChatStatusBar.test.ts`，至少覆盖：
  - 去掉 `deep:true` 后，revision 变化仍会触发 `syncDraftModelSelection()`。
  - provider rename / enable toggle / 排序变化会驱动 revision，自然带动 watcher 更新。
  - **组内模型变化但数组引用不变** 时，只要结果受影响，revision 仍会自增并触发同步。
  - session 切换时 generation watcher 与 ACP watcher 在同一 tick 内不会重复排队超出预期次数。
- store 测试（如已有合适测试载体）：增加针对 `chatSelectableModelGroupsRevision` 的覆盖，验证 `chatSelectableModelGroups` 依赖的 providerStore / `enabledModels` 更新路径不会漏 bump。
- typecheck/lint：如后续进入代码实现，执行仓库标准的 `pnpm run typecheck`、`pnpm run format`、`pnpm run i18n`、`pnpm run lint`。
- 可选本地验证：对 session 切换路径做一次 watcher 调度计数，确认本次优化目标是“去 deep + 同 tick 去重”，而不是改变最终同步结果。

## 风险
- 最大风险不是移除 `deep:true` 本身，而是 `chatSelectableModelGroupsRevision` 覆盖不全：`chatSelectableModelGroups` 同时依赖 `providerStore.sortedProviders` / `providerStore.providers` 与 `enabledModels`，任何一侧若有更新路径未自增 revision，都会造成漏判。
- 典型漏判场景包括：provider 名称修改、provider 启用状态切换、排序调整、组内模型类型变化、组内模型数组就地修改但外层数组引用未变。
- 若错误地把 generation watcher 与 ACP watcher 强行合并，虽然可能减少一次表面触发，但会把两个已经清晰分离的职责耦合起来，提升维护成本并放大回归面。
- `syncGenerationSettings()` 与 `syncAcpConfigOptions()` 都含异步流程，coalescing 必须与现有 token / cancel 守卫兼容，避免旧任务覆盖新状态。
- `test/renderer/components/ChatStatusBar.test.ts` 体量已较大，新增断言应优先验证最终行为与调用次数上界，避免把实现细节绑得过死。
