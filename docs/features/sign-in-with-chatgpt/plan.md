# Sign in with ChatGPT 实施计划

设计见 [spec.md](./spec.md)。

## 1. 共享契约

- [x] 新增 `src/shared/types/chatgpt.ts`，以及 `oauth.chatgpt.*` 路由和 `oauth.chatgpt.statusChanged`
      事件；Codex 契约直接被替换，没有并存期。
- [x] 渲染进程 `OAuthClient` 改为 ChatGPT 方法。

## 2. 主进程账号所有者

负责范围：`src/main/provider/auth/chatgpt/`，以及 `auth/index.ts` 中的注册。

- [x] OIDC discovery 和 JWKS 缓存；用 Node `crypto` 校验 RS256 ID token。
- [x] 账号存储：带版本号的 envelope、safeStorage、`0600` 权限、原子写入、损坏文件备份。
- [x] 授权尝试：host ID、state/nonce/PKCE、`127.0.0.1` loopback、新注册和重新授权的参数、
      回调中 client ID 规则、换 token、身份与 scope 校验。
- [x] 在取凭证时刷新（串行化）、判定不可用的 refresh token、rejected-lease 强制刷新。
- [x] 退出登录：撤销、退避重试、本地清除、保留注册。
- [x] 提示状态（`welcome`、`codexRetired`）和 `dismissNotice`。
- [x] 路由与事件；登录成功后由组合根启用 `chatgpt` 并刷新模型目录，退出后清空目录。

## 3. 服务商与模型目录

- [x] `defaults.ts` 新增 `chatgpt`；`providerId.ts` 把它归入 `openai`。
- [x] 注册表定义和 `chatgpt` 模型来源；`AiSdkProvider` 从 `/v1/models` 获取模型。
- [x] 目录服务把 `chatgpt` 当作 runtime 来源。

## 4. dim 原生连接

- [x] `modelCatalog.ts`：凭证引用 `deepchat/chatgpt/v1/`，base URL 固定，不注入自定义请求头。
- [x] `providerCredentials.ts` 返回 `openai-chatgpt` 连接。
- [x] `provider_connections.rs` 新增 ChatGPT 预设：只接受 `https://api.openai.com/v1` 和
      Responses 协议。
- [ ] dim 发布包含 PR #2076（`697b4018d`）的版本后，升级 `resources/dim-runtime-lock.json`。
      当前锁定的 alpha.23 和最新的 alpha.27 都不包含该提交；在此之前，推理请求会因缺少
      `openai-chatgpt` 整形被拒绝。

## 5. 渲染进程

- [x] `ChatGPTAuth.vue`：设置页连接区。
- [x] `WelcomePage`：主入口和原地状态行；授权成功后把服务商相关的引导步骤标记为完成。
- [x] `ChatGPTNoticeDialog`：首次授权确认弹窗和 Codex 下线提示，挂在主窗口。
- [x] `ChatStatusBar`：Using ChatGPT plan · Manage usage；服务商已下线的会话模型显示为空。
- [x] `MessageBlockError`：额度耗尽、资格受限、需要重新连接三种恢复动作。
- [x] devkit 的官方标识资产，附 `NOTICE.md`。
- [x] 新增 `chatgpt` i18n 命名空间，覆盖全部语言。`bo-CN`、`mn-Mong-CN`、`ug-CN` 暂用英文，
      待母语译者补全。

## 6. 下线 Codex

- [x] 迁移：受影响标记、`openai-codex` 加入两处 `DEPRECATED_BUILTIN_PROVIDER_IDS`、移除
      `openaiAuthMode`、删除 `openai-codex-auth/`。
- [x] 删除 Codex 认证、适配器、注册表定义、模型来源、路由、事件、共享类型、
      `OpenAICodexOAuth.vue`、OpenAI 认证方式切换、原生 Codex 预设和请求头伪装、CLI 错误映射、
      图标和 i18n 文案。
- [x] 删除或改写依赖 Codex 的测试。
- [x] 更新 `provider-runtime` 和 `provider-catalog` 规格中的 Codex 段落；删除
      `openai-codex-image-generation` 文档。

## 7. 整体检查与验证

- [x] format、i18n、lint、typecheck。
- [x] 持久测试：账号所有者（注册、重新授权、身份/客户端不匹配、ID token 校验、plan scope、
      串行刷新与轮换、不可用 refresh token、撤销），Codex 下线迁移，原生 ChatGPT 预设主机校验。
- [ ] 升级 dim 后，用真实 Plus 或 Pro 账号手动验收 spec 中的验收标准，包括带工具调用的两轮
      对话和请求整形抓包。
