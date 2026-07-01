# Assistant Permission Review Mode Specification

## 背景

当前 DeepChat 的会话权限模式只有两个值：

- `default`：工具触发权限边界时，暂停当前 turn 并展示现有 permission overlay，让用户批准或拒绝。
- `full_access`：在多个工具分支中自动批准权限，并且 agent tool precheck 会收到
  `allowExternalFileAccess: true`。

用户需要一个更接近 `full_access` 的模式：默认让助手有足够能力完成任务，包括访问用户明确让它处理的外部文件；但在执行高影响动作前，让模型 reviewer 做语义风险判断。附加的 Codex Approve for me 分析给出的关键约束仍然成立：模型 reviewer 只能做语义判断，不能替代确定性 hard deny、沙箱和执行边界。

## 反驳点

这个功能不应实现为“稍微放开的 default”。正确语义更接近 `full_access`：能力面默认打开，但执行器要把具体外部文件、命令、MCP 写入、设置变更等高影响动作转成 exact action 交给 reviewer。Reviewer 批准的是具体动作，不是给整个会话无限背书。

## 用户需求

作为 DeepChat 用户，我希望在保留权限保护的前提下，让助手模型自动处理明显安全的权限请求，只在请求可能有风险、信息不足或 reviewer 失败时再打断我。

## 目标

新增会话权限模式 `auto_approve`，UI 可显示为 `Approve for me` / `助手代审`。

该模式的行为：

1. 工具能力面接近 `full_access`，包括允许访问 workspace 外文件。
2. 外部文件访问不是默认拒绝项；风险由具体路径、操作、内容、数据流和用户授权决定。
3. 需要把原本 `full_access` 会直接放行的高影响动作转成可审查 action，不只接管现有 permission overlay。
4. reviewer 判断为 `auto_allow` 时自动执行当前 exact action。
5. reviewer 判断为 `ask_user`、超时、解析失败、hash 不匹配或 post-policy 不通过时，展示现有 permission overlay。
6. reviewer 判断为 `block` 或 deterministic hard deny 时直接阻断，不交给用户误点放行。

## 当前 UI 和目标 UI

Before:

```text
[shield] Default permissions v
  ✓ Default permissions
    Full access
```

After:

```text
[shield-check] Approve for me v
    Default permissions
  ✓ Approve for me
    Full access
```

ACP agent 当前隐藏权限模式下拉；首版不改变 ACP 行为。

## 权限模式语义

| Mode | Capability surface | Review behavior | External file access | User prompt |
| --- | --- | --- | --- | --- |
| `default` | Existing guarded surface | No model review | Requires existing permission approval | Always for permission request |
| `auto_approve` | Close to `full_access` | Exact-action reviewer before high-impact execution | Allowed when reviewed action is safe enough | On `ask_user` or reviewer failure |
| `full_access` | Existing full access behavior | No model review | Allowed | No, unless unrelated provider flow requires it |

## Reviewer Decision Contract

Reviewer 输出必须是 strict JSON：

```typescript
interface PermissionReviewDecision {
  actionHash: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  userAuthorization: 'unknown' | 'low' | 'medium' | 'high'
  decision: 'auto_allow' | 'ask_user' | 'block'
  rationale: string
}
```

Post-policy 首版规则：

- `critical` 永远不能自动批准。
- `high` 默认询问用户；如果用户在当前 turn 明确授权了同一目标和不可逆副作用，可自动批准。
- `medium` 可自动批准，除非涉及凭据导出、批量删除、安全设置弱化或不可信网络发送私有数据。
- `low` 可自动批准。
- `block` 用于 deterministic hard deny 或 reviewer 明确识别恶意/不可接受行为；产品表现为工具失败，不执行动作。
- 任意 reviewer 异常、超时、空输出、非法 JSON、hash mismatch 都转为 `ask_user`，不执行动作。

## Exact Action Envelope

首版从工具调用上下文、外部文件访问候选、现有 `PendingToolInteraction.permission` 生成 envelope。不能只依赖现有 permission request，因为 `full_access` 分支会绕过部分请求，尤其是外部文件访问。

```typescript
interface PermissionReviewActionEnvelope {
  version: 1
  kind: 'tool_permission'
  sessionId: string
  messageId: string
  toolCallId: string
  toolName: string
  serverName?: string
  toolArgsDigest: string
  permission: {
    permissionType: 'read' | 'write' | 'all' | 'command'
    description: string
    providerId?: string
    requestId?: string
    command?: string
    commandSignature?: string
    paths?: string[]
    commandInfo?: {
      command: string
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      suggestion: string
      signature?: string
      baseCommand?: string
    }
  }
  createdAt: string
  nonce: string
}
```

Canonicalization 使用稳定 JSON 排序和 SHA-256。执行前必须复核 action hash；批准只绑定当前 exact action。对于仍走现有权限缓存的动作，可复用 `approvePermission()`；对于 `full_access` 风格的外部文件动作，执行器必须把 reviewer 通过的 action 作为一次性执行授权，而不是写入长期会话白名单。

## Context 输入

Reviewer prompt 只接收必要证据：

- 当前用户请求的短摘要。
- 最近少量对话片段，按预算截断。
- tool name、server name、permission request、command/path 信息。
- action envelope 和 action hash。

所有 transcript、tool args、tool output、permission description 都标记为 untrusted evidence。首版不让 reviewer 调用读写工具；如果误询问率过高，再增加只读调查能力。

## 使用模型

默认使用当前 DeepChat agent 的 `assistantModel`；如果未配置，则回退当前会话模型。调用走 main process 现有 provider rate limit 和 standalone completion 能力。Reviewer session 不持有写权限，不递归发起 permission request。

## Acceptance Criteria

1. Shared `PermissionMode`、route schema、domain schema、session DB table typing、agent config typing、draft store、session create/update/get flow 都支持 `auto_approve`。
2. 旧的 `default` 和 `full_access` 会话、agent 配置、数据库记录继续按原语义加载。
3. Chat status bar 的权限菜单展示三项，并能对草稿会话和已有会话读写 `auto_approve`。
4. `auto_approve` 模式下，agent tool 可以获得 full-access-like 能力面，包括外部文件访问。
5. 工具产生权限请求或 full-access-like reviewable action 候选时，`auto_approve` 先生成 exact action envelope、action hash 和 reviewer prompt。
6. Reviewer `auto_allow` 且 post-policy 通过时，只执行同一个 action hash 对应的动作；现有 permission request 可调用 `approvePermission(sessionId, permission)` 后重试原工具。
7. Reviewer `ask_user`、失败、超时、非法结构、hash mismatch 或 post-policy 不通过时，展示现有 permission overlay，用户仍可手动批准或拒绝。
8. Reviewer `block` 或 deterministic hard deny 时不执行工具，并把工具结果标记为失败。
9. 审计日志至少记录 session id、tool name、permission type、action hash、decision source、risk level、latency 和失败原因；不得记录完整 secret、完整文件内容或未脱敏大 payload。
10. ACP permission resolver 行为首版不变；不把远端 ACP `session/request_permission` 自动接入 reviewer。

## 非目标

- 不新增全局企业策略编辑器。
- 不新增 reviewer 专用模型设置页；先复用现有 `assistantModel`。
- 不改变 MCP server 自身的 auto-approve 配置。
- 不改变 `full_access` 当前语义。
- 不实现 reviewer 的文件系统只读调查工具。
- 不为 ACP agent 接入自动 permission review。

## Open Questions

Resolved: `auto_approve` 是 full-access-like 能力面加模型 reviewer 防高危操作，不是 default 权限面加自动审批。
