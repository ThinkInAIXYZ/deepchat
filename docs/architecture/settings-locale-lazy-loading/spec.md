# Renderer 语言包按需加载

## 背景

`src/renderer/src/i18n/index.ts` 静态导入全部 20 个语言包，主窗口和 Settings
renderer 的入口又都同步导入该聚合对象。翻译资源约 5.4 MB，因此打开 Settings 时，即使用户只使用
一个语言，也要解析所有语言资源；同时主窗口的静态导入会让构建器保留共享同步 chunk，单独修改
Settings 入口无法稳定拆包。

语言 store 当前还会先切换 `locale`，再由现有全量 messages 隐式保证文案存在。改为动态加载后，必须
明确保证 messages 注册完成后才发布 locale，并处理快速连续切换产生的异步竞态。

## 目标

1. 主窗口、Settings 和 floating renderer 启动时只加载当前 locale 与 `en-US` fallback，不再同步加载
   全部语言。
2. 其余语言通过明确的 loader registry 生成独立异步 chunk，并在首次使用后复用加载结果。
3. renderer 挂载前读取主进程解析后的语言状态并完成首屏语言注册，避免默认语言闪烁或缺失 key。
4. 运行时切换语言时先加载、注册 messages，再切换全局 locale；较早请求不得覆盖较新的请求。
5. IPC 或当前语言加载失败时仍能使用本地 fallback 启动，不阻塞应用挂载。
6. 保留现有复数规则、RTL 方向和 `system` 语言语义。

## 非目标

- 不拆分单个 locale 内部的功能域 JSON。
- 不更改翻译内容、支持语言清单、主进程语言解析规则或设置界面布局。
- 不新增网络请求；语言 chunk 仍来自应用打包资源。
- 不修改主进程 IPC contract 或持久化格式。

## 验收标准

1. `src/renderer/src/i18n` 不再存在静态聚合所有 locale messages 的入口。
2. 主窗口、Settings 和 floating renderer 使用同一套异步 bootstrap，并在 `app.mount()` 前得到可用
   i18n 实例。
3. 当前 locale 与 `en-US` fallback 在首屏可用；读取语言状态失败时至少以 `en-US` 正常启动。
4. 每个支持 locale 都可由 registry 加载；语言别名和未知 locale 有确定的规范化/fallback 行为。
5. 快速连续切换时只有最后一次状态可以更新 locale、requested language 与方向。
6. locale 加载失败不会把全局 locale 切到未注册 messages 的值。
7. 单元测试覆盖 loader 缓存、bootstrap fallback、切换竞态与 RTL；production build 显示 locale 为异步 chunk，
   Settings 同步入口不再包含全部语言资源。
8. format、i18n、lint、typecheck 与相关 renderer tests 通过。

## 约束

- 保持 Vue 3 Composition API、Pinia 和 `vue-i18n` legacy false 模式。
- loader registry 必须使用可被 Vite/Rollup 静态分析的显式动态 import。
- startup fallback 不依赖 IPC，也不能重新静态导入完整 messages 聚合。
- 不创建或同步 GitHub issue；此工作通过独立 PR 评审。

## 兼容性与回滚

语言设置仍由现有 `config.getLanguage` / `config.setLanguage` route 提供，数据格式不变。回滚时可恢复静态
messages 聚合和同步 `createI18n`；不会留下用户数据迁移或版本兼容负担。
