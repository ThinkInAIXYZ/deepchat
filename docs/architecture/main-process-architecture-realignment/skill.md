# Skill 模块边界

> 状态：已实施，等待最终验收
> 范围：Skill 文件、目录扫描、同步、Plugin 登记和 Session 选择

## 先说结论

Skill 是一个进程级能力模块，不属于 Agent、Session、Plugin 或 Tool。

它负责回答三类问题：有哪些 Skill、某个 Skill 包含什么、某个 Session 选择了哪些 Skill。
其中 Skill 文件和缓存由 Skill 负责，Session 的选择结果仍由 Session 保存。Skill 只能通过明确的
Session 数据接口读取和修改这份选择结果，不能自己再保存一份。

外部工具扫描、导入和导出属于 Skill 模块内部的同步功能。它不是一个与 Skill 并列的顶层模块，
也不应通过 `Presenter` 互相查找。

## 负责的状态和资源

| 内容 | 类型 | 负责方 | 结束时间 |
| --- | --- | --- | --- |
| `~/.deepchat/skills/` 中的 Skill 文件 | 长期文件 | Skill | 用户删除或卸载 Skill |
| Skill 管理信息和同步设置 | 长期设置 | Skill | 用户修改或删除对应设置 |
| 每个 Session 选择的 Skill 名称 | Session 长期数据 | Session | Session 删除 |
| Skill metadata 和 content cache | 进程内计算结果 | Skill | Skill 变化或 App 退出 |
| Plugin 提供的 Skill 列表 | 进程内登记 | Skill | Plugin 停用或 App 退出 |
| Skill 文件 watcher | 外部资源 | Skill | Skill 停止或 App 退出 |
| 外部工具扫描结果 | 可重建缓存 | Skill 同步功能 | 下次扫描覆盖或设置清理 |
| 同步时的 project root | 进程内上下文 | Skill 同步功能 | App 退出 |

## 生命周期

### 创建

App 创建一个 `SkillService`，并明确传入：

- Skill 设置读取能力；
- Session Skill 选择数据接口；
- 文件 watcher；
- 向 renderer 发布已发生事实的函数。

App 再创建同属 Skill 模块的 `SkillSyncService`。它直接接收 `SkillService` 和同步设置能力，
不通过全局入口取得依赖。

### 启动

固定顺序如下：

1. `SkillService.initialize()` 安装内置 Skill、清理过期草稿、扫描目录并启动 watcher；
2. Plugin 启动时把自己提供的 Skill 直接登记到 `SkillService`；
3. MCP 启动；
4. App 空闲后台任务调用 `SkillSyncService.scanAndDetectNewDiscoveries()`。

Skill 被设置关闭时，App 不启动 Skill watcher 和后台扫描。调用顺序保持现状，不新增自动恢复或
第二条启动路径。

### 运行

- Skill 文件变化后，Skill 自己刷新 metadata 和 content cache，再发布 catalog 已变化的通知；
- Agent 和 Tool 只读取 Skill catalog、内容、脚本和允许的 Tool，不负责扫描或保存 Skill；
- Session 创建、恢复或设置变化时，Session 保存 Skill 名称，Skill 负责校验名称是否仍然有效；
- Plugin 启用时直接登记贡献，停用时直接撤销该 Plugin 的全部贡献；
- 同步操作先预览再执行，文件复制、格式转换和安全检查留在 Skill 模块内部。

### 停止

App 先停止会继续使用 Skill 的后台任务和 Plugin，再停止 Skill：

1. `SkillSyncService.destroy()` 清理同步运行上下文；
2. `SkillService.destroy()` 停止 watcher，清空进程内缓存；
3. Session 中保存的 Skill 选择和磁盘上的 Skill 文件不因 App 退出而删除。

`destroy()` 可以重复调用，但不保留旧 `Presenter` 的停止入口。

## 允许的依赖

```text
App ───────────────> Skill
Plugin ────────────> Skill contribution
Agent / Tool ──────> Skill query and execution data
Routes ────────────> Skill operations
Skill ─────────────> Session skill-state port
Skill ─────────────> settings / watcher / renderer event publisher
SkillSync ─────────> Skill
```

禁止的方向：

- Skill 不导入 Agent、Tool、Plugin、Routes 或 App；
- Skill 不拥有 Session，也不维护另一份 Session Skill 选择；
- Plugin 不直接修改 Skill cache 或 Skill 文件；
- Tool 不负责安装、同步或启停 Skill；
- `SkillSyncService` 不成为新的总入口。

## 对外操作分组

不再用一个名字暗示所有调用方都需要完整接口。调用方只接收自己需要的操作：

- Agent / Tool：catalog、content、active Skill、allowed Tool、script；
- Session：校验和修改 active Skill；
- Plugin：登记和撤销 Plugin Skill；
- Routes：安装、卸载、文件编辑、同步预览和执行；
- App：`initialize()`、后台扫描和 `destroy()`。

现在已有的共享数据结构和 route 输入输出继续保持原文。只有进程内实现接口从旧的
Presenter 接口改为 `SkillServicePort` / `SkillSyncServicePort`。

## 实施批次

1. 删除两个旧 Skill Presenter 目录和对应旧测试路径；
2. 把唯一实现和测试移入 `src/main/skill/` 与 `test/main/skill/`；
3. 把类名改为 `SkillService` 和 `SkillSyncService`，并删除旧名字和旧导出；
4. App、Routes、Agent、Tool、Plugin 和测试全部改用新路径和新名字；
5. Plugin contribution 方法改为必需调用，删除方法存在检查和可选接口；
6. 增加架构检查，禁止旧目录、旧类名和旧接口名重新出现；
7. 更新当前架构文档并运行 Skill、Plugin、Tool、Session 相关测试。

每一批都先删除旧路径和旧引用，再写新路径；不建立转发文件、别名、fallback 或新旧双轨。

## 完成条件

- 搜索不到旧 Skill Presenter 目录、类名和接口名；
- App 的启动和停止顺序没有改变，原来等待完成的操作继续 `await`；
- Session 中已有的 active Skill 数据、Skill 文件、管理信息和同步设置不迁移、不改含义；
- Plugin 启停会完整登记和撤销 Skill，不依赖可选方法；
- catalog、安装、同步、Session 选择、Agent/Tool 读取和 watcher 测试通过；
- 自动检查阻止旧路径和旧名字重新进入生产代码。
