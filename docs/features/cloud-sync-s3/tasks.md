# Tasks: 云同步（S3 兼容对象存储）

- [x] 安装 `@aws-sdk/client-s3` 依赖
- [x] 新增 `CloudStorageService`（testConnection / uploadBackup / listRemoteBackups / downloadLatest）
- [x] `ConfigPresenter` 加云凭证读写，secret 用 safeStorage 加密、视图脱敏
- [x] `SyncPresenter` 加 testCloudConnection / uploadLatestBackupToCloud / pullLatestBackupFromCloud
- [x] 新增 5 个 IPC 路由契约并在 `routes.ts` 登记
- [x] `legacy.presenters.d.ts` 加接口方法与 CloudSync* 类型
- [x] `main/routes/index.ts` 注册 5 个 case
- [x] `SyncClient.ts` + `stores/sync.ts` 加云方法/状态
- [x] `DataSettings.vue` 云同步 UI（表单 + 保存/测试/上传/拉取）
- [x] i18n：zh-CN / en-US 增云键，其余语言英文兜底，`pnpm run i18n` 校验通过
- [x] 收尾：`pnpm run typecheck` / `format` / `lint` 全绿

## 待人工验证（需真实 R2 凭证）
- [ ] 填 R2 凭证 → 测试连接成功
- [ ] 上传到云 → 桶内出现 `deepchat-backups/backup-*.zip`
- [ ] 另一设备拉取最新 → 数据恢复
- [ ] 切换 MinIO endpoint 验证 S3 兼容
- [ ] 确认 `app-settings` 中 secret 为密文
