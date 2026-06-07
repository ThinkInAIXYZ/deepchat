# Plan: 云同步（S3 兼容对象存储）

## 架构总览
云能力作为现有备份链路的**叠加层**，不重写本地备份/导入：

```text
DataSettings.vue ─► sync store ─► SyncClient ─► [route] ─► SyncPresenter ─► CloudStorageService
  保存/测试/上传/拉取                                          │                      │
                                                       ConfigPresenter          R2 / S3 桶
                                                    (safeStorage 加密凭证)
```

- 上传 = 取本地最新 zip（`SyncPresenter.listBackups()`）→ `CloudStorageService.uploadBackup()`。
- 拉取 = `CloudStorageService.downloadLatest()` 落地同步文件夹 → 复用 `SyncPresenter.importFromSync()`。

## 关键文件
- `src/main/presenter/syncPresenter/cloudStorageService.ts`（新增）：S3 客户端封装
  （`forcePathStyle: true`、`region` 默认 `auto`），方法 `testConnection / uploadBackup /
  listRemoteBackups / downloadLatest`，沿用 `backup-\d+\.zip` 文件名约定。
- `src/main/presenter/syncPresenter/index.ts`：新增 `testCloudConnection / uploadLatestBackupToCloud /
  pullLatestBackupFromCloud`，从 ConfigPresenter 取解密后的 `ResolvedCloudSyncConfig` 构造服务。
- `src/main/presenter/configPresenter/index.ts`：`getCloudSyncConfig / setCloudSyncConfig /
  getResolvedCloudSyncConfig / isCloudSafeStorageAvailable`；secret 经 `safeStorage` 加密，
  视图脱敏（仅 `hasSecret`）。
- `src/shared/contracts/routes/sync.routes.ts` + `routes.ts`：新增 5 路由并登记。
- `src/main/routes/index.ts`：sync 段加 5 个 case 分发（上传/拉取复用 `recordSettingsActivity`）。
- `src/shared/types/presenters/legacy.presenters.d.ts`：`ISyncPresenter` / `IConfigPresenter` 新方法 +
  `CloudSyncConfigView / CloudSyncConfigInput / ResolvedCloudSyncConfig / CloudSyncResult` 类型。
- `src/renderer/api/SyncClient.ts` + `src/renderer/src/stores/sync.ts`：5 个客户端方法 + store action。
- `src/renderer/settings/components/DataSettings.vue`：同步卡片内新增云同步区块。
- i18n：`sync.json`（success/error 云键）、`settings.json`（`data.cloudSync.*`），全语言补齐。

## 复用
- 备份/导入：`performBackup / importFromSync / listBackups / getBackupsDirectory`。
- 加密：`safeStorage`（参照 `databaseSecurityPresenter`）。
- IPC / 渲染数据流：`defineRouteContract`、`useIpcQuery/useIpcMutation`、pinia store。

## 依赖
- 新增 `@aws-sdk/client-s3`（与现有 `@aws-sdk/client-bedrock` 同源）。

## 边界与决策
- R2 必须 path-style + `region: 'auto'`。
- secret 留空 = 不修改既有值；非空才重新加密写入。
- 配置保存先完成 secret 加密，再写入本地设置；如果第二步失败，回滚已写入的 secret，避免
  access key 与旧 secret 错配。
- 云上传只接受结构可导入的 `backup-\d+\.zip`，避免用户放入任意 zip 后被同步到云端。
- 活动记录复用既有 `backup_created` / `imported` action，不扩 schema（最小改动）。
