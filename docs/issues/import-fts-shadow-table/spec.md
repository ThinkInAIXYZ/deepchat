# Issue: 增量导入时 FTS5 影子表报错

## 现象
增量(increment)导入备份时抛错并回滚：

```text
Failed to import database: Failed to import table deepchat_search_documents_fts_config:
table deepchat_search_documents_fts_config may not be modified
```

经云同步「从云拉取最新」复用 `importFromSync` 时触发，本地「导入数据」走相同路径也会复现。

## 根因
`DataImporter.getTablesInOrder()`（`src/main/presenter/sqlitePresenter/importData.ts`）用
`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'` 取表，
未排除 FTS5 的虚拟表 `deepchat_search_documents_fts` 及其影子表
`_data/_idx/_docsize/_config`。对影子表执行普通 `INSERT` 会被 SQLite 拒绝（"may not be modified"）。

关键坑：FTS5 影子表在 `sqlite_master` 中**带有真实的 `CREATE TABLE` sql（非 NULL）**，因此
不能靠 `sql IS NULL` 识别，必须按「虚拟表名前缀」排除。

## 修复
先取出所有虚拟表（`sql LIKE 'CREATE VIRTUAL TABLE%'`），再排除名字等于虚拟表名、或以
`<虚拟表名>_` 开头的影子表。FTS5 采用外部内容表模式（`content='deepchat_search_documents'`）
+ 触发器，导入内容表 `deepchat_search_documents` 行时触发器会自动维护 FTS 索引，无需直接写 FTS 表。

## 影响范围
- 仅增量导入路径（`DataImporter`）；覆盖导入走整库文件拷贝，不受影响。
- 修复后导入不再触碰 FTS 影子表，搜索索引由触发器重建。

## 验证
- 含 `deepchat_search_documents_fts*` 表的备份增量导入成功，无报错。
- 导入后对已导入文档执行搜索可命中（FTS 索引已由触发器填充）。
