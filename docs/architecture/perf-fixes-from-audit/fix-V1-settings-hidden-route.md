# 修复 V1：Settings 隐藏路由 E2E 导航

## 目标
让 smoke 测试对 `hiddenInSidebar` 的 Settings 路由改用可复用的路由元信息决定导航方式，而不是依赖侧边栏 tab 点击，从而消除确定性失败。

## 定位
- [src/shared/settingsNavigation.ts#L88-L285](../../../src/shared/settingsNavigation.ts#L88-L285)：`SETTINGS_NAVIGATION_ITEMS` 完整定义了 Settings 路由矩阵，不只是“部分项”；其中包含 `path`、`routeName`、`hiddenInSidebar`、平台支持等测试所需元信息。
- [src/shared/settingsNavigation.ts#L163-L170](../../../src/shared/settingsNavigation.ts#L163-L170)：`settings-mcp` 明确配置 `path: '/mcp'` 且 `hiddenInSidebar: true`，说明该路由存在但不会出现在侧边栏。
- [src/shared/settingsNavigation.ts#L173-L180](../../../src/shared/settingsNavigation.ts#L173-L180)：`settings-remote` 同样 `hiddenInSidebar: true`，测试不能假设其 tab 一定可见。
- [src/shared/settingsNavigation.ts#L211-L220](../../../src/shared/settingsNavigation.ts#L211-L220)：`settings-plugins` 也是隐藏路由，并且带有平台支持限制，说明测试需要从路由定义层获取路径而不是从 UI 侧边栏猜测。
- [src/shared/settingsNavigation.ts#L222-L229](../../../src/shared/settingsNavigation.ts#L222-L229)：`settings-skills` 同样隐藏在侧边栏之外。
- [src/shared/settingsNavigation.ts#L333-L342](../../../src/shared/settingsNavigation.ts#L333-L342)：`getSettingsRouteItems()` 会返回受平台过滤后的完整路由集合，`getSettingsNavigationItems()` 才会进一步过滤 `hiddenInSidebar`；这说明测试优先复用现有 shared 导出即可判断某个 route 是否应出现在侧边栏。
- [src/shared/settingsNavigation.ts#L358-L389](../../../src/shared/settingsNavigation.ts#L358-L389)：`resolveSettingsNavigationPath()` 已能基于 `routeName` 和参数解析实际路由 path，可直接作为测试侧 hash 直达的路径来源。
- [src/renderer/settings/App.vue#L37-L47](../../../src/renderer/settings/App.vue#L37-L47)：侧边栏按钮只会为 `group.items` 渲染 `data-testid=settings-tab-*`，并通过点击触发 `handleClick(setting.path)`；隐藏项不在 `group.items`，因此不会有按钮可点。
- [src/renderer/settings/App.vue#L520-L521](../../../src/renderer/settings/App.vue#L520-L521)：`handleClick(path)` 实际就是 `router.push(path)`，说明测试若能拿到 path，走路由直达与 UI 点击在导航语义上是一致的。
- [test/e2e/helpers/settings.ts#L52-L56](../../../test/e2e/helpers/settings.ts#L52-L56)：`openSettingsTab()` 先执行 `toBeVisible()` 再 click，遇到隐藏路由时会稳定超时。
- [test/e2e/specs/04-settings-navigation.smoke.spec.ts#L9-L96](../../../test/e2e/specs/04-settings-navigation.smoke.spec.ts#L9-L96)：`settingsPages` 是当前 smoke 的完整导航矩阵，其中包含 `mcp / remote / plugins / skills` 等隐藏路由，而不是只列出侧边栏可见页。
- [test/e2e/specs/04-settings-navigation.smoke.spec.ts#L125-L142](../../../test/e2e/specs/04-settings-navigation.smoke.spec.ts#L125-L142)：`openAndCaptureSettingsPage()` 已经有 `optional` 分支，说明这里适合继续扩展“是否走侧边栏”的判断。
- [test/e2e/specs/04-settings-navigation.smoke.spec.ts#L158-L164](../../../test/e2e/specs/04-settings-navigation.smoke.spec.ts#L158-L164)：同文件已经存在直接写 `window.location.hash` 的路由导航先例，说明 smoke 本身可以接受 hash 直达。

根因：`hiddenInSidebar: true` 的路由不渲染侧边栏按钮，但 `openSettingsTab()` 仍然假设每个 settings item 都能通过 `toBeVisible()` 找到并点击，因此对 `mcp / remote / plugins / skills` 等隐藏路由会稳定失败。

## 修复方案
推荐方案：把“是否需要侧边栏点击”这件事放进测试辅助层，并优先复用现有 shared navigation 导出，而不是先新增 hidden 判定 API。

### 推荐实现
1. 优先在 E2E 侧复用 [src/shared/settingsNavigation.ts](../../../src/shared/settingsNavigation.ts) 已有的 `getSettingsRouteItems()` 与 `resolveSettingsNavigationPath()`：
   - 用 `getSettingsRouteItems(platform?, arch?)` 获取受平台过滤后的完整路由集合。
   - 根据现成的 `hiddenInSidebar` / `path` 字段判断该 route 应走侧边栏点击还是 hash 直达。
   - 用 `resolveSettingsNavigationPath(routeName, params?, platform?, arch?)` 生成实际导航 path，避免测试硬编码字符串。
   - 先确认 Playwright E2E 侧可以直接导入 shared 模块；只有在导入约束无法满足时，才考虑补充更窄的新导出。
2. 在 `test/e2e/helpers/settings.ts` 将 `openSettingsTab()` 扩展为支持两种导航：
   - 非隐藏项：继续按现有逻辑，等待 `data-testid` 可见后点击侧边栏按钮。
   - 隐藏项：用 `resolveSettingsNavigationPath(routeName, params?, platform?, arch?)` 生成 path，再执行 `settingsPage.evaluate((hash) => { window.location.hash = hash }, '#' + path)`，随后等待目标 `pageTestId` 可见。
3. 为了避免测试侧重复维护 route/path 映射，建议 `openSettingsTab()` 或其上层 helper 接收可关联到 `routeName` 的参数，并在 helper 内部统一反查 shared navigation 配置。
4. `test/e2e/specs/04-settings-navigation.smoke.spec.ts` 继续保持 `settingsPages` 矩阵，但把 `openAndCaptureSettingsPage()` 改成传入 `routeName` 或其他可反查 shared route 元信息的字段；对于 `mcp / remote / plugins / skills` 走 hash，其余项继续走点击。

### 备选方案
- **备选 A：只在 spec 里为 hidden 路由写 `window.location.hash` 分支。** 实现最直接，但逻辑分散在测试文件里，后续新增 hidden 路由时容易漏改，不如 helper 统一封装。
- **备选 B：在 `openSettingsTab()` 内部先判断 `tab.count()`，若不存在就用 `path` hash 导航。** 改动最小，但如果 `path` 只来自测试常量，会带来重复维护；仍应尽量从 shared navigation 反查，而不是在 spec 内手写路径。
- **备选 C：新增 hidden 判定 API。** 只有在 E2E 无法稳定复用现有 `getSettingsRouteItems()` / `resolveSettingsNavigationPath()` 导出时再考虑；当前不是首选。

### 取舍结论
建议采用“优先复用 shared navigation 现有导出 + helper 统一切换导航方式”的组合：
- 保证唯一事实来源来自 `src/shared/settingsNavigation.ts`。
- 让 smoke spec 仍然只关心页面矩阵和截图，不把路由规则散落到测试逻辑里。
- 避免继续依赖 `toBeVisible()` 去等待一个本来就不会出现的按钮。
- 复用 `resolveSettingsNavigationPath()` 后，测试与 `App.vue` 的 `router.push(path)` 保持同一导航语义。

## 步骤拆分
1. 先确认 `test/e2e` 可直接导入 [src/shared/settingsNavigation.ts](../../../src/shared/settingsNavigation.ts) 的 `getSettingsRouteItems()` / `resolveSettingsNavigationPath()`，并据此拿到 `hiddenInSidebar` 与实际 path。
2. 在 `test/e2e/helpers/settings.ts` 改造 `openSettingsTab()`：隐藏路由使用 `window.location.hash` 直达，非隐藏路由保留 tab click。
3. 在 `test/e2e/specs/04-settings-navigation.smoke.spec.ts` 让 `openAndCaptureSettingsPage()` 传入 route 元信息，确保 `mcp / remote / plugins / skills` 不再走 `toBeVisible()` 等待侧边栏按钮。
4. 补充/更新 smoke 相关断言，确认 hash 导航后目标 `pageTestId` 可见且截图路径不变。
5. 如实测发现 shared 导入在 E2E bundling / tsconfig 侧不可用，再补最小必要适配；只有此时才考虑新增更窄的辅助导出。

## 验证
- 主验证命令：`pnpm exec playwright test -c test/e2e/playwright.config.ts 04-settings-navigation --reporter=list`
- 预期：当前稳定失败点从 `openSettingsTab()` 的 `toBeVisible()` 超时变为通过，`mcp / remote / plugins / skills` 都能被正确打开并截图。
- 回归范围以现有证据为准：
  - `04-settings-navigation` 全矩阵必须重跑，因为 [test/e2e/specs/04-settings-navigation.smoke.spec.ts#L9-L96](../../../test/e2e/specs/04-settings-navigation.smoke.spec.ts#L9-L96) 本身覆盖了隐藏与非隐藏 Settings 页面。
  - 再补跑实际包含 hidden Settings 路由的 spec，例如 `13-mcp`、`11-remote`、`16-skills` 等 readonly route spec；具体命中文件与覆盖深度需要以实际执行结果确认，不再预设 06 / 11 / 13 / 16 / 19 这类无证据全集。
- 静态检查：完成实现后再跑 `pnpm run typecheck`、`pnpm run lint`，确保 shared 导出和 E2E helper 类型一致。

## 风险
- 如果 `openSettingsTab()` 改成 hash 导航后，某些页面状态初始化依赖点击事件而不是路由变更，可能需要补一小段等待逻辑，但从现有 `window.location.hash` 先例看风险可控。
- `plugins` 在 [src/shared/settingsNavigation.ts#L211-L220](../../../src/shared/settingsNavigation.ts#L211-L220) 中有平台支持限制，当前 `optional` 只明确覆盖了它；其余 hidden 项虽然未声明平台限制，但也没有额外平台兜底逻辑，后续若新增受限 hidden 路由，测试 helper 仍需同步处理支持矩阵。
- `pageTestId` 可见性的等待依赖目标路由组件已经完成注册与渲染；切到 hash 直达后，是否总能稳定命中对应 `pageTestId` 需要通过实跑验证，而不能只凭静态阅读假设。
- 如果 future 新增 hidden 路由但没有同步进 helper 所需的 route 元信息，仍可能出现测试维护偏差，因此 shared navigation 应保持测试和 UI 共用。
