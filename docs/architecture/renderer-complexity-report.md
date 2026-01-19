# Renderer Complexity & Order Report

## 结论摘要
当前渲染进程呈现“多入口 + 多领域 + 强耦合 + 分散事件”的典型复杂度形态。短期内更适合通过“边界收敛 + 事件集中化 + 状态分层”的方式逐步收敛，而不是大规模重构。建议以可观测性与边界规则为先，再逐步拆分职责，最后统一基础设施与入口形态。

## 范围与方法
范围覆盖 `src/renderer/` 下主渲染端与多入口（main/shell/settings/floating/splash）。本报告基于结构扫描与抽样阅读（如 `App.vue`、核心 store、IPC 监听分布）。结论用于指导整理路径，不追求穷尽细节。

## 复杂度画像（结构性驱动）
- 多入口并存（main/shell/settings/floating/splash），形成重复的初始化与依赖注入形态。
- 组件与状态规模较大，且多级目录聚合（`components`/`stores`/`composables` 数量上百级别），横向依赖多。
- 业务状态与 UI 状态混杂，部分 store 兼具领域逻辑、缓存、IPC 监听与界面协调。
- 事件与 IPC 监听分散在多个组件与 store 中，生命周期与职责边界难以追踪。
- 组合式函数（composables）既承担 UI 行为，又参与领域流程，角色边界不清。

## 混乱度画像（可维护性信号）
- 责任聚合：存在“单文件承担多流程”的核心 store 与组件。
- 事件耦合：同一领域的事件在多处订阅，追踪链路需要跨文件上下文。
- 边界隐式：跨模块导入较自由，缺少明确的依赖方向约束。
- 初始化散落：路由、状态、IPC、主题/字体等初始化行为聚集在上层组件。
- 重复形态：多入口之间存在重复初始化与样式依赖，增加长期成本。

## 架构师视角的有序化模式
以下模式用于“逐步收敛”，优先保证可靠性与可演进性：

1) **分层与边界收敛**
- 以 “UI / Application / Domain / Infra” 四层为主线，明确依赖方向（UI -> App -> Domain -> Infra）。
- store 仅负责 application state；领域逻辑移入 domain service 或 use-case 层。

2) **事件与 IPC 集中化**
- 以单一 IPC 入口/适配层封装 `window.electron` 调用，减少分散监听。
- 事件名与 payload 通过 shared type 对齐，避免隐式契约。

3) **按领域切分模块**
- 以 feature module 组织：`features/<domain>/components|store|composables|services`。
- 禁止跨 feature 的 UI 互相引用，仅允许通过 domain or app 层 API 交互。

4) **组合根（Composition Root）最小化**
- `App.vue` 只承担装配与路由壳职责，避免业务逻辑与副作用聚集。

5) **可观测性与治理规则先行**
- 对依赖边界、store 大小、IPC 使用量建立可度量信号，避免“重构后再失控”。

## 分阶段推进路线（建议）
### Phase 0 — 可观测与规则（2-3 周）
- 绘制渲染端模块图与依赖方向草图（只需粗粒度）。
- 为 IPC 监听与事件约定建立统一入口与清单。
- 增加轻量规则：禁止跨层反向依赖；限制 `window.electron` 仅在 infra 层使用。
- 建立最小指标：store 行数上限、跨模块导入数量、IPC 监听分布。

### Phase 1 — 边界切分与职责下沉（3-6 周）
- 从最大 store 开始拆分：抽出 domain service 与 use-case，store 只保留状态与 orchestration。
- 将分散 IPC 监听迁移到单一 adapter 或事件网关。
- 以 1-2 个核心域为试点（例如会话或配置），验证分层边界是否可落地。

### Phase 2 — 模块化收敛与入口整理（持续迭代）
- 逐步迁移到 feature module 目录结构，减少“全局 components”依赖。
- 统一多入口的基础设施层（i18n、theme、icons、pinia）为共享装配模块。
- 清理重复逻辑与过度通用组件，回收不再使用的事件与 store。

## 可靠与精简的落地准则（简化版）
- **最小可变面**：将副作用集中到边缘层（IPC/IO），核心逻辑保持纯净。
- **单一事实来源**：每个领域只有一个权威 state 与 data flow。
- **边界可视化**：模块结构能表达真实依赖，不依赖口头约定。
- **小步验证**：每一轮拆分都能独立回退，不影响用户主路径。

## 建议的度量信号（低成本）
- 单个 store 行数与跨模块依赖数。
- `ipcRenderer.on` 的分布文件数与集中度。
- `App.vue` 与顶层入口文件的依赖数量。
- feature module 内外的依赖流向（是否出现反向依赖）。

## 域清单（Renderer 视角）
以下域划分用于整理与迁移的主线，命名以业务语义为主，而非目录名：

- **Conversation & Message**：会话、消息流、变体、缓存与滚动定位等。
- **Chat Input & Composer**：输入、命令、快捷能力、会话发起与编辑。
- **Model & Provider**：模型能力、供应商、模型配置与检查。
- **MCP & Tools**：MCP 服务、采样、工具调用与状态。
- **Workspace & Artifacts**：工作区、附件、产物与导出。
- **Search & Retrieval**：搜索引擎、检索助手与历史。
- **Navigation & Layout**：路由、布局、侧边栏、导航行为。
- **Settings & Preferences**：用户设置、主题、字体、语言、声音等。
- **Shell & Windowing**：多入口外壳、窗口状态与系统交互。
- **Sync & Upgrade**：同步、备份/导入、更新。
- **Notifications & Dialogs**：系统通知、应用内提示、弹窗。

## 按域整理优先级（建议）
优先级按“业务核心性 + 复杂度/风险 + 影响面”综合排序：

1) **Conversation & Message**  
   核心价值链路，状态与事件最重，拆分收益最大。
2) **Chat Input & Composer**  
   高交互密度、联动多，边界不清导致缺陷密度高。
3) **Model & Provider**  
   依赖外部服务，状态与配置复杂，稳定性影响大。
4) **MCP & Tools**  
   事件与 IPC 多，接口契约风险高，需尽早集中化。
5) **Workspace & Artifacts**  
   数据与 UI 联动多，适合作为第二波治理试点。
6) **Navigation & Layout**  
   需要收敛顶层副作用，便于后续模块化。
7) **Settings & Preferences**  
   变更频率高但影响相对局部，可在前几域稳定后整理。
8) **Notifications & Dialogs**  
   横切关注点，适合在事件/IPC 收敛后统一封装。
9) **Sync & Upgrade**  
   可靠性敏感但相对独立，适合中后期清理。
10) **Search & Retrieval**  
   业务重要但相对独立，可在核心链路稳定后整理。
11) **Shell & Windowing**  
   入口与宿主相关，宜在主渲染端稳定后统一收敛。

## 下一步建议（最小行动）
1) 选定一个最核心域作为试点，定义清晰边界与 API。
2) 建立 IPC 适配层并迁移 1-2 个监听点，验证流程是否顺滑。
3) 用一页模块图统一团队认知，作为后续整理的“地图”。
