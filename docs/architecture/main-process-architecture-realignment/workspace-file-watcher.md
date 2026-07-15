# Workspace、File 和 watcher 模块边界

> 状态：已确认，已实施
> 范围：Workspace 的访问范围、文件展示、搜索、Git 状态和 watcher 生命周期，以及通用 File 能力和底层 watcher
> 书写规则：说明使用直白中文；代码标识、文件路径和命令保持原文。

## 先说结论

Workspace、File 和 watcher 不是同一个模块。

- Workspace 负责“当前哪些目录可以作为工作区使用，以及怎样展示和跟踪这些工作区”。
- File 负责“怎样识别、读取和转换一个文件，以及怎样处理临时文件和图片”。
- watcher 负责“怎样在系统上监听文件变化”，不理解 Workspace、Skill 或 Git 的产品含义。

它们的依赖方向固定为：

~~~text
Routes / Renderer
       |
       v
WorkspaceService ------> FileServicePort
       |
       +---------------> FileWatcherService
                             ^
                             |
                        SkillService
~~~

`FileWatcherService` 是底层能力。Workspace 和 Skill 可以使用它，但它不能反向读取 Workspace、
Skill、Session、Agent 或 Routes。

## 现有产品行为

### Workspace 从哪里来

Session 可以保存 `projectDir`。renderer 打开 Workspace 面板时，会把这个目录登记为可访问目录，
开始监听并读取文件树和 Git 状态。面板切换目录或销毁时，只停止对应监听。

聊天输入框的 `@` 文件搜索也会登记当前 Session 的 `projectDir`，然后在该目录内搜索可引用文件。
它不创建 Session，也不改变 Session 保存的数据。

因此，Workspace 是 Session 所引用目录的运行时视图，不是 Session 身份的一部分。Workspace
不能根据窗口或 tab 的关闭去删除 Session，也不能负责保存 `projectDir`。

### Workspace 现在提供什么

现有 route 和用户行为保持不变：

- 登记和撤销允许访问的 Workspace 或 workdir；
- 启动和停止 Workspace 文件、Git 变化监听；
- 读取和展开一级目录；
- 搜索 Workspace 文件，并过滤敏感文件和不适合引用的二进制文件；
- 生成文件预览，解析 Markdown 相对链接；
- 在系统文件管理器中显示文件，或用系统默认应用打开文件；
- 读取 Git branch、ahead/behind、status 和 diff；
- 向 renderer 发送 `workspace.invalidated` 和 `workspace.watch.status.changed`。

`workspace.register` 的 `mode` 继续兼容现有 `workspace` 和 `workdir` 输入，但这两个 mode 不再
对应 Workspace 内部的两套方法。它们进入同一个目录登记操作。

### watcher 现在服务谁

同一套 watcher 同时服务：

- Workspace 内容变化；
- Workspace Git 元数据变化；
- Skill 文件热更新。

底层 watcher 使用 utility process。原生监听不可用时，现有 snapshot polling 行为继续保留。
这是 watcher 自己的运行方式，不是架构迁移的兼容路径。

## 状态和唯一负责方

| 状态或资源 | 类型 | 创建时间 | 结束时间 | 唯一负责方 |
| --- | --- | --- | --- | --- |
| 已允许的 Workspace 根目录 | 进程内状态 | `workspace.register` | `workspace.unregister` 或 App stop | Workspace |
| Markdown 链接单文件授权 | 进程内状态 | 链接解析成功 | App stop | Workspace |
| Workspace preview 路径登记 | 进程内状态 | 目录或文件授权 | 撤销授权或 App stop | Workspace |
| 每个 Workspace 的内容监听租约 | 外部资源引用 | 第一个 `workspace.watch` | 最后一个 `workspace.unwatch` 或 App stop | Workspace |
| 每个 Workspace 的 Git 监听租约 | 外部资源引用 | 确认是 Git 仓库后 | 最后一个 `workspace.unwatch`、仓库变化或 App stop | Workspace |
| Workspace invalidation 合并计时器 | 短期状态 | 收到 watcher 变化 | 发送通知、停止监听或 App stop | Workspace |
| Workspace 搜索和 mtime cache | 计算结果 | 搜索时 | TTL、容量淘汰或 App stop | Workspace |
| 文件 adapter 和转换结果 | 单次操作 | File 调用开始 | 调用结束 | File |
| File 临时目录 | 进程级文件资源 | File 创建 | 继续沿用现有清理规则 | File |
| watcher pool 和两个 utility process | 进程级外部资源 | 首次监听 | App stop | App 创建，FileWatcherService 管理 |
| watcher 内部 watch request | 外部资源 | Workspace 或 Skill 申请 | 对应 handle 关闭或 watcher stop | FileWatcherService |

Workspace 的 watcher 租约按规范化后的目录合并并计数。同一路径被多个 renderer 使用时，只创建
一组 Workspace 内容和 Git 监听；最后一个使用方释放后才关闭。

允许访问的目录不与 watcher 租约混为一份状态。登记目录不会自动启动 watcher，停止 watcher
也不会自动撤销目录授权。

## Workspace 负责什么

Workspace 负责：

- Workspace 根目录和单文件访问范围；
- Workspace preview URL 的授权映射；
- Workspace 文件树、搜索和敏感文件过滤规则；
- Workspace 文件预览的展示分类；
- Markdown 链接在 Workspace 内的路径解析；
- Git 工作区发现、status 和 diff；
- 内容 watcher 与 Git watcher 的租约、重建和停止；
- 把底层 watcher 变化合并成 Workspace 通知。

Workspace 不负责：

- 创建、保存、删除或选择 Session；
- 保存 Session 的 `projectDir`；
- 通用文件 adapter、文档转换、临时文件或图片剪贴板；
- watcher utility process 的创建、重启和最终停止；
- Skill 文件热更新；
- renderer 是否刷新某个界面。

Workspace 只发出已经发生的变化通知。renderer 收到通知后决定刷新完整 Workspace、文件树或
Git 状态。通知不能反过来要求 Workspace 执行业务操作。

## File 负责什么

File 是进程级文件处理能力，负责：

- MIME 检测；
- 按文件类型选择 adapter；
- 把文件或目录转换为 `MessageFile`；
- 为 Workspace preview、Knowledge 和 Agent Tool 提供所需文件内容；
- Knowledge 可处理文件的校验和扩展名列表；
- `userData` 范围内的现有读写操作；
- 临时文件、base64 图片、图片保存和剪贴板复制。

File 不负责：

- Workspace 访问授权、文件树、搜索、Git 或 watcher 租约；
- Session 附件选择和长期保存；
- Knowledge 索引；
- Tool 权限判断；
- Config 的其他设置。

File 只读取 `maxFileSize` 所需的窄配置能力。调用方只接收自己使用的方法，不依赖完整
`FileServicePort`。

## watcher 负责什么

底层 watcher 放到 `src/main/platform/fileWatcher/`，负责：

- 合并相同 watch request；
- 启动 content 和 git utility process；
- 把 watch/unwatch/shutdown 请求发给 utility process；
- 原生 watcher、snapshot polling 和 Git metadata polling；
- event 合并、容量限制、状态通知和 utility process 重启；
- App stop 时关闭全部 watch 和 utility process。

watcher 不负责：

- 判断一个文件变化是否应该刷新 Workspace 或 Skill catalog；
- 解析 Git status；
- 发送 renderer event；
- 保存全局 singleton；
- 在 Workspace 或 Skill 销毁后继续保留未关闭的业务监听。

App 只创建一个 `FileWatcherService`，明确传给 Workspace 和 Skill。Workspace 与 Skill 先关闭
自己的 handle，随后 App 调用一次 `FileWatcherService.destroy()`。不再通过
`getFileWatcherService()` 隐式取得共享对象。

## 对外接口

### Workspace

进程内入口改为 `WorkspaceService` 和 `WorkspaceServicePort`。公开操作保持现有 route 所需能力：

- `registerWorkspace()` / `unregisterWorkspace()`；
- `watchWorkspace()` / `unwatchWorkspace()`；
- 文件树、预览、链接解析、系统打开、Git 和搜索操作；
- `destroy()`。

删除 `registerWorkdir()` 和 `unregisterWorkdir()` 这两个内部别名。route 的 `mode` 只负责把现有
输入转成统一的登记或撤销调用。

Workspace 通过构造参数接收：

- File 的预览转换能力；
- `FileWatcherService`；
- 两个 renderer 通知函数。

Workspace 不导入 Routes，也不自己查找 File 或 watcher。

### File

进程内入口改为 `FileService` 和 `FileServicePort`。共享类型从
`core.presenter.d.ts` 移到 `src/shared/types/file.ts`。删除 `IFilePresenter`、`FilePresenter`
和 presenter 路径，不保留同名别名。

### watcher

保留现有 `FileWatcherService`、`IFileWatcherService` 和 `WatchHandle` 等底层名称，因为它们描述
真实能力，不是 Presenter 命名。删除共享 singleton 的 getter 和测试 reset 方法；测试直接创建
实例或注入 fake。

## 启动和退出

### 启动

1. App 创建一个 `FileWatcherService`，此时不启动 utility process。
2. App 创建 `FileService`。
3. App 创建 Workspace，并传入 File、watcher 和通知函数。
4. App 创建 Skill，并传入同一个 watcher。
5. renderer 登记 Workspace 时只建立访问范围。
6. 第一个 `workspace.watch` 或 Skill watch 到来时，watcher 才按需启动对应 utility process。

### Workspace 切换

1. renderer 先释放旧 Workspace 的 watch 租约。
2. renderer 登记新 Workspace。
3. renderer申请新 Workspace 的 watch 租约。
4. Workspace 创建内容监听，并在确认 Git 仓库后创建 Git 元数据监听。
5. renderer 主动读取完整文件树和 Git 状态；后续变化由通知触发刷新。

### 退出

1. Workspace 停止接收新监听并关闭全部内容和 Git handle。
2. Skill 停止自己的 watch handle。
3. App 调用 `FileWatcherService.destroy()`，关闭 pool 和两个 utility process。
4. 其他模块停止后，App 再退出进程。

Workspace、Skill 和 watcher 的停止都必须允许重复调用。App 不通过全局 getter 查找 watcher，
也不让 Workspace 直接销毁共享 watcher。

## 文件位置

实际位置：

~~~text
src/main/
  file/
    index.ts
    ports.ts
    adapters/...
    mime.ts
    validation.ts
  workspace/
    index.ts
    ports.ts
    directoryReader.ts
    fileSearcher.ts
    fileSecurity.ts
    pathResolver.ts
    workspaceFileSearch.ts
    workspacePreviewProtocol.ts
  platform/
    fileSearch/
      fffSearchService.ts
    fileWatcher/...
  fileWatcherUtilityHostEntry.ts
~~~

`fileWatcherUtilityHostEntry.ts` 继续作为单独构建入口，生成文件名和启动参数保持不变。

不会建立 `WorkspaceManager`、`FileManager`、`PlatformManager` 或汇总 File、Workspace、Skill 的
新总入口。

## 实施顺序

这一批遵守删除优先规则：

1. 先删除旧 `presenter/filePresenter`、`presenter/workspacePresenter`、旧测试路径和旧 interface；
2. 先删除 `getFileWatcherService()` 及依赖它的隐式构造路径；
3. 再建立唯一的 `file/`、`workspace/` 和 `platform/fileWatcher/` 实现；
4. 同一批改完 App、Routes、Tool、Knowledge、Remote、Skill、protocol 和测试的全部引用；
5. 增加自动检查，禁止旧路径、旧 class/interface 名和 watcher singleton 回来；
6. 相关测试、lint、typecheck 和 i18n 通过后提交，不保留转发文件或双轨实现。

迁移只改变负责模块和依赖连接，不改变 route 名称、event 名称、文件转换结果、Workspace 展示、
Git 命令、watcher fallback 含义或 renderer 行为。

## 检查条件

- 搜索不到 `presenter/filePresenter`、`presenter/workspacePresenter`、`FilePresenter`、
  `IFilePresenter`、`WorkspacePresenter`、`IWorkspacePresenter` 和 `getFileWatcherService`；
- App 只创建一个 `FileWatcherService`，Workspace 与 Skill 明确接收它；
- App stop 明确等待 Workspace、Skill 和 watcher 按顺序停止；
- Workspace 不导入 Routes、Session、Agent、Desktop、Remote 或 Scheduler；
- `platform/fileWatcher` 不导入任何业务模块；
- route 和 typed event 名称、输入输出保持不变；
- Workspace、File、watcher、Skill watcher、Routes、Tool、Knowledge、Remote 和架构检查通过；
- 没有新增汇总所有能力的总管理器。
