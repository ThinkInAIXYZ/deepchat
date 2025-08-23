#!/usr/bin/env node

/**
 * DeepChat 品牌替换脚本
 *
 * 使用方法：
 * 1. 修改 brand-config.template.json 中的配置
 * 2. 将品牌资源文件放在 scripts/brand-assets/ 目录下
 * 3. 运行 node scripts/rebrand.js
 *
 * 这将一次性替换整个项目的品牌信息
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
}

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`)
}

function success(message) {
  log(`✅ ${message}`, colors.green)
}

function error(message) {
  log(`❌ ${message}`, colors.red)
}

function warning(message) {
  log(`⚠️  ${message}`, colors.yellow)
}

function info(message) {
  log(`ℹ️  ${message}`, colors.blue)
}

// 读取品牌配置
function loadBrandConfig() {
  const configPath = path.join(PROJECT_ROOT, 'brand-config.template.json')

  if (!fs.existsSync(configPath)) {
    error('品牌配置文件不存在: brand-config.template.json')
    error('请先创建并配置 brand-config.template.json 文件')
    process.exit(1)
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8')
    return JSON.parse(content)
  } catch (err) {
    error(`读取品牌配置失败: ${err.message}`)
    process.exit(1)
  }
}

// 更新 package.json
function updatePackageJson(config) {
  const packagePath = path.join(PROJECT_ROOT, 'package.json')

  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

    packageJson.name = config.app.name
    packageJson.description = config.app.description
    packageJson.author = config.app.author

    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2), 'utf8')
    success('已更新 package.json')
  } catch (err) {
    error(`更新 package.json 失败: ${err.message}`)
  }
}

// 更新 electron-builder.yml
function updateElectronBuilder(config) {
  const builderPath = path.join(PROJECT_ROOT, 'electron-builder.yml')

  try {
    let content = fs.readFileSync(builderPath, 'utf8')

    // 替换 appId
    content = content.replace(/appId: .+/, `appId: ${config.app.appId}`)

    // 替换 productName
    content = content.replace(/productName: .+/, `productName: ${config.app.productName}`)

    // 替换 executableName (Windows)
    content = content.replace(/executableName: .+/, `executableName: ${config.app.executableName}`)

    // 替换 shortcutName (Windows)
    content = content.replace(/shortcutName: .+/, `shortcutName: ${config.app.productName}`)

    // 替换 uninstallDisplayName (Windows)
    content = content.replace(/uninstallDisplayName: .+/, `uninstallDisplayName: ${config.app.productName}`)

    // 替换 maintainer (Linux)
    content = content.replace(/maintainer: .+/, `maintainer: ${config.app.author}`)

    // 替换 publish URL
    if (config.update && config.update.baseUrl) {
      content = content.replace(/url: https:\/\/cdn\.deepchatai\.cn\/upgrade\//, `url: ${config.update.baseUrl}`)
    }

    fs.writeFileSync(builderPath, content, 'utf8')
    success('已更新 electron-builder.yml')
  } catch (err) {
    error(`更新 electron-builder.yml 失败: ${err.message}`)
  }
}

// 更新 electron-builder-macx64.yml
function updateElectronBuilderMacX64(config) {
  const builderPath = path.join(PROJECT_ROOT, 'electron-builder-macx64.yml')

  if (!fs.existsSync(builderPath)) {
    return // 文件不存在则跳过
  }

  try {
    let content = fs.readFileSync(builderPath, 'utf8')

    // 替换 appId
    content = content.replace(/appId: .+/, `appId: ${config.app.appId}`)

    // 替换 productName
    content = content.replace(/productName: .+/, `productName: ${config.app.productName}`)

    // 替换 publish URL
    if (config.update && config.update.baseUrl) {
      content = content.replace(/url: https:\/\/cdn\.deepchatai\.cn\/upgrade\//, `url: ${config.update.baseUrl}`)
    }

    fs.writeFileSync(builderPath, content, 'utf8')
    success('已更新 electron-builder-macx64.yml')
  } catch (err) {
    error(`更新 electron-builder-macx64.yml 失败: ${err.message}`)
  }
}

// 更新主进程中的 app user model ID
function updateMainIndex(config) {
  const mainIndexPath = path.join(PROJECT_ROOT, 'src/main/index.ts')

  try {
    let content = fs.readFileSync(mainIndexPath, 'utf8')

    // 替换 setAppUserModelId
    content = content.replace(
      /electronApp\.setAppUserModelId\('.*?'\)/,
      `electronApp.setAppUserModelId('${config.app.appId}')`
    )

    fs.writeFileSync(mainIndexPath, content, 'utf8')
    success('已更新 src/main/index.ts')
  } catch (err) {
    error(`更新 src/main/index.ts 失败: ${err.message}`)
  }
}

// 更新升级服务器配置
function updateUpgradePresenter(config) {
  const upgradePath = path.join(PROJECT_ROOT, 'src/main/presenter/upgradePresenter/index.ts')

  if (!config.update || !config.update.baseUrl) {
    return // 没有配置更新 URL 则跳过
  }

  try {
    let content = fs.readFileSync(upgradePath, 'utf8')

    // 替换更新基础 URL
    content = content.replace(
      /return 'https:\/\/cdn\.deepchatai\.cn\/upgrade'/,
      `return '${config.update.baseUrl}'`
    )

    fs.writeFileSync(upgradePath, content, 'utf8')
    success('已更新升级服务器配置')
  } catch (err) {
    error(`更新升级服务器配置失败: ${err.message}`)
  }
}

// 更新国际化文件
function updateI18nFiles(config) {
  const i18nDir = path.join(PROJECT_ROOT, 'src/renderer/src/i18n')

  if (!config.i18n) {
    return
  }

  // 支持的语言
  const locales = ['en-US', 'zh-CN', 'zh-TW', 'zh-HK', 'ja-JP', 'ko-KR', 'ru-RU', 'fr-FR', 'fa-IR']

  for (const locale of locales) {
    const aboutPath = path.join(i18nDir, locale, 'about.json')

    if (!fs.existsSync(aboutPath)) {
      continue
    }

    try {
      const aboutJson = JSON.parse(fs.readFileSync(aboutPath, 'utf8'))

      // 更新应用标题
      if (config.i18n.appTitle && config.i18n.appTitle[locale]) {
        aboutJson.title = config.i18n.appTitle[locale]
      }

      // 更新应用描述
      if (config.i18n.appDescription && config.i18n.appDescription[locale]) {
        aboutJson.description = config.i18n.appDescription[locale]
      }

      // 更新网站文本
      if (config.i18n.websiteText && config.i18n.websiteText[locale]) {
        aboutJson.website = config.i18n.websiteText[locale]
      }

      fs.writeFileSync(aboutPath, JSON.stringify(aboutJson, null, 2), 'utf8')
    } catch (err) {
      warning(`更新 ${locale} 国际化文件失败: ${err.message}`)
    }
  }

  success('已更新国际化文件')
}

// 更新 MCP 服务描述
function updateMcpConfHelper(config) {
  const mcpHelperPath = path.join(PROJECT_ROOT, 'src/main/presenter/configPresenter/mcpConfHelper.ts')

  if (!config.mcp) {
    return
  }

  try {
    let content = fs.readFileSync(mcpHelperPath, 'utf8')

    // 替换中文服务描述后缀
    if (config.mcp.serverDescriptionSuffix) {
      content = content.replace(/DeepChat内置/g, config.mcp.serverDescriptionSuffix)
    }

    // 替换英文服务描述后缀
    if (config.mcp.serverDescriptionSuffixEn) {
      content = content.replace(/DeepChat built-in/g, config.mcp.serverDescriptionSuffixEn)
    }

    fs.writeFileSync(mcpHelperPath, content, 'utf8')
    success('已更新 MCP 服务描述')
  } catch (err) {
    error(`更新 MCP 服务描述失败: ${err.message}`)
  }
}

// 复制品牌资源文件
function copyBrandAssets() {
  const assetsDir = path.join(PROJECT_ROOT, 'scripts/brand-assets')

  if (!fs.existsSync(assetsDir)) {
    warning('品牌资源目录不存在: scripts/brand-assets/')
    warning('请创建该目录并放入您的品牌资源文件')
    return
  }

  const assetMappings = [
    // 图标文件
    { src: 'icon.png', dest: 'resources/icon.png' },
    { src: 'icon.ico', dest: 'resources/icon.ico' },
    { src: 'icon.png', dest: 'build/icon.png' },

    // Logo 文件
    { src: 'logo.png', dest: 'src/renderer/src/assets/logo.png' },
    { src: 'logo-dark.png', dest: 'src/renderer/src/assets/logo-dark.png' }
  ]

  let copiedCount = 0

  for (const mapping of assetMappings) {
    const srcPath = path.join(assetsDir, mapping.src)
    const destPath = path.join(PROJECT_ROOT, mapping.dest)

    if (fs.existsSync(srcPath)) {
      try {
        // 确保目标目录存在
        const destDir = path.dirname(destPath)
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true })
        }

        fs.copyFileSync(srcPath, destPath)
        copiedCount++
      } catch (err) {
        warning(`复制 ${mapping.src} 失败: ${err.message}`)
      }
    }
  }

  if (copiedCount > 0) {
    success(`已复制 ${copiedCount} 个品牌资源文件`)
  } else {
    warning('未找到品牌资源文件，请检查 scripts/brand-assets/ 目录')
  }
}

// 主函数
function main() {
  log('🚀 开始执行 DeepChat 品牌替换...', colors.blue)
  log('')

  // 读取品牌配置
  const config = loadBrandConfig()
  info(`品牌名称: ${config.app.productName}`)
  info(`应用ID: ${config.app.appId}`)
  log('')

  // 执行替换
  updatePackageJson(config)
  updateElectronBuilder(config)
  updateElectronBuilderMacX64(config)
  updateMainIndex(config)
  updateUpgradePresenter(config)
  updateI18nFiles(config)
  updateMcpConfHelper(config)
  copyBrandAssets()

  log('')
  log('🎉 品牌替换完成！', colors.green)
  log('')
  log('📋 接下来的步骤:')
  log('1. 检查修改的文件是否符合预期')
  log('2. 提交代码到您的仓库')
  log('3. 构建应用: pnpm run build:mac:arm64 (或其他平台)')
  log('')
  log('💡 提示: 如果需要恢复原始配置，请使用 git checkout 命令')
}

// 运行
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
