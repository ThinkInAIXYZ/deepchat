# DeepChat 品牌定制指南

这是一个简单的品牌定制解决方案，用于将 DeepChat 应用定制为您自己的品牌。

## 使用场景

1. **Fork 这个代码仓库**到您的 GitHub 账号
2. **准备品牌资源**（图标、Logo 等）
3. **配置品牌信息**
4. **执行一次性替换**
5. **构建您的定制版本**

## 操作步骤

### 1. 准备品牌资源

将以下文件放入 `scripts/brand-assets/` 目录：

- `icon.png` - 应用图标 (512x512 PNG)
- `icon.ico` - Windows 图标文件
- `logo.png` - 亮色主题 Logo (建议 256x256)
- `logo-dark.png` - 暗色主题 Logo (建议 256x256)

### 2. 配置品牌信息

编辑根目录下的 `brand-config.template.json` 文件：

```json
{
  "app": {
    "name": "MyAI",                           // 应用包名
    "productName": "我的AI助手",                // 产品显示名称
    "appId": "com.mycompany.ai-assistant",    // 应用ID (reverse domain 格式)
    "description": "我的AI助手，智能工作伙伴",   // 应用描述
    "author": "我的公司",                      // 作者/公司名称
    "website": "https://mycompany.com",       // 官方网站
    "copyright": "© 2025 我的公司",            // 版权信息
    "executableName": "MyAI"                  // 可执行文件名
  },
  "update": {
    "baseUrl": "https://updates.mycompany.com/"  // 更新服务器URL
  },
  "i18n": {
    "appTitle": {
      "en-US": "My AI Assistant",
      "zh-CN": "我的AI助手"
      // ... 其他语言
    },
    "appDescription": {
      "en-US": "My AI Assistant is your intelligent work partner",
      "zh-CN": "我的AI助手是您的智能工作伙伴"
      // ... 其他语言
    }
  }
}
```

### 3. 执行品牌替换

运行替换脚本：

```bash
node scripts/rebrand.js
```

这个脚本会自动替换以下文件中的品牌信息：

- `package.json` - 包配置
- `electron-builder.yml` - 构建配置
- `electron-builder-macx64.yml` - macOS x64 构建配置
- `src/main/index.ts` - 主进程配置
- `src/main/presenter/upgradePresenter/index.ts` - 更新服务配置
- `src/renderer/src/i18n/*/about.json` - 国际化文件
- `src/main/presenter/configPresenter/mcpConfHelper.ts` - MCP 服务描述

以及复制品牌资源文件到相应位置。

### 4. 验证结果

检查修改是否正确：

```bash
# 查看修改的文件
git status

# 查看具体修改内容
git diff

# 测试运行
pnpm run dev
```

### 5. 构建应用

```bash
# 构建所需平台
pnpm run build:mac:arm64    # macOS ARM64
pnpm run build:win:x64      # Windows x64
pnpm run build:linux:x64    # Linux x64
```

## 配置说明

### 必需配置

- `app.name` - 应用包名，用于 package.json
- `app.productName` - 产品显示名称
- `app.appId` - 应用ID，必须是 reverse domain 格式（如 com.company.app）
- `app.description` - 应用描述
- `app.author` - 作者或公司名称

### 可选配置

- `app.website` - 官方网站URL
- `app.copyright` - 版权信息
- `app.executableName` - 可执行文件名（Windows）
- `update.baseUrl` - 自定义更新服务器
- `i18n.*` - 多语言文本
- `github.repository` - GitHub 仓库地址
- `mcp.serverDescriptionSuffix` - MCP 服务描述后缀

## 示例：Demo公司

以下是为"Demo公司"配置的示例：

```json
{
  "app": {
    "name": "BananaAI",
    "productName": "DemoAI助手",
    "appId": "com.banana.ai-assistant",
    "description": "DemoAI助手，您的智能工作伙伴",
    "author": "Demo科技有限公司",
    "website": "https://banana.com",
    "copyright": "© 2025 Demo科技有限公司",
    "executableName": "BananaAI"
  },
  "update": {
    "baseUrl": "https://updates.banana.com/"
  },
  "i18n": {
    "appTitle": {
      "en-US": "Banana AI Assistant",
      "zh-CN": "DemoAI助手"
    },
    "appDescription": {
      "en-US": "Banana AI Assistant is your intelligent work partner",
      "zh-CN": "DemoAI助手是您的智能工作伙伴"
    }
  },
  "mcp": {
    "serverDescriptionSuffix": "Demo内置",
    "serverDescriptionSuffixEn": "Banana built-in"
  }
}
```

## 注意事项

1. **备份重要配置**：执行替换前建议提交当前代码或创建备份
2. **检查 App ID 格式**：必须使用 reverse domain 格式，如 `com.company.app`
3. **准备高质量资源**：图标和 Logo 应该符合各平台设计规范
4. **测试完整性**：替换后进行完整的功能测试
5. **更新服务器**：如果使用自定义更新服务器，需要确保服务器正常运行

## 恢复原始配置

如果需要恢复到原始的 DeepChat 配置：

```bash
# 恢复所有修改的文件
git checkout .

# 或恢复特定文件
git checkout package.json electron-builder.yml
```

## 故障排除

### 常见问题

1. **配置文件格式错误**
   - 检查 JSON 语法是否正确
   - 确保所有字符串都用双引号包围

2. **资源文件未找到**
   - 检查文件是否放在正确的位置
   - 确认文件名和扩展名正确

3. **构建失败**
   - 检查 App ID 格式是否正确
   - 验证所有必需字段都已填写

### 获取帮助

如果遇到问题，可以：

1. 检查控制台输出的错误信息
2. 确认配置文件格式正确
3. 验证资源文件是否存在

## 总结

这个简化的品牌定制方案可以让您：

- ✅ **快速定制**：几分钟内完成品牌替换
- ✅ **一次性操作**：执行一次就完成所有替换
- ✅ **完全定制**：应用名称、图标、描述等全面定制
- ✅ **易于使用**：无需复杂的品牌管理，直接修改代码

非常适合 fork 代码库后的一次性品牌定制需求。
