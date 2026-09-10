# MioWork

MioWork，一个简单易用的 Agent 客户端。基于开源项目 [DeepChat](https://github.com/ThinkInAIXYZ/deepchat)（Apache-2.0）的二次开发发行版，品牌与发布渠道由本仓库的 OEM 层管理。

## OEM 结构

- `oem/oem.config.json` —— 品牌映射的唯一来源（产品名/appId/仓库/URL）
- `oem/apply.mjs` —— 幂等重放脚本：`pnpm run oem:apply`
- `oem/assets/logo.png` —— 源 logo（应用图标由它生成）

## 与官方 DeepChat 同步更新

```bash
git fetch upstream --tags                # upstream = https://github.com/ThinkInAIXYZ/deepchat
git merge <目标 tag 或 upstream/dev>      # 本仓库 main 与 v1.1.2-beta.1 已嫁接真实历史
pnpm install
pnpm run oem:apply                       # 重放全部品牌改动 + i18n value 替换
pnpm run i18n && pnpm run lint && mise exec -- pnpm run typecheck && pnpm run test:main
```

合并冲突原则：**凡在下面禁改清单里的，一律保留上游写法**；品牌差异交给 `oem:apply` 重放，
不要在源文件里手工维护品牌串。

## 禁改清单（内部运行时标识，改了会破坏数据迁移/IPC/插件合同）

- `agentType: 'deepchat'`、`window.deepchat`、`DEEPCHAT_*` 环境变量与 IPC 频道名
- `src/main/agent/deepchat/` 模块路径、`deepchat://` 协议、CLI 二进制名 `deepchat`
- resources/skills 内置技能名（`deepchat-cli`/`deepchat-settings`）与技能内 CLI 命令字面量
- i18n key 与值中的小写 `deepchat`（受保护内置 Agent 的数据库标识）、`deepchat-inmemory`
- CUA 插件资产名（DeepChat Computer Use.app 等）与 `electron-builder.yml` 的 `signIgnore`
- `x-scheme-handler/deepchat`、上游插件/公共配置下载源（保持跟随官方更新）
- GitHub Copilot OAuth 回调（需自有 GitHub OAuth App，经 `.env` 的
  `VITE_GITHUB_CLIENT_ID/SECRET/REDIRECT_URI` 覆盖，见 `.env.example`）

## 验证

```bash
pnpm run oem:apply
grep -rn "DeepChat\|ThinkInAIXYZ\|deepchatai.cn" src/ test/ scripts/ resources/skills/ electron-builder.yml package.json \
  | grep -v -E "agent/deepchat/|window\.deepchat|DEEPCHAT_|deepchat://|'deepchat'|deepchat-inmemory|scheme-handler/deepchat|data-testid|deepchat\.exe|deepchat\.cmd|deepchat\.mjs|deepchatAgents|deepchatSettings|deepchatType|Copilot|copilot|oauth|OAuth|signIgnore|Computer Use|PublicProviderConf|tape"
```

Node 版本要求见 `mise.toml`（Node 24.x / pnpm 10.x）。
