# Spec: 云同步（S3 兼容对象存储）

## 背景与问题
DeepChat 现有的「同步」仅把数据库 + 配置打包为 `backup-<时间戳>.zip` 写入**本地**同步文件夹
（默认 `~/DeepchatSync`），导入也只从该本地文件夹读取。多设备（家 / 公司）之间数据不会自动流转，
必须手动搬运 zip。

## 目标
在**不改动**现有本地备份/导入逻辑的前提下，叠加一个最小的云能力：
1. **上传到云**：把本地最新备份 zip 推送到 S3 兼容对象存储。
2. **从云拉取最新**：下载云端最新备份 zip 到本地同步文件夹，复用现有导入流程还原。

主用例为 Cloudflare R2，通过 **S3 兼容协议** 实现，使同一套配置也能连 MinIO / AWS S3 / B2。

## 非目标（明确不做，避免过度设计）
- 不做定时/自动上传，纯手动按钮触发。
- 不做云端多版本管理、保留策略、冲突合并。
- 不做 WebDAV / R2 专有 Token API。
- 不引入新的导入合并语义，沿用现有 increment / overwrite。

## 用户故事
- 作为多设备用户，我在 A 机点「上传到云」，在 B 机点「从云拉取最新」，即可把聊天记录与配置带过去。

## 验收标准
- 设置 → 数据出现「云同步 (S3 兼容)」区块：endpoint / bucket / region / prefix / AK / SK + 保存 / 测试连接 / 上传 / 拉取。
- 填入有效 R2 凭证后「测试连接」成功；「上传到云」后桶内出现 `deepchat-backups/backup-*.zip`。
- 另一设备「从云拉取最新」后数据恢复。
- `secretAccessKey` 在 `app-settings` 中以 safeStorage 密文存储，渲染层永不收到明文。
- 同一套 UI 切换 endpoint/bucket 即可对接 MinIO（验证 S3 兼容）。

## 安全
- 凭证 secret 用 Electron `safeStorage` 加密后落盘（与 `databaseSecurityPresenter` 一致）。
- safeStorage 不可用时拒绝保存 secret 并提示（`sync.error.safeStorageUnavailable`）。

## 待澄清
- 无（方案、凭证存储、触发方式均已与用户确认）。
