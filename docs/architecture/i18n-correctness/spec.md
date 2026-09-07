# I18n 正确性与守门机制

## 背景

DeepChat 已支持 20 个 renderer locale，并通过按需加载只注册当前语言和 `en-US`
fallback。现有加载链路本身稳定，但 locale 元数据、原生菜单翻译、单个 locale 的 namespace
注册和插值变量没有统一事实来源或自动校验：

- 支持语言清单在 renderer、main、shared、Settings UI、agent tool 和 shared type 中重复；
- `src/shared/i18n.ts` 使用顺序相关的前缀遍历，导致 `zh-TW`、`zh-HK` 和部分区域语言匹配错误；
- 8 个 locale 的 `index.ts` 没有导出目录中已有的 JSON namespace；
- 多语言文案把 `{name}` 等插值变量翻译或拼错，造成变量值丢失或字面量占位符泄漏；
- 现有测试只覆盖 locale 加载和 fallback，没有覆盖资源注册与 message contract。

## 目标

1. 建立 shared locale manifest，统一支持语言、显示名称、方向和 locale 解析规则。
2. renderer、main、Settings UI、agent settings tool 与 shared types 从同一 manifest 派生。
3. 原生菜单按“规范化后的精确 locale”查询，并显式合并 `en-US` fallback。
4. 每个 locale 的 `index.ts` 注册目录内所有 JSON namespace。
5. 所有 locale 与 `en-US` 保持相同的 named interpolation contract；字面量花括号使用 Vue
   I18n literal interpolation 语法。
6. 增加无第三方运行时依赖的校验脚本和回归测试，在 CI/`pnpm run i18n` 中阻止上述问题回归。

## 非目标

- 本目标不批量删除静态分析得到的未引用 key。
- 不合并 `mcp.*` / `settings.mcp.*`、`common.*` / `settings.common.*` 等重复 namespace。
- 不处理一般性的未翻译英文、中文复制或所有 UI 硬编码文案。
- 不迁移或删除可能持久化在历史会话中的 legacy message key。
- 不改变 renderer locale chunk 的懒加载策略或用户语言设置的持久化格式。

## 验收标准

1. 20 个支持 locale 只在一个 shared manifest 中定义；其他模块不再维护平行 union/数组。
2. `resolveSupportedLocale()` 先精确匹配完整 locale，再使用明确的语言 fallback map；未知值回退
   `en-US`，中文 script/region 可区分简体、台湾繁体与香港繁体。
3. `getContextMenuLabels('zh-TW')` 返回繁体标签；`ja-JP`、`ko-KR`、`fr-FR` 返回现有本地化标签；
   缺少的原生菜单字段稳定回退英文。
4. locale namespace 校验对 20 个目录全部通过，并能在 fixture 中检测缺少 import/export。
5. 以 `en-US` 为 canonical 的 named interpolation 校验全部通过；所有当前不一致均被修正。
6. 字面量 `{query}` 在所有 locale 中不会被解析成 named interpolation。
7. main 与 renderer 定向测试、format、i18n、lint、typecheck 通过。

## 约束

- 保持 Vue I18n composition API、`legacy: false` 和当前 `en-US` runtime fallback。
- locale manifest 不导入 renderer 资源，避免 shared → renderer 的反向依赖。
- 原生菜单允许 locale map 不完整，但 API 必须返回与英文默认值合并后的完整结果。
- 校验脚本只使用 Node.js 标准库，确保安装依赖前也能执行结构检查。
- 不创建或同步 GitHub issue，不 push 分支。

## 兼容性与回滚

语言设置仍存储 `system` 或现有完整 locale code。显式保存的合法 locale 行为不变；非法或旧式 locale
会被规范化为支持值。renderer 仍加载同一批 locale chunk。

原生菜单只修正错误匹配，并为缺失字段提供英文 fallback，不删除现有翻译。回滚时可恢复旧 resolver
和重复清单；不涉及数据库迁移。
