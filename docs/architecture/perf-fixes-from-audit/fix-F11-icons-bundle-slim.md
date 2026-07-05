# 修复 F11：Iconify 白名单 + provider 图标按需化

## 目标

收紧 renderer 图标相关包体与首屏资源装载路径，但只承诺**方向性收益**，不预设具体 MB 降幅：

- `iconLoader.ts` 不再整包注册 `lucide` / `vscode-icons` / `line-md` collection，而是仅注册构建脚本产出的白名单子集。
- `ModelIcon.vue` 不再静态打包大批 provider 图标，改为由脚本生成 manifest，并按 providerId 按需解析/加载。
- `tokenflux-color.svg` 作为异常大图标资源单独治理，满足明确的体积阈值与回归验收标准。
- 为避免静态白名单漏掉运行时动态分支，补一层**运行时未命中采样/告警 -> 白名单回灌**机制。

## 定位

### 2.1 当前代码路径

- [`src/renderer/src/lib/iconLoader.ts#L41-L57`](../../../src/renderer/src/lib/iconLoader.ts#L41-L57) 动态导入后仍整包 `addCollection(lucideIcons)`、`addCollection(vscodeIcons)`、`addCollection(lineMdThemeIcons)`。
- [`src/renderer/src/main.ts#L46-L51`](../../../src/renderer/src/main.ts#L46-L51) 与 [`src/renderer/settings/main.ts#L104-L109`](../../../src/renderer/settings/main.ts#L104-L109) 都会在 app mount 后 `setTimeout(..., 0)` 预热图标。
- [`src/renderer/src/components/icons/ModelIcon.vue#L6-L82`](../../../src/renderer/src/components/icons/ModelIcon.vue#L6-L82) 静态导入约 77 个 provider 图标。
- [`src/renderer/src/components/icons/ModelIcon.vue#L85-L184`](../../../src/renderer/src/components/icons/ModelIcon.vue#L85-L184) 用常驻 `icons` map 维护 provider 映射。
- [`src/renderer/src/components/icons/ModelIcon.vue#L206-L227`](../../../src/renderer/src/components/icons/ModelIcon.vue#L206-L227) 通过 `Object.keys(icons).find(...includes...)` 线性扫描匹配 provider icon，其中包含 `tokenflux` 键 [`src/renderer/src/components/icons/ModelIcon.vue#L156`](../../../src/renderer/src/components/icons/ModelIcon.vue#L156)。

### 2.2 Iconify 包导出事实

`@iconify-json/lucide` 与 `@iconify-json/vscode-icons` 的 `package.json` 仅明确导出整包 JSON 与 info：

- [`node_modules/@iconify-json/lucide/package.json#L11-L20`](../../../node_modules/@iconify-json/lucide/package.json#L11-L20)
- [`node_modules/@iconify-json/vscode-icons/package.json#L12-L21`](../../../node_modules/@iconify-json/vscode-icons/package.json#L12-L21)

两者都声明了：

- `./icons.json`
- `./info.json`
- `./*`

但没有官方文档化的“单 icon 稳定子路径 API”。因此，**过滤完整 `icons.json` 后再 `addCollection`** 是当前最稳妥、最可审计的主方案；单 icon 子路径导入不能作为主设计前提。

### 2.3 252 个 icon 只是静态基线，不代表运行时全覆盖

现有统计得到 **252 个源码静态字面量 icon**：

- `lucide` 235
- `vscode-icons` 16
- `line-md` 3

这个数字只能说明“源码里直接写死的字面量基线”，**不能证明覆盖所有运行时路径**，尤其是：

- 字符串拼接的 icon 名称
- 配置/远端数据驱动的 icon 名称
- fallback 分支与未来新增映射

因此文档中的 252 只能作为**脚本生成白名单的初始输入基线**，不能直接当作最终可信全集。后续必须补：

1. 构建时白名单生成与静态校验；
2. 运行时未命中 icon 的采样/告警；
3. 将未命中结果回灌到白名单生成清单或 provider manifest。

### 2.4 tokenflux 资源事实

`tokenflux-color.svg` 当前文件大小为 **1,627,765 B**，且内容特征为：

- 包含 `<image`
- 包含 `data:image`
- 包含 `base64`
- 不以大量 `<path` 为主

这说明它大概率不是普通矢量 path logo，而是**内嵌 base64 位图/混合资源的 SVG 包装文件**，因此仅靠常规 SVG path 压缩未必足够，需优先检查是否可重导出为真正轻量的 SVG 或直接改成受控位图格式。

## 修复方案

### 3.1 Iconify：脚本生成 reduced collection

主方案：

1. 新增脚本扫描源码中的 icon 字面量，在构建前生成 `icon-whitelist.generated.ts` 与 `icon-collections.generated.ts`。
2. `icon-whitelist.generated.ts` 只包含小体积白名单；`icon-collections.generated.ts` 直接包含裁剪后的 `lucide` / `vscode-icons` / `line-md` collection。
3. `iconLoader.ts` 在启动预热路径只动态导入 generated reduced collection；禁止在该路径导入完整 `@iconify-json/*/icons.json`。
4. 保留 `preloadIcons()` 与 `ensureIconsLoaded()` 的对外语义，只替换实际注册的数据来源。
5. 对用户配置的动态 Lucide icon，单独保留“未命中 generated collection 时懒加载完整 Lucide”的兼容兜底，避免破坏已有自定义头像。

目标形态示意：

```ts
import { addCollection } from '@iconify/vue'
import {
  lineMdIconCollection,
  lucideIconCollection,
  vscodeIconCollection
} from './icons/icon-collections.generated'

addCollection(lucideIconCollection)
addCollection(vscodeIconCollection)
addCollection(lineMdIconCollection)
```

### 3.2 Provider 图标：manifest 改为脚本生成，并纳入 CI 校验

`ModelIcon.vue` 现在既维护静态 import，又维护 provider key 到 icon 的匹配表，属于双份手工维护。修复后改为：

1. 用脚本扫描 `src/renderer/src/assets/llm-icons/` 与 provider/provider alias 来源，生成：
   - `provider-icon-manifest.generated.ts`
   - provider alias / 精确匹配表
   - 默认图标与需要 dark-mode invert 的单色图标清单
2. `ModelIcon.vue` 只消费生成物，不再手写 70+ import 与大对象字面量。
3. manifest 的生成与校验纳入 CI，确保：
   - 引用的资产真实存在
   - alias 没有悬空项
   - 新增 provider 映射不会只改一半

如果需要按需拆包，优先用 `import.meta.glob` 或脚本生成 `() => import('...svg?url')` loader，而不是手写大量动态导入。

### 3.3 动态漏项：运行时未命中采样/告警

由于 252 只覆盖静态基线，必须补运行时保护：

- 在 icon 解析入口记录“请求的 icon 名 / provider key 是否命中白名单或 manifest”。
- 对未命中情况做去重采样并输出开发期告警；生产构建可选择上报到本地诊断日志而非刷屏 console。
- 提供一个汇总脚本/测试，把运行时采样结果转成待补条目，回灌到生成脚本输入。

最低验收要求：

- 开发/CI 环境能发现未注册 icon 请求；
- 不因漏项直接导致白屏，只允许回退 default/fallback；
- 运行一轮关键页面后，未命中列表应为空或只剩已确认可忽略项。

### 3.4 tokenflux：先查构成，再定压缩/替换路径

对于 [`src/renderer/src/components/icons/ModelIcon.vue#L51`](../../../src/renderer/src/components/icons/ModelIcon.vue#L51) 引入的 `tokenflux-color.svg`：

1. 先拆解它为何达到 1,627,765 B：当前证据已显示其包含 base64 内嵌图像。
2. 首选方案：重导出/替换为真正轻量的 SVG 或尺寸受控的 PNG/WebP。
3. 若仍保留为大资源，则只能按需 lazy import，避免首屏与主 chunk 常驻。

**验收阈值**：

- 优先目标：压缩/替换后图标文件 **< 200 KB**；
- 次级容忍：若品牌资源无法低于 200 KB，必须证明其已脱离主 renderer 初始 chunk，并只在命中 provider 时请求；
- 视觉验收：浅色/深色主题、provider 列表、消息头像场景均无明显失真。

## 步骤拆分

1. **生成脚本落地**
   - 增加 icon 白名单生成脚本。
   - 增加 provider icon manifest 生成/校验脚本。
   - 把两类生成物接入 CI 校验，避免手工双维护。
2. **改造 `iconLoader.ts`**
   - 从整包 `icons.json` 过滤出白名单子集后再注册。
   - 保留现有 preload 行为，但确保只注册裁剪后的集合。
3. **改造 `ModelIcon.vue`**
   - 用生成 manifest 替代静态 import 大表。
   - icon 匹配改为精确匹配/预计算别名表优先，避免每次 render 做线性 `includes` 扫描。
   - 对 lazy loader 做 promise/result 缓存。
4. **补运行时漏项校验**
   - 开发与 CI 环境收集未命中 icon 请求。
   - 形成回灌机制，更新白名单与 provider manifest。
5. **处理 tokenflux**
   - 量化优化前后体积。
   - 若无法压到阈值内，则单独异步化并验证缓存/首帧行为。

## 验证

### 5.1 构建体积

只承诺“**应显著下降**”，不承诺具体 MB 数值。验证方法：

1. 记录修复前 `pnpm run build` 后 `out/renderer/assets` 中 icon 相关 chunk 与 `tokenflux` 资源大小。
2. 完成修复后再次构建，对比：
   - icon 相关 chunk 是否明显缩小
   - provider 图标是否从主 chunk 剥离
   - `tokenflux` 是否满足阈值或完成异步化

### 5.2 运行时正确性

- 复跑 `01-launch`、`04-settings-navigation`、`18-provider-readonly-route`。
- 手动检查主题切换图标、文件类型图标、provider 列表、聊天消息头像。
- 检查未命中 icon 告警汇总应为空或仅剩已登记例外。

### 5.3 静态/CI 校验

- 白名单生成脚本输出稳定，无手工编辑漂移。
- provider manifest 生成脚本可校验资产存在、映射完整。
- `pnpm run typecheck`
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`

## 风险

### 6.1 主要风险

- **静态白名单漏项**：252 只覆盖字面量，若无运行时补漏，动态 icon 会丢失。
- **双维护回归**：若不把 provider manifest 也纳入生成/校验，后续仍会重复出现“资源新增了、映射没改”或反之。
- **lazy import 闪烁**：provider icon 改异步后，列表首帧可能先显示 default icon，再切换真实 icon。
- **并发重复请求**：同一 provider 图标若没有 promise 缓存，列表并发渲染时可能触发多次相同加载。
- **tokenflux 品牌回归**：替换格式或重导出可能造成视觉偏差。

### 6.2 最低验收标准

- 不再整包注册 `lucide` / `vscode-icons` / `line-md`。
- 白名单与 provider manifest 均由脚本生成，并有 CI 校验入口。
- 存在运行时未命中 icon 的告警/汇总机制。
- 构建后 icon 相关 chunk 体积相较基线显著下降，但不在文档中预承诺具体数值。
- `tokenflux` 资源压缩到 **< 200 KB**，或已证明异步化且不会拖入初始主包。
- provider icon lazy load 具备缓存，避免闪烁与并发重复加载问题扩大。
