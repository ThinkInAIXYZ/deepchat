# OpenCode 集成实施计划

> 快速实施指南
>
> 版本: 1.0
> 最后更新: 2026-01-15

## 概述

将 OpenCode 作为内置 ACP Agent 集成到 DeepChat，预计总耗时 **3-4 小时**。

## 实施步骤

### 步骤 1: 代码修改（30 分钟）

#### 1.1 修改类型定义

**文件**: `src/shared/presenter/config.ts`

找到 `AcpBuiltinAgentId` 类型定义，添加 `'opencode'`：

```typescript
export type AcpBuiltinAgentId =
  | 'kimi-cli'
  | 'claude-code-acp'
  | 'codex-acp'
  | 'opencode'  // 新增这一行
```

#### 1.2 修改配置助手

**文件**: `src/main/presenter/configPresenter/acpConfHelper.ts`

**修改 1**: 在第 16 行左右，更新 `BUILTIN_ORDER`：

```typescript
const BUILTIN_ORDER: AcpBuiltinAgentId[] = [
  'kimi-cli',
  'claude-code-acp',
  'codex-acp',
  'opencode'  // 新增这一行
]
```

**修改 2**: 在第 23 行左右，添加到 `BUILTIN_TEMPLATES`：

```typescript
const BUILTIN_TEMPLATES: Record<AcpBuiltinAgentId, BuiltinTemplate> = {
  'kimi-cli': {
    // ... 现有代码
  },
  'claude-code-acp': {
    // ... 现有代码
  },
  'codex-acp': {
    // ... 现有代码
  },
  'opencode': {  // 新增这个对象
    name: 'OpenCode',
    defaultProfile: () => ({
      name: DEFAULT_PROFILE_NAME,
      command: 'opencode',
      args: ['acp'],
      env: {}
    })
  }
}
```

#### 1.3 修改初始化助手

**文件**: `src/main/presenter/configPresenter/acpInitHelper.ts`

在第 54 行左右，添加到 `BUILTIN_INIT_COMMANDS`：

```typescript
const BUILTIN_INIT_COMMANDS: Record<AcpBuiltinAgentId, InitCommandConfig> = {
  'kimi-cli': {
    // ... 现有代码
  },
  'claude-code-acp': {
    // ... 现有代码
  },
  'codex-acp': {
    // ... 现有代码
  },
  'opencode': {  // 新增这个对象
    commands: ['npm i -g opencode-ai', 'opencode --version'],
    description: 'Initialize OpenCode'
  }
}
```

**说明**：
- 第一个命令 `npm i -g opencode-ai` 用于安装 OpenCode
- 第二个命令 `opencode --version` 用于验证安装成功

#### 1.4 运行代码质量检查

```bash
# 类型检查
pnpm run typecheck

# 代码格式化
pnpm run format

# Lint 检查
pnpm run lint
```

### 步骤 2: 测试验证（1-2 小时）

#### 2.1 准备测试环境

```bash
# 安装 OpenCode
npm install -g opencode

# 验证安装
opencode --version

# 启动 DeepChat 开发环境
pnpm run dev
```

#### 2.2 手动测试清单

- [ ] 在 DeepChat 设置中找到并启用 OpenCode
- [ ] 创建新对话，选择 OpenCode 作为模型
- [ ] 设置有效的工作目录（例如一个测试项目）
- [ ] 发送简单提示："Hello, can you help me?"
- [ ] 验证 OpenCode 响应正常
- [ ] 测试文件读取权限请求
- [ ] 测试文件写入权限请求
- [ ] 测试终端命令执行
- [ ] 测试工作目录切换
- [ ] 测试会话恢复（关闭并重新打开对话）
- [ ] 测试错误场景（无效目录、权限拒绝等）

#### 2.3 记录测试结果

在测试过程中记录：
- 发现的问题
- 性能表现
- 用户体验问题
- 需要改进的地方

### 步骤 3: 文档更新（30 分钟）

#### 3.1 更新 CHANGELOG

**文件**: `CHANGELOG.md`

在最新版本下添加：

```markdown
### Added
- 新增 OpenCode 作为内置 ACP Agent，支持开源 AI 编码代理
```

#### 3.2 更新用户文档（可选）

如果有用户文档，添加 OpenCode 的使用说明。

### 步骤 4: 代码审查和合并（30 分钟）

```bash
# 提交更改
git add .
git commit -m "feat(acp): add OpenCode as builtin ACP agent"

# 推送到远程
git push origin feat/acp_model_enhance

# 创建 Pull Request（如果需要）
```

## 验收标准

- [ ] 代码通过所有类型检查和 lint
- [ ] OpenCode 出现在 ACP Agent 列表中
- [ ] 可以成功启用 OpenCode
- [ ] 可以创建 OpenCode 对话并正常交互
- [ ] 文件读写权限请求正常工作
- [ ] 终端命令执行正常工作
- [ ] 工作目录切换正常工作
- [ ] 会话恢复正常工作
- [ ] 错误处理友好且清晰

## 回滚计划

如果集成出现问题，可以快速回滚：

1. 撤销 `config.ts` 的修改
2. 撤销 `acpConfHelper.ts` 的修改
3. 重新运行 `pnpm run typecheck`
4. 重启 DeepChat

## 注意事项

1. **OpenCode 版本**: 确保用户安装的 OpenCode 版本 >= 1.1.0
2. **工作目录**: OpenCode 需要有效的项目目录才能正常工作
3. **配置独立**: OpenCode 使用自己的配置文件（`~/.opencode/config.json`），与 DeepChat 配置独立
4. **性能**: 首次启动 OpenCode 可能较慢，这是正常现象

## 后续优化（可选）

- [ ] 添加 OpenCode 版本检查
- [ ] 添加 OpenCode 安装指南链接
- [ ] 优化首次启动性能
- [ ] 添加 OpenCode 特定的配置选项
- [ ] 支持 OpenCode 的自定义工具配置

## 参考资料

- 详细规格文档: `docs/specs/opencode-integration/spec.md`
- OpenCode 官方文档: https://opencode.ai/docs/acp
- ACP 协议文档: https://agentclientprotocol.com
