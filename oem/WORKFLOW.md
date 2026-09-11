# OEM 工作流：Git 仓库管理与发布流程

本文档描述 MioWork（OEM 发行版）在本仓库如何管理与官方 DeepChat 的关系：上游同步、品牌重放、验证与发版。

> 上游自己的发布流程见 `docs/release-flow.md`（dev/main 分支 + `release.yml` + 19 资产 draft）。
> **本仓库不使用该流程**：我们用单主干 + `miowork-v*` tag + `manual-build.yml`。

## 1. 总体模型

单仓库、单主干、双 remote。OEM 版与原版**不靠分支隔离**，而是：

**一条 main = 上游真实历史（merge 嫁接） + 可重放的 OEM 层（`oem/apply.mjs`）**

| remote | 地址 | 用途 |
| --- | --- | --- |
| `origin` | `git@github.com:chenjiaqiangmax/deepchat.git` | 我们的 OEM 仓库（读写） |
| `upstream` | `https://github.com/ThinkInAIXYZ/deepchat` | 官方原版（只 fetch，永不 push） |

官方原版在本仓库没有对应分支：它以 fetch 下来的 tag / 提交形式存在。main 通过真实 merge 嫁接官方历史，因此 `git log` / `git blame` / `git bisect` 都能跨 OEM 与上游追溯。

## 2. OEM 重放层（`oem/` 目录，100% 自有，上游零冲突）

| 文件 | 作用 |
| --- | --- |
| `oem/oem.config.json` | 品牌映射唯一来源（产品名 / appId / 仓库 / 下载 URL） |
| `oem/apply.mjs` | 幂等重放脚本：`pnpm run oem:apply`，把品牌差异机械铺开 |
| `oem/assets/logo.png` | 源 logo（应用图标由它生成） |
| `oem/WORKFLOW.md` | 本文档 |

apply 覆盖面（约 290 个文件）：`package.json`（name/author/description）、`electron-builder.yml`（appId/productName/publish）、20 语言 i18n value、内置技能目录改名（`resources/skills/miowork-cli`、`miowork-settings`）、用户数据根字面量（`~/.miowork`，原 `~/.deepchat`）等。

### 禁改清单（运行时功能合同，永不品牌化）

- `agentType: 'deepchat'`、`window.deepchat`
- `DEEPCHAT_*` 环境变量（`DEEPCHAT_SKILL_ROOT` 已双写 `MIOWORK_SKILL_ROOT`，旧名保留给已发布脚本）
- `src/main/agent/deepchat/` 内部代码目录
- `deepchat://` 协议、`x-deepchat-*` HTTP 头、`scheme-handler/deepchat`
- CLI 二进制名 `deepchat`（`out/cli/deepchat` / `.cmd` / `.mjs`）及技能文档里的命令字面量
- 数据库内部命名（`deepchatMessagesTable` 等）与 skills 树内 `.agent-scopes/deepchat/`（agentId 标识）

判据：**用户看得见的品牌 → 改；进程 / 协议 / 存储的内部标识 → 不改**。改了合同标识会让设置工具、CLI、agent 调度失效。

## 3. 与官方上游同步

```bash
git fetch upstream --tags
git merge v1.1.2-beta.N          # 跟官方发布 tag；不跟 dev 未发布提交
pnpm install                     # 拉齐依赖
pnpm run oem:apply               # 冲突文件取上游后，品牌差异机械重放
pnpm run i18n && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run build
```

- **冲突原则**：凡品牌面（apply 覆盖的文件），merge 时一律保留上游写法，交给 `oem:apply` 重放；不要在源文件里手工维护品牌串。
- **结构性自有改动**（删除关于页、skills 改名、数据根迁移等）是独立 commit：上游没碰就自然保留，上游碰了才手工解决。
- **自有新逻辑放独立新文件 + 一行挂钩**（如 `src/main/app/startupMigrations/` 数据根迁移模块），上游冲突面 ≈ 0；锚点失配时 apply 显式报错而不是静默错改。
- `~/.deepchat` 系数据根字面量是上游自己的用户数据兼容承诺（他们改 = 砸自己用户），相关行是全库最不可能变动的，重放规则长期有效。

## 4. 发版流程

| tag 形态 | 归属 | 效果 |
| --- | --- | --- |
| `v*.*.*` | 官方 | 只作 merge 目标，不触发本仓库任何流水线 |
| `miowork-v*` | 我们 | 触发 `.github/workflows/manual-build.yml`：6 平台打包（macOS/Windows/Linux × x64/arm64）→ publish job 用 `gh run download` 收齐本 run 的 artifacts → 自动创建 release 并挂 8 个安装包（dmg ×2、exe ×2、AppImage ×2、tar.gz ×2） |

发版步骤：

```bash
# 0. 确认 package.json version 已是目标版本（上游 merge 会自动带入对应版本）
git push origin main
git tag miowork-v1.1.2-beta.N
git push origin miowork-v1.1.2-beta.N
```

验证发布（短超时 curl 探 GitHub API，不要用会被自身超时杀掉的慢命令）：

```bash
# run 终态
curl -sS "https://api.github.com/repos/chenjiaqiangmax/deepchat/actions/runs/<run_id>" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['status'],d['conclusion'])"
# release 资产数（应 >= 6，当前为 8）
curl -sS "https://api.github.com/repos/chenjiaqiangmax/deepchat/releases/tags/miowork-v1.1.2-beta.N" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(len([a for a in d['assets'] if not a['name'].startswith('Source')]))"
```

全绿判据：6 个 job 全 `success`、release 非草稿、安装包资产在位。

## 5. 验证环境备忘

- Node ≥ 24.18 / pnpm 10.34.5（`mise.toml` 与 `package.json` engines 钉死）。沙箱 / 默认 PATH 可能命中旧版 pnpm（报 `packages field missing` 即是），验证链一律显式走正确 PATH。
- 长链验证（i18n → lint → typecheck → test → build）写成脚本后台跑，各步退出码写入 `/tmp/<chain>-status.txt`，以状态文件收口，不依赖交互终端退出码。
- 全量测试约 1.09 万用例；历史红大多是「断言没跟随 OEM 改动」，按「apply 同步改断言」模式处理。

## 6. 历史里程碑（溯源用）

- `d51e29ab6` 删除设置页「关于」入口
- `98ba83da9` merge 上游 `v1.1.2-beta.3`（429 文件，7 冲突全取上游 + apply 重放）
- `261510436` 内置技能改名 `miowork-*`（工具名 / CLI 命令字面量保留）
- `861750076` 数据根迁移 `~/.deepchat` → `~/.miowork`（marker 判据 + 仅 skills 子树幂等合并）
- 发布 tag：`miowork-v1.1.2-beta.1` 起，当前最新 `miowork-v1.1.2-beta.5`
