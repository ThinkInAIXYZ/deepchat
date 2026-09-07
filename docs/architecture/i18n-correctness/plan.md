# 实施计划

## 1. Shared locale manifest

新增无 renderer 依赖的 shared locale 模块，导出：

- `SUPPORTED_LOCALES` 与 `SupportedLocale`
- `REQUESTED_LOCALES` 与 `RequestedLocale`
- locale 原生显示名称和 RTL 元数据
- exact lookup、language fallback map 和 `resolveSupportedLocale()`

renderer loader 继续保留显式 dynamic import registry，只从 manifest 取得 key union。main 的系统语言解析、
Settings 下拉选项、agent settings schema 和 `ChatLanguage` 类型改为派生使用。

中文 fallback 规则显式建模：

- `zh-Hans`、中国大陆及未知中文区域 → `zh-CN`
- `zh-Hant-TW`、台湾 → `zh-TW`
- `zh-Hant-HK`、香港/澳门 → `zh-HK`

其他语言的非默认区域通过 language fallback map 解析到当前支持的完整 locale。

## 2. Native menu translation resolution

将 `src/shared/i18n.ts` 的 base-language key 统一为完整 locale key，删除独立
`supportedLocales` 和顺序相关的 `startsWith()` 遍历。

`getBestMatchTranslation()` 使用 shared resolver 得到精确 locale，并按以下顺序合并：

1. `en-US` 完整默认值；
2. 可选的 locale-specific fallback（例如没有单独 native map 的 `zh-HK` 使用 `zh-TW`）；
3. 当前 locale map。

这样 partial map 仍可保留，所有 consumer 都得到完整、确定的标签集合。

## 3. Locale namespace completeness

补齐 8 个 locale `index.ts` 的 10 处缺失 import/export。校验脚本逐目录读取 JSON basename，并验证
对应 `index.ts` 同时存在 default import 和 object export。

renderer 测试继续验证 loader 行为；结构校验使用 Node 标准库脚本，避免测试环境动态 import 20 个
locale 时掩盖静态注册遗漏。

## 4. Interpolation contract

校验脚本解析每条 message 的 named interpolation：

- `{identifier}` 为 named interpolation；
- `{0}` 等 list interpolation 单独记录；
- `{'...'}` 为 literal interpolation，不进入变量集合；
- Unicode identifier 也视为变量，以便检测被翻译的占位符名称。

以 `en-US` 为 canonical 比较每个共有 key。修复时同时核对调用方传参；如果 `en-US` 与调用契约不一致，
先修 canonical，再同步其他 locale。字面量花括号统一使用 `{'{'}query{'}'}`。

## 5. 测试与提交切片

提交按可独立审阅的行为切分：

1. locale manifest、native menu resolver、main/renderer consumer 与测试；
2. namespace 注册修复和结构校验；
3. placeholder 修复、literal brace 修复和插值校验。

每个提交前检查隐藏副作用、兼容性、边界、性能、安全、命名、测试和维护成本，先修复发现再提交。

## 验证命令

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm exec vitest --project main test/main/shared/i18n.test.ts test/main/desktop/settings.test.ts
pnpm exec vitest --config vitest.config.renderer.ts test/renderer/i18n
```
