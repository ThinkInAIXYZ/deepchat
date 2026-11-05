# 数据库方案决策

日期：2026-11-05
状态：建议方案 1，已实测验证；最终由产品/技术负责人确认

## 问题

sidecar 要服务 `mcp.*`、`sessions.*`、`providers.*` 等 13 条启动路由，全部需要数据库。DeepChat 用的是 SQLCipher 加密的 SQLite（`better-sqlite3-multiple-ciphers`）加 DuckDB（向量检索）。

## 实测结论（本轮新增）

在纯 Node（非 Electron）进程里逐个加载原生模块：

| 模块 | 结果 |
| --- | --- |
| `better-sqlite3-multiple-ciphers` | 通过 |
| `node-pty` | 通过 |
| `sharp` | 通过 |
| `@parcel/watcher` | 通过 |
| `@duckdb/node-api` | 通过 |
| `@zerob13/nativekit` | 通过 |
| `opendal` | 通过 |

原因：本机 Node 24.21 与 Electron 43 内置的 Node 同为 **ABI 137**，`electron-rebuild` 产出的 `.node` 文件在纯 Node 下同样能加载。

SQLCipher 功能验证：

```
写入并关闭 → 用正确密钥重开 → 读回数据
用错误密钥打开 → 报 "file is not a database"
```

即加解密、口令校验都在 sidecar 里直接可用。

## 在 sidecar 里打开真实数据库（已实测）

`src/main/sidecar/entry.ts` 在设置 `DEEPCHAT_DB_PATH` / `DEEPCHAT_DB_KEY` 时用 `MainDatabase` 打开加密库。用代码库自身的 `configureSQLiteConnection`（`cipher='sqlcipher'` + `legacy=4` + `db.key`）生成的测试库：

```
{"event":"sidecar.db.ready","payload":{"path":".../agent.db","tables":74,"hasSessions":true}}
```

即：**真实 schema catalog 与真实迁移在 sidecar 里跑完了**，74 张表全部建立，`hasSessions` 为真。

错误密钥的表现也符合预期：

```
Database initialization failed: SqliteError: file is not a database
{"event":"sidecar.db.error", ...}
```

踩到的一个坑：手工建表时必须用与代码库相同的 `legacy=4` 模式，否则 sidecar 打不开——文件看起来是 SQLCipher，但 KDF/兼容模式不同。这反过来说明现有 `applySQLitePassword` 的兼容参数是数据能否打开的关键，迁移时不能改。

## 三个方案

### 方案 1：sidecar 直接用现有原生模块（推荐）

| 维度 | 评估 |
| --- | --- |
| 改动量 | 几乎为零：现有 `better-sqlite3-multiple-ciphers` 调用不动 |
| 正确性 | 与 Electron 版共用同一套 schema、迁移、加密格式，用户数据无需转换 |
| 打包影响 | mygo 版需要随包分发 Node 运行时与这批原生模块。这本来就是方案 B 的前提（sidecar 需要 Node） |
| 风险 | ABI 不匹配会在升级 Node/Electron 大版本时出现，需要在 CI 里固定两边的 Node 版本 |

**这条路的代价被本轮的 ABI 实测大幅降低**：不需要为 Node 单独编译一份原生模块。

### 方案 2：数据库迁到 Go

| 维度 | 评估 |
| --- | --- |
| 优点 | 单一进程、单一二进制，最贴近 mygo 的形态 |
| 阻塞 | Go 的 SQLCipher 绑定需要 cgo，与 mygo「无 cgo、任意平台交叉编译」的核心卖点冲突 |
| 迁移风险 | 要保证 SQLCipher 密文格式、页大小、KDF 参数完全一致，否则用户数据打不开 |
| 结论 | 不建议作为第一阶段；可作为长期目标，用一次性导出/导入迁移 |

### 方案 3：Go 持有数据库，sidecar 通过 RPC 读写

| 维度 | 评估 |
| --- | --- |
| 优点 | 数据归属清晰，sidecar 可无状态化 |
| 代价 | 要改所有数据访问层（`src/main/*/data/`），每个查询都要跨进程；事务、迁移、性能都要重新设计 |
| 风险 | 跨进程事务是硬问题，SQLite 的锁语义会变得难以推理 |
| 结论 | 工作量远大于 1，收益在现阶段不明显 |

## 建议

先走方案 1，理由：

1. 不改用户数据格式，迁移风险最低——这是重写里最不能出错的部分
2. ABI 实测通过，几乎没有额外工程成本
3. 方案 2/3 都可以在方案 1 落地后按收益再评估，且不会因为先行实施而锁死

## 需要确认的边界

- 打包时 Node 运行时与原生模块的体积会体现在安装包里（Electron 版已经包含，实际增量主要是 Go 二进制与壳本身）
- 数据库口令在 sidecar 里必须来自 `mygo.Secrets`，不能用当前 `SecretHost` 的临时主密钥方案（见 `platform-abstraction.md` 的 Node 实现说明）
- Linux 无 Secret Service 时需要有明确的降级提示，而不是静默把口令落到文件里

## 下一步

1. 让 `DatabaseSecurityService`、`mainDatabase` 在 sidecar 里跑起来，先接 `sessions.listLightweight` 这一条只读路由
2. 用真实用户数据的副本做一次打开验证（不接触生产数据）
3. 之后再接 `mcp.*` 与 `providers.*`
