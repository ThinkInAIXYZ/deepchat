# Sign in with ChatGPT

状态：已实现；已用真实账号验证登录、模型列表和文本对话，等待 dim 发布 `openai-chatgpt` 预设后做完整验收。

## 背景

DeepChat 目前有两条使用 ChatGPT 账号的路径，共享同一份 Codex OAuth 凭证：

- 独立服务商 `openai-codex`，使用 Codex CLI 的公开 client ID，请求
  `https://chatgpt.com/backend-api/codex`，并在原生连接里伪装 Codex CLI 的版本与 User-Agent。
- 标准 `openai` 服务商的 `openaiAuthMode: 'chatgpt'`，运行时被解析为同一个 Codex 定义。

OpenAI 已为开源本地应用提供正式的 Sign in with ChatGPT（SIWC）ChatGPT plan usage：动态注册
client、PKCE + OIDC、公开的 `https://api.openai.com/v1` Responses 与模型列表接口。dim 的
[PR #2076](https://github.com/arcships/dim/pull/2076) 在 dim CLI 中接入了同一方案，并在 Aimux
中加入了 `openai-chatgpt` 请求整形预设。

本功能新增 `chatgpt` 服务商，按官方方案实现，并下线 `openai-codex` 与 OpenAI 的 ChatGPT 登录
模式。

参考：

- <https://developers.openai.com/siwc/token-sharing-open-source>
- <https://developers.openai.com/siwc/token-sharing-open-source/sign-in>
- <https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions>
- <https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference>
- <https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery>
- <https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations>
- <https://developers.openai.com/siwc/ui-ux-guidelines>
- <https://github.com/openai/sign-in-with-chatgpt-devkit>（只参考流程与资产，不引入其代码）

## 目标

- 新增内置服务商 `chatgpt`（显示名 ChatGPT），用户用 ChatGPT 账号登录后，以其 ChatGPT plan
  额度完成 DeepChat 内置 agent 的对话请求，无需 API Key。
- OAuth、凭证、刷新、撤销完全遵循 SIWC 开源客户端规范。
- 设置页、首页、输入框和错误提示遵循 SIWC UI/UX 规范。
- 一次性下线 `openai-codex` 服务商与 `openaiAuthMode: 'chatgpt'`，删除其凭证，并只对受影响
  用户提示一次改用 ChatGPT 登录。

## 非目标

- 多账号/多 workspace 选择器。存储结构按“每个注册一份记录”设计，UI 只暴露一个账号。
- 粘贴回调 URL 的兜底。只使用官方 `127.0.0.1` loopback 回调。
- 自动把旧会话的 `openai-codex/*` 模型迁移为 `chatgpt/*`。旧选择失效后由用户自行选择。
- 图片生成、file search、Code Interpreter、托管 MCP、音视频输入等 SIWC 预览不支持的能力。
- 使用 dim app-server 自带的 `account.chatgpt` 托管账号。按
  [dim Rust harness 迁移](../../architecture/dim-rust-harness-migration/spec.md)
  的约定，dim 自身 OAuth 不做适配；DeepChat 主进程拥有账号，dim 只负责请求整形。
- 远端撤销旧 Codex token。旧 Codex 凭证只在本地删除。
- 应用内用量统计面板。只链接 ChatGPT 的用量设置页。

## 用户体验

### 首页

`WelcomePage` 在服务商网格上方放主入口。点击后在首页原地完成授权，不跳转到设置页。

```text
+----------------------------------------------------------+
|                 Welcome to DeepChat                      |
|   +----------------------------------------------+       |
|   | (◎)  Continue with ChatGPT                   |       |
|   +----------------------------------------------+       |
|   Use your ChatGPT plan. No API key needed.              |
|   --------------- or add a provider ---------------      |
|   [Claude] [OpenAI] [DeepSeek] [Gemini] [Ollama] [OR]    |
+----------------------------------------------------------+

按钮下方的状态行：
  ⟳ Waiting for authorization in your browser…  [Reopen browser] [Cancel]
  ✓ Connected as alice@example.com              -> 启用服务商，进入新对话
  ⚠ ChatGPT plan use isn't enabled              [Continue with ChatGPT]
  ✕ Couldn't start sign-in. Try again.          [Retry]
```

授权成功后，主进程启用 `chatgpt` 并刷新模型。只有在没有有效默认模型时，才把默认模型设为
列表中的第一个可选模型。

### 设置 → 服务商 → ChatGPT

```text
未登录
+----------------------------------------------------------+
| ChatGPT                                        [ ○ off ] |
| Use your ChatGPT plan                                    |
| Complete eligible AI requests in DeepChat with usage     |
| included in your ChatGPT plan or credits balance.        |
| This is separate from API key billing.                   |
|   [ (◎)  Continue with ChatGPT ]                         |
+----------------------------------------------------------+

已连接
+----------------------------------------------------------+
| ChatGPT                                        [ ● on ]  |
| ✓ Connected · alice@example.com                          |
|   ChatGPT plan usage: enabled                            |
| [Test connection] [Manage usage ↗] [Sign out]            |
| Models                                     [⟳ Refresh]   |
+----------------------------------------------------------+
```

- 没有 API URL、API Key、自定义请求头编辑项。
- `Test connection` 只请求模型列表，不消耗 plan 额度。
- 计划权限缺失时显示 `ChatGPT plan use isn't enabled`，并提供重新授权按钮。
- 凭证不可用（刷新被拒、远端断开）时显示 `Reconnect ChatGPT`，复用已保存的注册与提示信息。
- 退出登录时若远端撤销未确认，提示用户到 ChatGPT 设置中断开 DeepChat。

### 不做的提示

真实账号试用后决定不做首次授权确认弹窗，也不在输入框旁显示「Using ChatGPT plan · Manage usage」：
弹窗打断首次使用，输入框指示只在悬停时展开、含义不清。设置页的连接区保留 Manage usage 入口，
用量耗尽的错误块保留 Manage usage 主操作。

### 错误提示

`chatgpt` 消息的错误块按失败类型给出恢复动作，并保留 ChatGPT 标识：

```text
| ◎ ChatGPT · Usage limit reached                          |
|   Review your plan or DeepChat's limit in ChatGPT        |
|   settings.          [ Manage usage ↗ ]  [ Switch model ]|

| ◎ ChatGPT · Sign in again                                |
|   [ Reconnect ChatGPT ]                                  |
```

其他错误沿用现有错误块。

### Codex 下线提示

只对升级前满足任一条件的用户弹一次：启用过 `openai-codex`；存在 Codex 凭证文件；OpenAI
服务商的认证方式为 `chatgpt`。

```text
+----------------------------------------------+
|  OpenAI Codex sign-in has been retired       |
|  DeepChat now supports the official Sign in  |
|  with ChatGPT. Reconnect to keep using your  |
|  ChatGPT plan. Your chats are kept.          |
|  [ Later ]     [ (◎) Continue with ChatGPT ] |
+----------------------------------------------+
```

两个按钮都会关闭提示并持久化。旧会话的模型选择为空，用户自行重新选择。

### 品牌

按钮、ChatGPT 标识使用 devkit `assets/` 中的官方资产，遵循 SIWC UI/UX 规范与 OpenAI 品牌规范。
随资产保留其来源说明。devkit 的 SDK 与 React 组件代码不引入。

## 设计

### 所有权

| 模块 | 职责 |
| --- | --- |
| `src/main/provider/auth/chatgpt/` | 唯一账号所有者：host ID、授权尝试、回调、换 token、ID token 校验、凭证存储、刷新、撤销、提示状态 |
| `src/main/provider` 注册表与 `AiSdkProvider` | `chatgpt` 定义、模型列表、连接检查 |
| `src/main/agent/dim` | 原生连接的凭证引用、bearer lease、`openai-chatgpt` 预设 |
| `native/dim-host` | 校验 lease，把 bearer 附加到 Responses 连接，设置 `openai-chatgpt` 预设 |
| dim Aimux（上游） | ChatGPT plan 请求整形与错误分类 |
| `src/shared/contracts` | 账号状态、路由与事件的类型化契约 |
| 渲染进程 | 设置页、首页入口、提示弹窗、状态栏、错误块；只经 `api/*Client` 调用 |

token、ID token 与授权 URL 不离开主进程，也不进入日志、事件或路由返回值。

### 账号与授权流程

常量：

- issuer `https://auth.openai.com`；授权 `.../api/accounts/authorize`；token
  `.../api/accounts/oauth/token`；撤销端点与 `jwks_uri` 取自
  `.../.well-known/openid-configuration`。
- scope `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`。
- resource `https://api.openai.com/v1`。
- `agent_name_hint` 固定为 `DeepChat`。

流程：

1. 第一次登录前生成并持久化 `ext_agent_host_id = urn:uuid:<UUIDv4>`，之后对同一安装始终复用。
2. 每次尝试生成新的 `state`、`nonce` 和 PKCE verifier。先在 `127.0.0.1` 上启动 loopback
   监听（路径 `/auth/callback`，优先端口 1455，被占用时用任意空闲端口），再用系统浏览器打开
   授权 URL。同一时间只允许一个尝试；新尝试取消旧尝试。尝试 10 分钟后超时。
3. 新注册：`client_id=dynamic_agent_client`，带 `agent_name_hint` 与 `ext_agent_host_id`。
   已有注册的重新授权：使用保存的 issued `client_id`，带 `ext_agent_host_id`、`id_token_hint`
   与 `login_hint`，不带 `agent_name_hint`。用户明确要求开启 plan 权限时追加
   `prompt=consent`；普通登录不强制授权。
4. 回调先校验 `state`。`error=access_denied` 结束尝试，不换 token。新注册必须返回 issued
   `client_id`（不得为 `dynamic_agent_client`）；重新授权的回调若带了不同的 `client_id`，拒绝
   结果。
5. 用 issued `client_id`、`code`、`code_verifier`、同一 `redirect_uri` 与 `resource` 换 token。
   `invalid_grant` 时丢弃该 code，状态回到可重新登录。
6. 用 JWKS 校验 ID token 的签名、`iss`、`aud`（等于 issued client ID）、`exp` 与 `nonce`。
   使用 Node 自带的 `crypto` 校验 RS256，不新增依赖。重新授权时，新 `sub` 必须与该注册保存的
   `sub` 一致，否则不覆盖凭证。
7. 根据 token 响应的 scope 判断 plan 权限。缺少 `chatgpt.tokens.use.direct` 时保留登录身份，
   状态为 `plan-disabled`，不允许推理。
8. 通过校验后，一次原子写入：注册、凭证、活跃账号、首次确认提示标记。

### 刷新与撤销

- access token 到期前 60 秒内刷新：`grant_type=refresh_token`、issued `client_id`、
  `refresh_token`、`resource`，不带 `scope`。同一时间只有一个刷新；新的 access token、
  refresh token、scope 与过期时间一起原子替换。
- 应用启动和读取状态都不触发刷新；刷新只发生在需要凭证时。
- `invalid_grant`、`invalid_refresh_token`、`token_expired`、`refresh_token_expired`、
  `refresh_token_invalidated`、`refresh_token_reused`：清除该注册的 token，保留注册，状态为
  `reauth-required`。
- 网络错误与 5xx 保留凭证，向调用方返回可重试的失败。
- 原生 401 恢复沿用现有 rejected-lease 协议：只有被拒绝的 lease 仍是当前 token 时才强制刷新。
- 退出登录：先停止新的凭证发放，用 refresh token 调撤销端点（带 issued `client_id`）；网络
  错误或 5xx 有限次退避重试。无论结果如何，都在本地清除 access、refresh、ID token，保留
  `client_id`、`sub`、邮箱与 host ID。返回远端撤销是否已确认。

### 凭证存储

`userData/chatgpt-auth/credentials.json`，沿用现有 OAuth 凭证文件模式：

- `safeStorage` 可用时整体加密；否则明文 JSON。文件权限 `0600`，目录 `0700`，临时文件 +
  rename 原子写入，损坏文件备份后忽略。
- 内容（版本化）：`hostId`、`activeRegistrationId`、`pendingClientId`、
  `registrations[]`。每个注册包含 `id`、`issuer`、`subject`、`clientId`、`email`，以及可清除的
  `idToken`、`accessToken`、`refreshToken`、`tokenType`、`scopes`、`expiresAt`、`savedAt`。
- 该文件不参与设备同步、备份导出或 CLI 输出。

Codex 下线提示标记不属于账号数据，存放在主进程设置中。

### 服务商与模型

- 默认服务商：`id: 'chatgpt'`，`name: 'ChatGPT'`，`apiType: 'chatgpt'`，
  `baseUrl: 'https://api.openai.com/v1'`，默认关闭。
- 注册表定义：运行时 Responses；`credentialStrategy: 'none'`；新模型来源 `chatgpt`；
  `checkStrategy: 'fetch-models'`；不支持 embedding、路由与自定义请求头。
- 模型列表：`GET https://api.openai.com/v1/models`，bearer 来自账号所有者。只保留
  `visibility == 'list'` 的条目，保持服务端顺序，`slug` 作为模型 ID，`display_name` 作为
  显示名。账号目录给出的 `context_window`、`input_modalities`、`supported_reasoning_levels`
  直接作为该模型的事实（套餐的上下文窗口小于公开 API 目录）；所有列出的模型都支持函数工具。
  其余能力按 slug 从 provider-db 的 `openai` 数据补全。`chatgpt` 不属于 provider-db 托管的
  服务商，所以这些账号事实会被保存，不会被当作派生字段剥离。
- 目录来源属于 runtime：账号变化（登录、退出、重新授权）时清空并刷新模型目录。后台
  provider-db 刷新不触碰这个目录。
- 所有模型标记为 Responses-only chat 模型，不暴露图片生成或嵌入模型。

### 推理连接

- dim 模型目录为 `chatgpt` 生成凭证引用 `deepchat/chatgpt/v1/<providerId>/<scope>`，驱动为
  `openai-responses`，base URL 固定 `https://api.openai.com/v1`，不注入自定义请求头。
- `DimProviderCredentials.connectionAuth` 对 `chatgpt` 返回
  `{ preset: 'openai-chatgpt', bearer, lease }`，不带 account ID。
- `native/dim-host` 的连接准备识别 `deepchat/chatgpt/v1/` 前缀，并校验：preset 匹配；协议为
  OpenAI Responses；base URL 为 `https://api.openai.com`；bearer 与 lease 格式有效。通过后移除
  外部 `Authorization` 头，设置 bearer 与 `http.preset = "openai-chatgpt"`，并注册 401 恢复。
- Aimux 的 `openai-chatgpt` 预设负责 SIWC 预览约束：`store: false`、流式、system 指令使用
  developer 角色、本地函数工具放进 namespace、去掉 `max_output_tokens`/`temperature`/`top_p`/
  service tier 等不支持字段、历史随 `input` 发送，并把
  `subscription_sharing_usage_limit_exceeded` 归为额度耗尽、
  `subscription_sharing_usage_unavailable`/`subscription_sharing_user_unavailable` 归为临时服务
  错误。
- DeepChat 在 `dimModelParameters` 中对 `chatgpt` 不发送 `temperature`、`topP`、`maxTokens`；
  能力快照把 temperature 与 top-p 标记为 `omit`，界面不再显示这两项，并关闭图片、视频与音频
  输入。这不依赖 dim 的预设，当前版本就会因为 `Unsupported model parameter: temperature` 失败。

**上游依赖**：`openai-chatgpt` 预设随 dim PR #2076（`697b4018d`）合入 dim main，但当前锁定的
`0.1.0-alpha.23` 与最新发布 `0.1.0-alpha.27` 都不包含。DeepChat 侧先完成全部接入；dim 发布
包含该提交的版本后，再升级 `resources/dim-runtime-lock.json`。在 alpha.23 上，去掉采样参数后的
纯文本对话已能完成；工具调用与 developer 角色等整形仍需升级后验证。

### 使用范围

SIWC 授权给本地开源应用中的用户本人使用。DeepChat 全部运行在用户本机，所以 `chatgpt` 与
其他服务商一样可用于所有入口：桌面会话、附属模型（标题、压缩、记忆等）、Remote 渠道、
定时任务和本地 CLI。不按入口单独限制。

### Codex 下线与迁移

在服务商设置初始化阶段执行一次（以设置中的迁移标记保证幂等）：

1. 先判断用户是否受影响：`openai-codex` 曾启用、Codex 凭证文件存在、或 `openai` 的
   `openaiAuthMode === 'chatgpt'`。受影响则写入 `codexRetiredNoticePending = true`。
2. 把 `openai-codex` 加入两处 `DEPRECATED_BUILTIN_PROVIDER_IDS`。现有清理逻辑会移除服务商，并
   清空指向它的默认、助手、视觉与偏好模型选择。
3. 去掉 `openai` 的 `openaiAuthMode` 字段。已保存的 API Key 保持不变。
4. 删除 `userData/openai-codex-auth/` 目录，不调用远端撤销。

之后删除所有 Codex 代码：认证模块与凭证存储、Codex 适配器、注册表定义与 `openai-codex` 模型
来源、路由、事件与共享类型、`OpenAICodexOAuth.vue`、OpenAI 认证方式切换、原生 Codex 预设与
请求头伪装、CLI 中 Codex 专用的错误映射、图标映射和对应 i18n 文案与测试。`openaiAuthMode`
从类型、schema 与 `provider-operations` 中移除；读取旧数据时忽略该字段，不报错。

会话侧不做迁移。指向已删除服务商的会话模型按现有缺失模型逻辑显示为空。实现时需要验证这一
行为；若现有逻辑会报错，则修正为显示为空。

### 契约

在 `oauth.routes.ts` 与 `oauth.events.ts` 中替换 Codex 契约：

- `ChatGPTAuthStatus`：`state`（`signed-out` | `pending-browser` | `authenticated` |
  `plan-disabled` | `reauth-required` | `error`）、`email?`、`planUsageEnabled`、
  `storage`、`error?`（已脱敏）、`notices: { welcome: boolean; codexRetired: boolean }`。
- 路由：`oauth.chatgpt.getStatus`、`oauth.chatgpt.startLogin`（可选
  `{ requestPlanConsent?: boolean }`）、`oauth.chatgpt.reopenBrowser`、
  `oauth.chatgpt.cancelLogin`、`oauth.chatgpt.logout`（返回
  `{ status, revocationConfirmed }`）、`oauth.chatgpt.dismissNotice`
  （`{ notice: 'welcome' | 'codexRetired' }`）。
- 事件：`oauth.chatgpt.statusChanged`。

登录成功后，由主进程启用服务商并刷新目录，渲染进程不需要再发第二次请求。

### 错误呈现

- 授权与刷新错误只暴露脱敏后的消息，以及原始 HTTP 状态和错误码（有的话）。不记录响应体
  中的 token、带 `id_token_hint` 的授权 URL 或账号标识。
- 推理错误来自原生流的分类结果。渲染进程对 `chatgpt` 服务商的消息，把额度耗尽映射为
  “Usage limit reached + Manage usage”，把认证失败映射为 “Reconnect ChatGPT”。具体用失败
  类型还是错误码字段，取决于现有消息块已携带的结构化信息，在实现中确认；不靠匹配自由文本。
- `subscription_sharing_user_not_eligible` 显示资格限制说明，不提供重试或重新授权。

## 兼容性

- 升级后旧 Codex 与 OpenAI ChatGPT 模式立即失效，没有过渡期。这是已确认的产品决策。
- 设备同步或配置导入带来的旧 `openai-codex` 服务商与 `openaiAuthMode` 字段，被同一清理逻辑
  忽略或移除。
- 复制 userData 到另一台机器会复用 host ID。属于已知限制，不做检测。
- ChatGPT 凭证文件不同步，在新设备上需要重新登录。

## 验收标准

1. 全新安装：首页显示 Continue with ChatGPT；完成浏览器授权后，`chatgpt` 已启用、模型列表来自
   `/v1/models`，可以发起包含工具调用的多轮对话，且请求发往
   `https://api.openai.com/v1/responses`，带 `store: false` 与 `stream: true`。
2. 首次登录后自动启用账号目录中的前三个模型，可以直接开始对话；用户已启用模型时不改动。
3. 拒绝授权或缺少 plan scope 时不发起推理，界面给出重新授权入口；重新授权使用已保存的
   client ID，不新建注册。
4. ID token 签名、issuer、audience、过期或 nonce 任一不通过，或重新授权的 subject 不一致时，
   拒绝并保留原凭证。
5. 重启应用后可以直接使用；临近过期时自动刷新，刷新后的 refresh token 立即落盘；并发请求只
   触发一次刷新。
6. 刷新被判定为不可用时，状态变为 `reauth-required`，并提示重新连接；网络失败时保留凭证。
7. 退出登录会尝试远端撤销；未确认时给出提示。本地 token 被清除，再次登录复用 client ID 与
   host ID。
8. 凭证文件权限为 `0600`；token 与 ID token 不出现在日志、事件、路由返回、CLI 输出和同步数据中。
9. ChatGPT 模型不显示 temperature、top-p 控件，请求不携带这些参数，也不显示弱 Agent 能力警告。
10. 额度耗尽时错误块显示 Manage usage 主操作；认证失败时显示 Reconnect ChatGPT。
11. 升级用户：`openai-codex` 消失，OpenAI 只剩 API Key 模式且已存的 key 保留，Codex 凭证目录被
    删除；受影响用户只看到一次下线提示，未受影响用户不会看到。
12. 引用旧 Codex 模型的会话可以正常打开，模型选择为空，用户选择新模型后可以继续对话。
13. 仓库中不再有 Codex 认证、路由、预设与 `openaiAuthMode` 代码路径。
14. CLI 公共服务商列表只输出 `chatgpt` 的公开元数据，不输出任何凭证。

## 已确认决策

- 使用范围：能用的入口都允许，不参考 dim 的交互会话限制。
- dim 依赖：等 dim 发布包含 PR #2076 的版本后再升级锁定版本，DeepChat 先完成其余工作。
