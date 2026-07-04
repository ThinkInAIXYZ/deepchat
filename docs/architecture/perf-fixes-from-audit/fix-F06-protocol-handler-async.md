# 修复 F6：protocol handler 改为 async + 明确 streaming fallback

## 目标

将 [`protocolRegistrationHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L75-L223) 中 `deepcdn`、`imgcache`、`workspace-preview` 三个 protocol handler 从同步文件 IO 改为异步实现，消除主进程在资源读取路径上的 `existsSync` / `statSync` / `readFileSync` 阻塞。

本修复的首选方案是：

- `deepcdn`：`async` handler + `fs.promises.readFile`
- `imgcache`：`async` handler + streaming `Response`
- `workspace-preview`：`async` handler + streaming `Response` + 50 MB 预览上限

同时明确确定性的兼容回退：若 Electron 40.10.5 的某个运行时边界导致 `Response` 不接受 `Readable.toWeb(fs.createReadStream(...))` 作为 body，则保持 handler 仍为 `async`，仅把 body 构造回退为 `await fs.promises.readFile(...)`。即：**优先 streaming，失败时 fallback 到 async readFile，不回退到任何同步 IO。**

## 定位

### 2.1 同步阻塞点

当前实现位于 [`protocolRegistrationHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L75-L223)：

- `deepcdn`：`fs.existsSync` 在 [protocolRegistrationHook.ts#L87](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L87)，`fs.existsSync` 在 [protocolRegistrationHook.ts#L108](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L108)，`fs.readFileSync` 在 [protocolRegistrationHook.ts#L117](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L117)
- `imgcache`：`fs.existsSync` 在 [protocolRegistrationHook.ts#L139](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L139)，`fs.readFileSync` 在 [protocolRegistrationHook.ts#L170](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L170)
- `workspace-preview`：`fs.existsSync` / `fs.statSync` 在 [protocolRegistrationHook.ts#L194](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L194)，`fs.readFileSync` 在 [protocolRegistrationHook.ts#L204](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L204)

这些调用都位于 `protocol.handle(...)` 回调内部，请求命中时直接运行在主进程事件循环上。大量图片、预览文件或慢盘访问会放大卡顿风险。

### 2.2 MIME 现状必须完整保留

当前 `workspace-preview` 走本文件内的 `getMimeTypeForPath`（[protocolRegistrationHook.ts#L18-L64](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L18-L64)），覆盖：

- 文本/脚本：`.html` `.htm` `.xhtml` `.css` `.js` `.mjs`
- 数据：`.json` `.map` `.pdf`
- 图片：`.svg` `.png` `.gif` `.webp` `.jpg` `.jpeg` `.bmp` `.ico` `.avif`
- 字体：`.woff` `.woff2` `.ttf` `.otf`
- 默认：`application/octet-stream`

当前 `deepcdn` 还额外显式覆盖了 `.wasm -> application/wasm`（[protocolRegistrationHook.ts#L99-L100](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L99-L100)）以及 `.data -> application/octet-stream`（[protocolRegistrationHook.ts#L101-L102](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L101-L102)）。修复后不能因为抽取/复用 MIME 逻辑而丢失 `.wasm`，否则会回归内置资源加载。

### 2.3 Electron 40.10.5 的兼容事实

仓库 `electron` 版本固定为 [`package.json#L185`](../../../package.json#L185) 的 `40.10.5`。项目内已经存在 Node stream 转 Web stream 的运行时用法：[`acpProcessManager.ts#L1407-L1408`](../../../src/main/presenter/llmProviderPresenter/acp/acpProcessManager.ts#L1407-L1408) 使用 `Writable.toWeb(...)` 和 `Readable.toWeb(...)`。这说明当前运行时至少已在项目内接受 Node/Web stream 互转模式。

因此文档结论应明确为：**Electron 40.10.5 上，`protocol.handle` 返回 `Promise<Response>` 是可行设计；body 首选 `Readable.toWeb(fs.createReadStream(...))`。** 但为避免类型层或运行时边界差异，需同时落地确定性 fallback：同一 async handler 内，捕获 stream body 构造/返回失败后改用 `await fs.promises.readFile(...)` 返回 `Response`。

### 2.4 workspace-preview 的 realpathSync 不属于本次热路径问题

[`workspacePreviewProtocol.ts`](../../../src/main/presenter/workspacePresenter/workspacePreviewProtocol.ts#L47-L52) 的 `normalizePathForAccess()` 仍使用 `fs.realpathSync`：

- [workspacePreviewProtocol.ts#L47-L52](../../../src/main/presenter/workspacePresenter/workspacePreviewProtocol.ts#L47-L52)

需要在文档中区分：这里属于路径规范化与访问控制辅助逻辑，发生在 `register*` / URL 解析流程中；它不是本次 F6 关注的「handler 内同步读取文件内容」问题，不应误判为同一类热点阻塞。若后续要继续优化，可单独立项评估，但不混入本修复。

## 修复方案

### 3.1 总体策略

1. 三个 handler 全部改成 `async`。
2. 用一次 `await fs.promises.stat(...)` 或 `await fs.promises.readFile(...)` 替代 `existsSync + statSync/readFileSync` 的同步双重 IO。
3. `deepcdn` 保持 async 非 streaming 即可；`imgcache` 与 `workspace-preview` 以 streaming `Response` 为首选。
4. 为 streaming body 提供确定 fallback：
   - 首选：`Readable.toWeb(fs.createReadStream(fullPath))`
   - fallback：`await fs.promises.readFile(fullPath)`
5. 所有 fallback 仍保持 async，不允许回退到同步 API。

### 3.2 deepcdn

`deepcdn` 服务内置资源，路径有界，文件通常较小。本项收益重点不是削减内存峰值，而是去掉主进程同步阻塞。

建议：

- 保留 `Response(Buffer)` 形态，但改为 `async` + `await fs.promises.readFile(fullPath)`
- 用 `await fs.promises.access(...)` 或直接 `readFile` 捕获 `ENOENT` 替代 `existsSync`
- MIME 逻辑保持当前显式覆盖，尤其保留 `.wasm -> application/wasm`

### 3.3 imgcache

`imgcache` 面向用户图片缓存，文件大小与并发都不可控，适合优先使用 streaming。

建议：

- 先 `await fs.promises.stat(fullPath)` 获取存在性、目录判定、`Content-Length`
- 非目录后优先 `Readable.toWeb(fs.createReadStream(fullPath))`
- 若 stream body 不被接受，则 fallback 到 `await fs.promises.readFile(fullPath)`
- MIME 映射继续覆盖 `.png` `.gif` `.webp` `.svg` `.jpg` `.jpeg` `.bmp` `.ico` `.avif`

### 3.4 workspace-preview

`workspace-preview` 风险最高，应同时处理同步阻塞和超大文件预览问题。

建议：

- `resolveWorkspacePreviewRequest(request.url)` 保持原状，继续先做 403 路径校验
- 用一次 `await fs.promises.stat(fullPath)` 完成存在性 + 目录校验
- 引入 `MAX_WORKSPACE_PREVIEW_BYTES = 50 * 1024 * 1024`
- `stat.size > 50 MB` 时直接返回 `413 Payload Too Large`
- 正常文件优先 streaming `Response`，失败时 fallback 到 async `readFile`
- 保持 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`
- 为 `getMimeTypeForPath(fullPath)` 增加按完整路径缓存的 `Map<string, string>`，减少高频预览时重复扩展名判断

#### 为什么是 50 MB

给出固定阈值，避免“按需求再定”的模糊结论：

- workspace preview 的目标是文本、图片、文档等“可快速查看”内容，不是通用大文件传输
- 50 MB 足以覆盖常见 markdown、代码、JSON、SVG、普通截图/图片与中等 PDF 预览
- 超过 50 MB 时，即使改成 async/streaming，也会增加 renderer 处理时间、协议带宽占用和误点大文件的体验成本
- 413 明确、可预期，且比默默读取超大文件更安全

因此本修复将 **50 MB** 作为默认产品阈值写入方案，而不是留空。

## 步骤拆分

### 4.1 streaming body helper（含确定 fallback）

```ts
import fs, { promises as fsp } from 'fs'
import { Readable } from 'stream'

async function createProtocolBody(fullPath: string): Promise<BodyInit> {
  try {
    return Readable.toWeb(fs.createReadStream(fullPath)) as unknown as ReadableStream<Uint8Array>
  } catch {
    return await fsp.readFile(fullPath)
  }
}
```

### 4.2 imgcache handler

```ts
import fs, { promises as fsp } from 'fs'
import { Readable } from 'stream'

protocol.handle('imgcache', async (request) => {
  const filePath = request.url.slice('imgcache://'.length)
  const fullPath = path.join(app.getPath('userData'), 'images', filePath)

  try {
    const stat = await fsp.stat(fullPath)
    if (stat.isDirectory()) {
      return new Response('Image not found', { status: 404 })
    }

    const body = await createProtocolBody(fullPath)
    return new Response(body, {
      headers: {
        'Content-Type': getMimeTypeForPath(fullPath),
        'Content-Length': String(stat.size)
      }
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Response(`Image not found: ${filePath}`, { status: 404 })
    }
    throw error
  }
})
```

### 4.3 workspace-preview handler

```ts
import fs, { promises as fsp } from 'fs'
import { Readable } from 'stream'

const MAX_WORKSPACE_PREVIEW_BYTES = 50 * 1024 * 1024
const workspacePreviewMimeCache = new Map<string, string>()

function getWorkspacePreviewMimeType(fullPath: string): string {
  const cached = workspacePreviewMimeCache.get(fullPath)
  if (cached) {
    return cached
  }
  const mimeType = getMimeTypeForPath(fullPath)
  workspacePreviewMimeCache.set(fullPath, mimeType)
  return mimeType
}

protocol.handle(WORKSPACE_PREVIEW_PROTOCOL, async (request) => {
  const fullPath = resolveWorkspacePreviewRequest(request.url)
  if (!fullPath) {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    const stat = await fsp.stat(fullPath)
    if (stat.isDirectory()) {
      return new Response(`File not found: ${fullPath}`, { status: 404 })
    }
    if (stat.size > MAX_WORKSPACE_PREVIEW_BYTES) {
      return new Response('Payload too large', { status: 413 })
    }

    const body = await createProtocolBody(fullPath)
    return new Response(body, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': getWorkspacePreviewMimeType(fullPath),
        'Content-Length': String(stat.size),
        'X-Content-Type-Options': 'nosniff'
      }
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Response(`File not found: ${fullPath}`, { status: 404 })
    }
    throw error
  }
})
```

### 4.4 deepcdn MIME 保留要求

若抽取统一 MIME helper，需要确保至少覆盖当前集合：

- `getMimeTypeForPath` 已有：`.html` `.htm` `.xhtml` `.css` `.js` `.mjs` `.json` `.map` `.pdf` `.svg` `.png` `.gif` `.webp` `.jpg` `.jpeg` `.bmp` `.ico` `.avif` `.woff` `.woff2` `.ttf` `.otf`
- `deepcdn` 额外必须保留：`.wasm -> application/wasm`、`.data -> application/octet-stream`

不能因为示意代码只展示常见图片 MIME，就让 deepcdn 的 `.wasm` 支持在正式实现中丢失。

## 验证

- 类型检查：确认 `async` handler、`BodyInit`、`Readable.toWeb(...)` 的类型声明可通过 `pnpm run typecheck`
- lint / format / i18n：按仓库要求执行 `pnpm run format`、`pnpm run i18n`、`pnpm run lint`
- 回归验证：
  - `deepcdn` 访问 `.js` / `.css` / `.json` / `.wasm`
  - `imgcache` 图片命中、404、目录路径
  - `workspace-preview` 的 403 / 404 / 413 / 正常返回 / MIME 头 / `nosniff`
- E2E：`29/30` workspace watcher 相关场景 + 图片/文件预览场景

## 风险

- `Readable.toWeb(fs.createReadStream(...))` 在 Electron 40.10.5 上预期可行，但仍要保留已定义好的 async `readFile` fallback，不能只在文档里“口头回退”。
- `Content-Length` 必须与 `stat.size` 一致，否则 renderer 侧可能出现加载异常。
- `workspace-preview` 的 50 MB 上限会改变超大文件预览行为；需要确保上层 UI 对 413 有合理提示或至少稳定失败。
- [`workspacePreviewProtocol.ts#L47-L52`](../../../src/main/presenter/workspacePresenter/workspacePreviewProtocol.ts#L47-L52) 的 `realpathSync` 仍存在，但它不属于本次 handler 读取热路径；本修复不应把它当作同一个问题处理。
