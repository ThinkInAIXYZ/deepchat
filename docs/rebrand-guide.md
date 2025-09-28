# DeepChat Rebranding Guide

**Language:** [English](#english) | [中文](#chinese)

## English

# DeepChat Rebranding Guide

This is a simple rebranding solution for customizing the DeepChat application with your own brand.

## Use Cases

1. **Fork this repository** to your GitHub account
2. **Prepare brand assets** (icons, logos, etc.)
3. **Configure brand information**
4. **Execute one-time replacement**
5. **Build your customized version**

## Step-by-Step Instructions

### 1. Prepare Brand Assets

Place the following files in the `scripts/brand-assets/` directory:

- `icon.png` - Application icon (512x512 PNG)
- `icon.ico` - Windows icon file
- `icon.icns` - macOS icon file
- `logo.png` - Light theme logo (recommended 256x256)
- `logo-dark.png` - Dark theme logo (recommended 256x256)

**Note:** Brand assets are optional. If you don't provide these files, only text content will be replaced.

### 2. Configure Brand Information

Edit the `brand-config.template.json` file in the root directory:

```json
{
  "app": {
    "name": "MyAI",                           // Package name
    "productName": "My AI Assistant",         // Product display name
    "appId": "com.mycompany.ai-assistant",    // App ID (reverse domain format)
    "description": "My AI Assistant, your intelligent work partner", // App description
    "author": "My Company",                   // Author/Company name
    "website": "https://mycompany.com",       // Official website
    "copyright": "© 2025 My Company",         // Copyright info
    "executableName": "MyAI"                  // Executable name
  },
  "update": {
    "baseUrl": "https://updates.mycompany.com/" // Update server URL
  },
  "i18n": {
    "appTitle": {
      "en-US": "My AI Assistant",
      "zh-CN": "我的AI助手"
      // ... other languages
    },
    "appDescription": {
      "en-US": "My AI Assistant is your intelligent work partner",
      "zh-CN": "我的AI助手是您的智能工作伙伴"
      // ... other languages
    },
    "welcomeTitle": {
      "en-US": "Welcome to My AI Assistant",
      "zh-CN": "欢迎使用我的AI助手"
      // ... other languages
    },
    "welcomeSetupDescription": {
      "en-US": "Let's start setting up My AI Assistant",
      "zh-CN": "让我们开始设置我的AI助手"
      // ... other languages
    }
  }
}
```

### 3. Execute Brand Replacement

Run the replacement script:

```bash
node scripts/rebrand.js
```

This script will automatically replace brand information in the following files:

- `package.json` - Package configuration
- `electron-builder.yml` - Build configuration
- `electron-builder-macx64.yml` - macOS x64 build configuration
- `src/main/index.ts` - Main process configuration
- `src/main/presenter/upgradePresenter/index.ts` - Update service configuration
- `src/renderer/src/i18n/*/about.json` - Internationalization files
- `src/renderer/src/i18n/*/welcome.json` - Welcome page i18n files
- `src/renderer/src/i18n/*/mcp.json` - MCP service i18n files
- `src/renderer/src/i18n/*/settings.json` - Settings i18n files
- `src/renderer/src/i18n/*/update.json` - Update i18n files
- `src/renderer/src/i18n/*/index.ts` - i18n index files
- `src/renderer/index.html` - Main renderer HTML title
- `src/renderer/shell/index.html` - Shell window HTML title
- `src/renderer/floating/index.html` - Floating button HTML title
- `src/main/presenter/configPresenter/mcpConfHelper.ts` - MCP service descriptions

And copy brand asset files to their respective locations.

### 4. Manual Configuration Updates

**Important**: The script cannot automatically update all configuration files. You need to manually review and update:

- **Update Server Configuration**: Edit `src/renderer/src/stores/upgrade.ts` if you're using a custom update server. The script updates the main configuration files, but the frontend update store may contain hardcoded URLs or logic that needs manual adjustment.

### 5. Verify Results

Check if modifications are correct:

```bash
# View modified files
git status

# View specific changes
git diff

# Test run
pnpm run dev
```

### 6. Build Application

```bash
# Build for required platforms
pnpm run build:mac:arm64    # macOS ARM64
pnpm run build:win:x64      # Windows x64
pnpm run build:linux:x64    # Linux x64
```

## Configuration Details

### Required Configuration

- `app.name` - Package name for package.json
- `app.productName` - Product display name
- `app.appId` - Application ID in reverse domain format (e.g., com.company.app)
- `app.description` - Application description
- `app.author` - Author or company name

### Optional Configuration

- `app.website` - Official website URL
- `app.copyright` - Copyright information
- `app.executableName` - Executable file name (Windows)
- `update.baseUrl` - Custom update server
- `i18n.*` - Multilingual text content
- `github.repository` - GitHub repository address
- `mcp.serverDescriptionSuffix` - MCP service description suffix

### Enhanced I18n Support

The rebranding system now supports comprehensive internationalization customization:

- **Welcome Page**: Customize welcome titles and setup descriptions
- **All I18n Files**: Automatic replacement of "DeepChat" references in all i18n JSON files
- **HTML Titles**: Updates window titles across all renderer process HTML files
- **Multi-language Support**: Supports all 9 languages: en-US, zh-CN, zh-TW, zh-HK, ja-JP, ko-KR, ru-RU, fr-FR, fa-IR

## Example: Demo Company

Here's an example configuration for "Demo Company":

```json
{
  "app": {
    "name": "BananaAI",
    "productName": "Demo AI Assistant",
    "appId": "com.banana.ai-assistant",
    "description": "Demo AI Assistant, your intelligent work partner",
    "author": "Demo Technology Ltd.",
    "website": "https://banana.com",
    "copyright": "© 2025 Demo Technology Ltd.",
    "executableName": "BananaAI"
  },
  "update": {
    "baseUrl": "https://updates.banana.com/"
  },
  "i18n": {
    "appTitle": {
      "en-US": "Banana AI Assistant",
      "zh-CN": "Demo AI助手"
    },
    "appDescription": {
      "en-US": "Banana AI Assistant is your intelligent work partner",
      "zh-CN": "Demo AI助手是您的智能工作伙伴"
    }
  },
  "mcp": {
    "serverDescriptionSuffix": "Banana built-in",
    "serverDescriptionSuffixEn": "Banana built-in"
  }
}
```

## Important Notes

1. **Backup Important Configurations**: Recommend committing current code or creating backups before replacement
2. **Check App ID Format**: Must use reverse domain format, e.g., `com.company.app`
3. **Prepare High-Quality Assets**: Icons and logos should comply with platform design guidelines
   - For macOS: Provide `icon.icns` file in addition to `icon.png`
4. **Test Thoroughly**: Perform complete functional testing after replacement
5. **Update Server**: If using custom update server, ensure server is operational
6. **Optional Assets**: Brand assets (icons, logos) are completely optional - script works with text-only customization

## Restore Original Configuration

To restore original DeepChat configuration:

```bash
# Restore all modified files
git checkout .

# Or restore specific files
git checkout package.json electron-builder.yml
```

## Troubleshooting

### Common Issues

1. **Configuration File Format Error**
   - Check if JSON syntax is correct
   - Ensure all strings are wrapped in double quotes

2. **Asset Files Not Found**
   - Check if files are in correct location
   - Confirm filenames and extensions are correct
   - Remember: assets are optional, script will continue without them

3. **Build Failure**
   - Check if App ID format is correct
   - Verify all required fields are filled

### Getting Help

If you encounter issues:

1. Check console output for error messages
2. Confirm configuration file format is correct
3. Verify asset files exist (if provided)

## Summary

This simplified rebranding solution allows you to:

- ✅ **Quick Customization**: Complete brand replacement in minutes
- ✅ **One-time Operation**: Execute once to complete all replacements
- ✅ **Complete Customization**: Full customization of app name, icons, descriptions, etc.
- ✅ **Easy to Use**: No complex brand management, direct code modification
- ✅ **Comprehensive I18n**: Supports all languages and file types
- ✅ **Optional Assets**: Works with or without brand assets

Perfect for one-time brand customization needs after forking the codebase.

---

## Chinese

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
- `icon.icns` - macOS 图标文件
- `logo.png` - 亮色主题 Logo (建议 256x256)
- `logo-dark.png` - 暗色主题 Logo (建议 256x256)

**注意：** 品牌资源是可选的。如果您不提供这些文件，脚本将只替换文本内容。

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
    },
    "welcomeTitle": {
      "en-US": "Welcome to My AI Assistant",
      "zh-CN": "欢迎使用我的AI助手"
      // ... 其他语言
    },
    "welcomeSetupDescription": {
      "en-US": "Let's start setting up My AI Assistant",
      "zh-CN": "让我们开始设置我的AI助手"
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
- `src/renderer/src/i18n/*/welcome.json` - 欢迎页面国际化文件
- `src/renderer/src/i18n/*/mcp.json` - MCP 服务国际化文件
- `src/renderer/src/i18n/*/settings.json` - 设置国际化文件
- `src/renderer/src/i18n/*/update.json` - 更新国际化文件
- `src/renderer/src/i18n/*/index.ts` - 国际化索引文件
- `src/renderer/index.html` - 主渲染器 HTML 标题
- `src/renderer/shell/index.html` - Shell 窗口 HTML 标题
- `src/renderer/floating/index.html` - 悬浮按钮 HTML 标题
- `src/main/presenter/configPresenter/mcpConfHelper.ts` - MCP 服务描述

以及复制品牌资源文件到相应位置。

### 4. 手动配置更新

**重要提醒**：脚本无法自动更新所有配置文件，您需要手动检查和更新：

- **更新服务器配置**：如果您使用自定义更新服务器，请编辑 `src/renderer/src/stores/upgrade.ts`。脚本会更新主要配置文件，但前端更新存储可能包含硬编码的 URL 或逻辑，需要手动调整。

### 5. 验证结果

检查修改是否正确：

```bash
# 查看修改的文件
git status

# 查看具体修改内容
git diff

# 测试运行
pnpm run dev
```

### 6. 构建应用

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
- `i18n.*` - 多语言文本内容
- `github.repository` - GitHub 仓库地址
- `mcp.serverDescriptionSuffix` - MCP 服务描述后缀

### 增强的国际化支持

品牌化系统现在支持全面的国际化定制：

- **欢迎页面**：自定义欢迎标题和设置描述
- **所有国际化文件**：自动替换所有国际化 JSON 文件中的 "DeepChat" 引用
- **HTML 标题**：更新所有渲染进程 HTML 文件的窗口标题
- **多语言支持**：支持全部 9 种语言：en-US, zh-CN, zh-TW, zh-HK, ja-JP, ko-KR, ru-RU, fr-FR, fa-IR

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
   - 对于 macOS：除了 `icon.png` 还需提供 `icon.icns` 文件
4. **测试完整性**：替换后进行完整的功能测试
5. **更新服务器**：如果使用自定义更新服务器，需要确保服务器正常运行
6. **可选资源**：品牌资源（图标、Logo）完全可选 - 脚本支持仅文本定制

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
   - 记住：资源是可选的，脚本会在没有资源的情况下继续运行

3. **构建失败**
   - 检查 App ID 格式是否正确
   - 验证所有必需字段都已填写

### 获取帮助

如果遇到问题，可以：

1. 检查控制台输出的错误信息
2. 确认配置文件格式正确
3. 验证资源文件是否存在（如果提供了）

## 总结

这个简化的品牌定制方案可以让您：

- ✅ **快速定制**：几分钟内完成品牌替换
- ✅ **一次性操作**：执行一次就完成所有替换
- ✅ **完全定制**：应用名称、图标、描述等全面定制
- ✅ **易于使用**：无需复杂的品牌管理，直接修改代码
- ✅ **全面国际化**：支持所有语言和文件类型
- ✅ **可选资源**：支持有无品牌资源的情况

非常适合 fork 代码库后的一次性品牌定制需求。
