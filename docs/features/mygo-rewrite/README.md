# mygo 迁移：执行者必读（先读这一份）

你是接手执行的 AI。这份文档规定了你能做什么、不能做什么、按什么顺序做。请逐字遵守，不要自行扩大范围。

## 1. 背景

- 目标：把 DeepChat 的桌面壳从 Electron 换成 mygo（https://github.com/egoist/mygo，Go 写的桌面框架，窗口用系统 webview，不带 Chromium）。尽可能保留功能和界面一致。
- 分支：`feat/mygo-rewrite`，从 `dev` 切出。仓库根目录 `/Users/colab/Documents/deepchat`。
- 总体方案：方案 B。Renderer（Vue）基本不改；Go + mygo 负责窗口、托盘、更新、密钥、打包；现有 TS 业务逻辑（agent、provider、mcp、session、memory 等）先跑在 Node sidecar 进程里。详见 `feasibility-and-plan.md`。
- 不要把 main 的 TS 业务代码改写成 Go。这不在本轮范围内。

## 2. 文档阅读顺序

1. 本文件
2. `feasibility-and-plan.md`：分析与方案，重点读第 4、5、6、10 节
3. `plan.md`：你要执行的任务清单（按里程碑，每个任务有完成标准）
4. `removal-checklist.md`：要删除功能的文件清单（实测 grep 结果）
5. `m0-spike.md`：Go 技术验证的规格与报告模板；实际结论见 `m0-report.md`
6. `acceptance-checklist.md`：当前进度与验收状态，给验收者看
7. `platform-abstraction.md`：阶段 B 的接口设计与进度
8. `boot-route-inventory.md`：渲染层冷启动调用清单（M2 的验收基线）
9. `database-decision.md`：数据库方案与原生模块实测结论
10. `composition-decomposition.md`：composition 拆解方案（剩余路由的唯一前提）
11. `review-notes.md`：给评审者的说明（变化、验证方式、重点看哪里）
6. 仓库根目录 `AGENTS.md`：项目规则，优先级高于本目录文档中与之冲突的内容

## 3. 已经确认的产品决策（不要重新讨论）

| 功能 | 决策 |
| --- | --- |
| 内置浏览器 YoBrowser 与 Agent 浏览器自动化（含 CDP） | 整体删除 |
| computer use 的 PiP 预览窗口 | 删除；CUA 插件本身保留 |
| 浮动按钮、悬浮聊天窗 | 删除，入口只剩主窗口与托盘 |
| GitHub Copilot 等 OAuth | 改成系统浏览器 + deep link 或 loopback 回调 |
| OCR（light-ocr）、sharp | 保留，放进 Node sidecar |
| Linux | 实验性支持，不阻塞发布 |
| MCP Apps 沙箱、workspace 预览 | 待 M0 结果再定，现在不要动 |
| 长图导出（滚动截图） | 待 M0 结果再定，现在不要动 |

还没拍板、需要你在合适时机停下来问用户的事项：

- D1：`BrowserProfileImportService` 和 `BrowserDataImportDialog`（从其他浏览器导入 cookie 等数据）是否随 YoBrowser 一起删除。默认倾向删除，但必须先读代码确认它是否只服务于 YoBrowser，见 `plan.md` 任务 A0。
- D2：Go 壳的代码放在本仓库哪个目录。默认放 `shell/`，见 `plan.md`。
- D3：M0 报告出来后，上面两个「待 M0 结果再定」的功能如何处理。

## 4. 硬性规则

来自 `AGENTS.md`，必须遵守：

- 只用 pnpm，不要用 npm 或 yarn。
- 代码风格：单引号、无分号、100 列（Oxfmt）。改完先跑 `pnpm run format`。
- 用户可见文案走 vue-i18n。有 23 个 locale 目录在 `src/renderer/src/i18n/`，删功能时每个 locale 的对应键都要删，以 `zh-CN` 为源。
- 改动要最小，不加无必要的抽象和依赖，不做无关重构。
- 动手前先看清：谁拥有这段代码、谁调用它、有哪些测试、附近的写法。
- 不要主动 commit。只有用户明确要求时才提交。提交信息用 Conventional Commits，主题不超过 50 字符，不加 AI 共同作者。
- 禁止的 git 操作：`git add -A`、`git add .`、`git stash`、`git reset --hard`、`git checkout .`、`git clean -fd`、`git commit --no-verify`、force push。
- 保留 provider 和 ACP registry 在正常 build 中产生的刷新。
- Renderer 不得直接访问原生能力，只能走 typed preload / IPC。

## 5. 你的工作方式

1. 一次只做一个任务，做完并通过该任务的「完成标准」再做下一个。
2. 每个任务开始前，先列出你要改的文件，再改。
3. 删除代码时，先用 grep 找全引用，再删，再跑类型检查。不要凭文件名猜。
4. 不确定是不是系统浏览器相关的引用（比如打开外部链接）时，不要删。只删与内置浏览器、CDP、浮动窗口、PiP 预览有关的。
5. 不要编造验证结果。没跑过的检查就写「未运行」。
6. 每完成一个任务，在 `plan.md` 对应任务前把 `[ ]` 改成 `[x]`，并在任务下面追加一行「结果：…」写明改了哪些文件、跑了哪些命令、结果如何。

## 6. 每个任务结束前必须跑的检查

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:main
pnpm run test:renderer
```

- 如果某条命令在你改动之前就失败，先在干净状态下记录失败，再区分是不是你引入的。
- `pnpm run i18n:types` 用来重新生成 `src/types/i18n.d.ts`，删除 i18n 键后要跑，不要手改这个文件。
- e2e：`pnpm run e2e:smoke`，只在任务要求时跑。

## 7. 遇到这些情况必须停下并问用户

- 发现某个要删除的模块还被保留功能使用，且无法简单拆开。
- 需要修改 `src/shared/contracts` 中保留功能的 route 或 event 合同。
- 需要修改数据库 schema、数据迁移或加密相关代码。
- 在 M0 中发现 mygo 缺少关键能力。写进报告，不要自己找绕路方案并继续推进。
- 任何命令需要联网而网络被拦截。注意：本机的网页抓取工具对 github.com、pkg.go.dev、mygo.egoist.dev 等域名报过 `blocked_address`（Fake-IP DNS）。遇到时如实记录，不要假装读过。
- 你的计划需要超出 `plan.md` 的范围。

## 8. 不要做的事

- 不要重新讨论已确认的决策。
- 不要删除用户数据、数据库表、设置存储里已有的键。只停止读取，数据保留（见 `plan.md` 任务 A6）。
- 不要碰 MCP Apps 沙箱、workspace 预览、长图导出，等 M0。
- 不要改 `package.json` 的依赖版本，除非任务明确要求。
- 不要升级 mygo 之外的 Go 依赖，不要引入 cgo 依赖而不记录。
