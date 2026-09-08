#!/usr/bin/env node
/**
 * MioWork OEM 品牌层重放脚本（幂等，可反复执行）。
 *
 * 为什么存在：OEM 与官方 DeepChat 同步更新时，冲突面 = 本脚本覆盖的文件集合。
 * 同步流程见仓库根 README.md：merge 上游 → pnpm install → pnpm run oem:apply → 跑验证。
 *
 * 禁改清单（本脚本永不触碰，合并冲突时一律保留上游写法）：
 *  - 内部运行时标识：agentType 'deepchat'、window.deepchat、DEEPCHAT_* 环境变量/IPC 频道、
 *    src/main/agent/deepchat/ 目录、deepchat:// 协议、CLI 二进制名 deepchat、e2e data-testid
 *  - i18n key（只改 value）、值里的小写 'deepchat'（受保护内置 Agent 的数据库标识）
 *    与 'deepchat-inmemory'（内建 MCP server 标识）
 *  - CUA 插件资产名 / electron-builder signIgnore / x-scheme-handler/deepchat
 *  - GitHub Copilot OAuth 回调 deepchatai.cn（需要自有 GitHub OAuth App，经 .env 覆盖）
 *  - 上游插件/公共配置下载源（ThinkInAIXYZ releases、PublicProviderConf，保持跟随官方）
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 用 fileURLToPath 而不是 import.meta.dirname：后者 Node 20.11 才有，旧 shell 默认 Node 会直接崩
const root = resolve(fileURLToPath(import.meta.url), '../..')
const cfg = JSON.parse(readFileSync(join(root, 'oem/oem.config.json'), 'utf8')).brand

const repoUrl = cfg.repoUrl
const report = { changed: [], skipped: [], failed: [] }

function editFile(relPath, edits, { must = false } = {}) {
  const abs = join(root, relPath)
  let text
  try {
    text = readFileSync(abs, 'utf8')
  } catch {
    report.failed.push(`${relPath}: 文件不存在`)
    return
  }
  const original = text
  const hits = []
  let alreadyCount = 0
  for (const e of edits) {
    if (e.re) {
      const found = text.match(e.re)
      if (found) {
        hits.push(`${e.re}×${found.length}`)
        text = text.replace(e.re, e.new)
      } else if (e.must && !(e.okIf && text.includes(e.okIf))) {
        report.failed.push(`${relPath}: 未命中 ${e.re}`)
      } else if (e.must) {
        // 旧串已不存在但目标串在，视为上次已应用，不报错
        alreadyCount++
      }
    } else {
      const count = text.split(e.old).length - 1
      if (count > 0) {
        hits.push(`"${e.old.slice(0, 48)}…"×${count}`.slice(0, 90))
        text = text.split(e.old).join(e.new)
      } else if (e.must && !text.includes(e.okIf ?? e.new)) {
        report.failed.push(`${relPath}: 未命中 "${e.old.slice(0, 60)}"`)
      } else if (e.must) {
        alreadyCount++
      }
    }
  }
  if (text !== original) {
    writeFileSync(abs, text)
    report.changed.push(`${relPath} (${hits.join(', ')})`)
  } else if (hits.length > 0 || alreadyCount > 0) {
    report.skipped.push(`${relPath} (已是目标内容${alreadyCount ? `, ${alreadyCount} 处已应用` : ''})`)
  } else if (!must) {
    report.skipped.push(`${relPath} (无命中)`)
  }
}

// ---------- 1. 主进程 / renderer 源码里的品牌锚点 ----------

editFile('src/main/appMain.ts', [
  { old: "const APP_NAME = 'DeepChat'", new: `const APP_NAME = '${cfg.productName}'`, must: true }
])

editFile('src/renderer/index.html', [
  { old: '<title>DeepChat</title>', new: `<title>${cfg.productName}</title>`, must: true }
])

editFile('src/renderer/settings/index.html', [
  { old: '<title>DeepChat - Settings</title>', new: `<title>${cfg.productName} - Settings</title>`, must: true }
])

editFile('src/main/upgrade/index.ts', [
  // 三种盘面形态并存：上游原文 / 历史重放（MioAgent） / 当前目标
  { re: /const GITHUB_OWNER = '(?:ThinkInAIXYZ|chenjiaqiangmax)'/, new: `const GITHUB_OWNER = '${cfg.githubOwner}'`, must: true, okIf: `const GITHUB_OWNER = '${cfg.githubOwner}'` },
  { re: /const GITHUB_REPO = '(?:deepchat|mioagent|mioclaw)'/, new: `const GITHUB_REPO = '${cfg.githubRepo}'`, must: true, okIf: `const GITHUB_REPO = '${cfg.githubRepo}'` },
  {
    re: /const OFFICIAL_DOWNLOAD_URL = '(?:https:\/\/deepchatai\.cn\/#\/download|https:\/\/github\.com\/chenjiaqiangmax\/(?:mioagent|mioclaw|miowork)\/releases)'/,
    new: `const OFFICIAL_DOWNLOAD_URL = '${cfg.officialDownloadUrl}'`,
    must: true,
    okIf: `const OFFICIAL_DOWNLOAD_URL = '${cfg.officialDownloadUrl}'`
  }
])

editFile('src/main/device/index.ts', [
  { re: /'https:\/\/(?:deepchatai\.cn|github\.com\/chenjiaqiangmax\/(?:mioagent|mioclaw|miowork))'/g, new: `'${cfg.httpReferer}'` },
  { re: /'X-Title': 'DeepChat'/g, new: `'X-Title': '${cfg.productName}'` },
  { re: /`DeepChat\/\$\{version\}`/g, new: `\`${cfg.productName}/\${version}\`` }
])

editFile('src/main/provider/baseProvider.ts', [
  { re: /'HTTP-Referer': 'https:\/\/(?:deepchatai\.cn|github\.com\/chenjiaqiangmax\/(?:mioagent|mioclaw|miowork))'/g, new: `'HTTP-Referer': '${cfg.httpReferer}'` },
  { re: /'X-Title': 'DeepChat'/g, new: `'X-Title': '${cfg.productName}'` },
  { re: /`DeepChat\/\$\{version\}`/g, new: `\`${cfg.productName}/\${version}\`` }
])

editFile('src/main/mcp/mcprouterManager.ts', [
  {
    re: /'HTTP-Referer': '(?:deepchatai\.cn|github\.com\/chenjiaqiangmax\/(?:mioagent|mioclaw|miowork))',/g,
    new: `'HTTP-Referer': 'github.com/${cfg.githubOwner}/${cfg.githubRepo}',`
  },
  { old: "'X-Title': 'DeepChat'", new: `'X-Title': '${cfg.productName}'` }
])

editFile('src/main/mcp/inMemoryServers/artifactsServer.ts', [
  {
    re: /Generated with \[DeepChat\]\(https:\/\/github\.com\/ThinkInAIXYZ\/deepchat\)|Generated with \[Mio(?:Agent|Claw|Work)\]\(https:\/\/github\.com\/chenjiaqiangmax\/(?:mioagent|mioclaw|miowork)\)/,
    new: `Generated with [${cfg.productName}](${repoUrl})`,
    must: true,
    okIf: `Generated with [${cfg.productName}](${repoUrl})`
  },
  {
    re: /<a href="https:\/\/github\.com\/(?:ThinkInAIXYZ\/deepchat|chenjiaqiangmax\/(?:mioagent|mioclaw|miowork))">(?:DeepChat|Mio(?:Agent|Claw|Work))<\/a>/,
    new: `<a href="${repoUrl}">${cfg.productName}</a>`,
    must: true,
    okIf: `<a href="${repoUrl}">${cfg.productName}</a>`
  }
])

editFile('src/renderer/settings/components/AboutUsSettings.vue', [
  // 盘面形态并存：上游原文 / 历史重放（mioagent/mioclaw）/ 当前目标（含目标形态以保幂等）
  {
    re: /https:\/\/github\.com\/(?:ThinkInAIXYZ\/deepchat|chenjiaqiangmax\/(?:mioagent|mioclaw|miowork))\/blob\/(?:dev|main)\/LICENSE/g,
    new: `${repoUrl}/blob/main/LICENSE`
  },
  {
    re: /https:\/\/github\.com\/(?:ThinkInAIXYZ\/deepchat|chenjiaqiangmax\/(?:mioagent|mioclaw|miowork))\/(?:discussions\/\d+|issues)/g,
    new: cfg.issuesUrl
  },
  {
    re: /https:\/\/github\.com\/(?:ThinkInAIXYZ\/deepchat|chenjiaqiangmax\/(?:mioagent|mioclaw|miowork))(?!\/)/g,
    new: repoUrl
  }
])

editFile('src/renderer/src/components/mcp-config/McpServerForm.vue', [
  {
    re: /HTTP-Referer=(?:deepchatai\.cn|github\.com\/chenjiaqiangmax\/(?:mioagent|mioclaw|miowork))/g,
    new: `HTTP-Referer=github.com/${cfg.githubOwner}/${cfg.githubRepo}`
  }
])

// Windows AUMID 必须与 electron-builder.yml 的 appId 一致，否则通知/跳转列表归因错乱
editFile('src/main/app/mainProcess.ts', [
  // 三种盘面形态并存：上游原文 / 历史重放（MioAgent） / 当前目标（okIf 兼容 MioClaw）
  { re: /electronApp\.setAppUserModelId\('(?:com\.wefonk\.deepchat|com\.mioagent\.app|com\.mioclaw\.app)'\)/, new: `electronApp.setAppUserModelId('${cfg.appId}')`, must: true, okIf: `setAppUserModelId('${cfg.appId}')` }
])

// ---------- 2. electron-builder.yml ----------

editFile('electron-builder.yml', [
  { re: /^appId: (?:com\.wefonk\.deepchat|com\.mioagent\.app|com\.mioclaw\.app)$/m, new: `appId: ${cfg.appId}`, must: true, okIf: `appId: ${cfg.appId}` },
  { re: /^productName: (?:DeepChat|MioAgent|MioClaw)$/m, new: `productName: ${cfg.productName}`, must: true, okIf: `productName: ${cfg.productName}` },
  { re: /^  executableName: (?:DeepChat|MioAgent|MioClaw|MioWork)$/m, new: `  executableName: ${cfg.winExecutableName}`, okIf: `  executableName: ${cfg.winExecutableName}` },
  { re: /^maintainer: (?:ThinkInAIXYZ|chenjiaqiangmax)$/m, new: `maintainer: ${cfg.maintainer}`, okIf: `maintainer: ${cfg.maintainer}` },
  {
    re: /publish:\n  provider: github\n  owner: (?:ThinkInAIXYZ|chenjiaqiangmax)\n  repo: (?:deepchat|mioagent|mioclaw)/,
    new: `publish:\n  provider: github\n  owner: ${cfg.githubOwner}\n  repo: ${cfg.githubRepo}`,
    must: true,
    okIf: `owner: ${cfg.githubOwner}\n  repo: ${cfg.githubRepo}`
  }
])

// ---------- 3. package.json（JSON 重写；该文件不在上游契约里，无需保字节） ----------

const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
let pkgDirty = false
if (pkg.name !== cfg.npmName) {
  pkg.name = cfg.npmName
  pkgDirty = true
}
if (pkg.description !== cfg.description) {
  pkg.description = cfg.description
  pkgDirty = true
}
if (pkg.author !== cfg.author) {
  pkg.author = cfg.author
  pkgDirty = true
}
if (pkg.scripts['oem:apply'] !== 'node oem/apply.mjs') {
  pkg.scripts['oem:apply'] = 'node oem/apply.mjs'
  pkgDirty = true
}
if (pkgDirty) {
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  report.changed.push('package.json (name/description/author/oem:apply)')
} else {
  report.skipped.push('package.json (已是目标内容)')
}

// ---------- 4. i18n：20 个语言包，只改 value，键与结构原样 ----------

const I18N_VALUE_REPLACES = [
  // 历史品牌名（MioAgent/MioClaw）排在最前：改名后重放时先把旧品牌收敛到当前品牌，
  // 否则 must 锚点的「已应用」检查（找 cfg.productName）会把盘面上的旧品牌误判为未命中
  ['MioAgent', cfg.productName],
  ['MioClaw', cfg.productName],
  ['DeepChat Agents', `${cfg.productName} Agents`],
  ['DeepChat', cfg.productName],
  // 上游部分语言包混用 'Deepchat'（ja-JP/ko-KR/fa-IR/fr-FR 的 MCP 描述等），一并收敛
  ['Deepchat', cfg.productName],
  ['ThinkInAIXYZ', cfg.githubOwner],
  // 公共 Provider 配置仓库属于上游生态（DataSettings 的 URL 本身不改），linkLabel 撤回指向上游；
  // 必须放在 ThinkInAIXYZ 规则之后，把上一条误转换的 owner 换回来
  ['chenjiaqiangmax/PublicProviderConf', 'ThinkInAIXYZ/PublicProviderConf'],
  ['https://deepchatai.cn/#/download', cfg.officialDownloadUrl],
  ['https://deepchatai.cn', repoUrl],
  ['deepchatai.cn', `github.com/${cfg.githubOwner}/${cfg.githubRepo}`]
]

function walkJsonValues(node, fn) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = walkJsonValues(node[i], fn)
    return node
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) node[k] = walkJsonValues(node[k], fn)
    return node
  }
  return typeof node === 'string' ? fn(node) : node
}

const i18nDir = join(root, 'src/renderer/src/i18n')
let i18nFiles = 0
let i18nHitFiles = 0
for (const entry of readdirSync(i18nDir)) {
  const dir = join(i18nDir, entry)
  if (!statSync(dir).isDirectory()) continue
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    i18nFiles++
    const abs = join(dir, name)
    const json = JSON.parse(readFileSync(abs, 'utf8'))
    let hit = false
    walkJsonValues(json, (v) => {
      let out = v
      for (const [from, to] of I18N_VALUE_REPLACES) {
        if (out.includes(from)) {
          out = out.split(from).join(to)
          hit = true
        }
      }
      return out
    })
    if (hit) {
      // 上游文件本来就是 2 空格缩进 + 结尾换行，stringify(…,2) 与之逐字节对齐
      writeFileSync(abs, JSON.stringify(json, null, 2) + '\n')
      i18nHitFiles++
    }
  }
}
report.changed.push(`i18n value 替换: ${i18nHitFiles}/${i18nFiles} 个文件（key 不动）`)

// 20 个语言包入口 index.ts 里的长文案（免责声明/搜索提示）也含品牌串；
// 已审计：这些文件里 DeepChat 只出现在字符串字面量中（无同名标识符），可整文件文本替换
for (const entry of readdirSync(i18nDir)) {
  const dir = join(i18nDir, entry)
  if (!statSync(dir).isDirectory()) continue
  const tsPath = join(dir, 'index.ts')
  let text
  try {
    text = readFileSync(tsPath, 'utf8')
  } catch {
    continue
  }
  // 独立词元替换：不误伤 DeepchatXxx 类标识符；小写 deepchat（数据库标识）不受影响
  const next = text
    .replace(/MioAgent(?![A-Za-z0-9_])/g, cfg.productName)
    .replace(/MioClaw(?![A-Za-z0-9_])/g, cfg.productName)
    .replace(/DeepChat(?![A-Za-z0-9_])/g, cfg.productName)
    .replace(/Deepchat(?![A-Za-z0-9_])/g, cfg.productName)
  if (next === text) continue
  writeFileSync(tsPath, next)
  report.changed.push(`i18n prose: ${entry}/index.ts`)
}

// ---------- 5. 测试契约同步（断言里写死的品牌串） ----------

const TEST_DATA_EDITS = [
  { old: 'https://deepchatai.cn/#/download', new: cfg.officialDownloadUrl },
  { old: 'https://deepchatai.cn', new: cfg.httpReferer },
  { old: 'ThinkInAIXYZ/deepchat', new: `${cfg.githubOwner}/${cfg.githubRepo}` },
  { old: "'X-Title': 'DeepChat'", new: `'X-Title': '${cfg.productName}'` },
  { old: ".toBe('DeepChat')", new: `.toBe('${cfg.productName}')` },
  { old: 'with DeepChat/ prefix', new: `with ${cfg.productName}/ prefix` },
  { old: '/^DeepChat\\//', new: `/^${cfg.productName}\\//` },
  { re: /`DeepChat\/\$\{version\}`/g, new: `\`${cfg.productName}/\${version}\`` },
  // 历史重放残留的小写仓库 slug（二轮清扫只认驼峰形态，URL 里的 slug 由这里收敛）
  { old: 'chenjiaqiangmax/mioagent', new: `${cfg.githubOwner}/${cfg.githubRepo}` },
  { old: 'chenjiaqiangmax/mioclaw', new: `${cfg.githubOwner}/${cfg.githubRepo}` }
]
for (const f of [
  'test/main/upgrade/upgradeService.test.ts',
  'test/main/device/deviceService.test.ts',
  'test/main/provider/aiSdkProviderFactory.test.ts',
  'test/main/provider/aihubmixProvider.test.ts'
]) {
  editFile(f, TEST_DATA_EDITS)
}

editFile('test/e2e/fixtures/electronApp.ts', [
  { old: "'DeepChat.exe'", new: `'${cfg.winExecutableName}.exe'`, must: true },
  { old: "title === 'DeepChat'", new: `title === '${cfg.productName}'`, must: true },
  { old: ", 'DeepChat')", new: `, '${cfg.productName}')`, must: true }
])

// 断言真实产品窗口标题的用例跟着产品名走；用例自建的实体名（DeepChat E2E Hook 等）与产品无关，不动
editFile('test/e2e/specs/32-composer-width.smoke.spec.ts', [
  { old: "getTitle() === 'DeepChat'", new: `getTitle() === '${cfg.productName}'`, must: true }
])

// macOS 更新包契约夹具：合法 ZIP 的全部条目必须挂在单一 <产品>.app 根下。
// 两种 old 形态并存：上游原文（DeepChat 根）与本仓库清扫后的盘面（MioAgent/DeepChat 混合根）。
// 夹具里故意保留的非法条目（../ 前缀、Other.app、重复根）不受影响——改完后仍按原意抛错。
editFile('test/main/scripts/packageContract.test.ts', [
  {
    old: "stdout: 'DeepChat.app/\\nDeepChat.app/Contents/Info.plist\\n',",
    new: `stdout: '${cfg.winExecutableName ?? cfg.productName}.app/\\n${cfg.productName}.app/Contents/Info.plist\\n',`
  },
  {
    old: "stdout: 'MioAgent.app/\\nDeepChat.app/Contents/Info.plist\\n',",
    new: `stdout: '${cfg.productName}.app/\\n${cfg.productName}.app/Contents/Info.plist\\n',`
  },
  {
    old: "validateMacZipEntries('DeepChat.app/\\nDeepChat.app/Contents/Info.plist\\n')",
    new: `validateMacZipEntries('${cfg.productName}.app/\\n${cfg.productName}.app/Contents/Info.plist\\n')`
  },
  {
    old: "validateMacZipEntries('MioAgent.app/\\nDeepChat.app/Contents/Info.plist\\n')",
    new: `validateMacZipEntries('${cfg.productName}.app/\\n${cfg.productName}.app/Contents/Info.plist\\n')`
  },
  {
    old: ").toEqual(['DeepChat.app/', 'DeepChat.app/Contents/Info.plist'])",
    new: `).toEqual(['${cfg.productName}.app/', '${cfg.productName}.app/Contents/Info.plist'])`
  }
])

// 夹具串里的字面量 \n 使 'nMioAgent' 形似驼峰后缀标识符，被清扫的
// SWEEP_SUFFIX_IDENT 保护并原样还原，只能在这里显式收敛为合法单根形态
editFile('test/main/scripts/packageContract.test.ts', [
  {
    old: "stdout: 'MioWork.app/\\nMioAgent.app/Contents/Info.plist\\n',",
    new: `stdout: '${cfg.productName}.app/\\n${cfg.productName}.app/Contents/Info.plist\\n',`
  },
  {
    old: "validateMacZipEntries('MioWork.app/\\nMioAgent.app/Contents/Info.plist\\n')",
    new: `validateMacZipEntries('${cfg.productName}.app/\\n${cfg.productName}.app/Contents/Info.plist\\n')`
  },
  {
    old: `).toEqual(['MioWork.app/', 'MioAgent.app/Contents/Info.plist'])`,
    new: `).toEqual(['${cfg.productName}.app/', '${cfg.productName}.app/Contents/Info.plist'])`
  }
])

// OCR 冒烟夹具锚点：全大写 DEEPCHAT 不匹配清扫规则（清扫只命中大小写混排的 DeepChat），
// 必须显式改锚点，与测试夹具词（MioAgent）保持同步；DEEPCHAT_* 环境变量名是受保护前缀，不能整词替换
editFile('scripts/smoke-light-ocr.js', [
  // 两种历史形态并存：上游原文（DEEPCHAT）与改名前重放产物（MIOAGENT/MIOCLAW）
  { old: "normalized.includes('DEEPCHAT')", new: `normalized.includes('${cfg.productName.toUpperCase()}')` },
  { old: "normalized.includes('MIOAGENT')", new: `normalized.includes('${cfg.productName.toUpperCase()}')` },
  { old: "normalized.includes('MIOCLAW')", new: `normalized.includes('${cfg.productName.toUpperCase()}')` },
  { old: '>DEEPCHAT</text>', new: `>${cfg.productName.toUpperCase()}</text>` },
  { old: '>MIOAGENT</text>', new: `>${cfg.productName.toUpperCase()}</text>` },
  { old: '>MIOCLAW</text>', new: `>${cfg.productName.toUpperCase()}</text>` }
])

// DMG 背景生成脚本：.py 不在清扫扩展名内，品牌串在这里显式跟随（含历史形态，保幂等）
editFile('build/generate-dmg-backgrounds.py', [
  { old: '生成 MioAgent DMG 背景图', new: `生成 ${cfg.productName} DMG 背景图` },
  { old: '生成 MioWork DMG 背景图', new: `生成 ${cfg.productName} DMG 背景图` },
  { old: '生成 MioClaw DMG 背景图', new: `生成 ${cfg.productName} DMG 背景图` },
  { old: 'product_name = "MioAgent"', new: `product_name = '${cfg.productName}'` },
  { old: "product_name = 'MioWork'", new: `product_name = '${cfg.productName}'` },
  { old: "product_name = 'MioClaw'", new: `product_name = '${cfg.productName}'` },
  { old: '将「MioAgent」拖动进「应用程序」文件夹', new: `将「${cfg.productName}」拖动进「应用程序」文件夹` },
  { old: '将「MioWork」拖动进「应用程序」文件夹', new: `将「${cfg.productName}」拖动进「应用程序」文件夹` }
])

// 该测试位于 test/main/agent/deepchat/ 清扫排除区内（保护标识符），但其断言的是
// src/shared/lib/deepchatSubagents.ts 的用户可见报错文案，需要显式跟随品牌化
editFile('test/main/agent/deepchat/deepChatAgentRepository.test.ts', [
  {
    // 该文件在清扫排除区内，历史重放残留的 MioAgent/MioClaw 形态必须在这里一并收敛
    re: /Enabled (?:DeepChat|MioAgent|MioClaw) Subagents require at least one valid slot\./g,
    new: `Enabled ${cfg.productName} Subagents require at least one valid slot.`
  }
])

// OEM 分叉：build.yml 的 macOS caller 以 verification 模式跑包（本仓无签名证书，跳过签名）。
// caller 级契约测试跟随分叉；_package-macos.yml 自身的 secrets 声明不动。上游若恢复
// distribution 默认，删除本块即可回到上游契约。
editFile('test/main/scripts/packageWorkflow.test.ts', [
  {
    old: "        'artifact-purpose': 'distribution',\n        'enforce-installer-size': false\n      })\n    }\n    expect(source).not.toContain('secrets: inherit')",
    new: "        'artifact-purpose': name === 'package-macos' ? 'verification' : 'distribution',\n        'enforce-installer-size': false\n      })\n    }\n    expect(source).not.toContain('secrets: inherit')"
  },
  {
    old: "    expect(macSecrets).toEqual([\n      ...Object.keys(commonSecrets),\n      'DEEPCHAT_CSC_LINK',\n      'DEEPCHAT_CSC_KEY_PASS',\n      'DEEPCHAT_APPLE_NOTARY_USERNAME',\n      'DEEPCHAT_APPLE_NOTARY_TEAM_ID',\n      'DEEPCHAT_APPLE_NOTARY_PASSWORD'\n    ])",
    new: "    expect(macSecrets).toEqual(Object.keys(commonSecrets))"
  },
  {
    old: "it('passes Apple credentials only to the macOS distribution caller', () => {",
    new: "it('macOS caller runs in verification mode without signing credentials', () => {"
  }
])

// ---------- 6. README（fork 版；上游原文随时可从 upstream remote 取回） ----------

const readme = `# ${cfg.productName}

${cfg.description}。基于开源项目 [DeepChat](https://github.com/ThinkInAIXYZ/deepchat)（Apache-2.0）的二次开发发行版，品牌与发布渠道由本仓库的 OEM 层管理。

## OEM 结构

- \`oem/oem.config.json\` —— 品牌映射的唯一来源（产品名/appId/仓库/URL）
- \`oem/apply.mjs\` —— 幂等重放脚本：\`pnpm run oem:apply\`
- \`oem/assets/logo.png\` —— 源 logo（应用图标由它生成）

## 与官方 DeepChat 同步更新

\`\`\`bash
git fetch upstream --tags                # upstream = https://github.com/ThinkInAIXYZ/deepchat
git merge <目标 tag 或 upstream/dev>      # 本仓库 main 与 v1.1.2-beta.1 已嫁接真实历史
pnpm install
pnpm run oem:apply                       # 重放全部品牌改动 + i18n value 替换
pnpm run i18n && pnpm run lint && mise exec -- pnpm run typecheck && pnpm run test:main
\`\`\`

合并冲突原则：**凡在下面禁改清单里的，一律保留上游写法**；品牌差异交给 \`oem:apply\` 重放，
不要在源文件里手工维护品牌串。

## 禁改清单（内部运行时标识，改了会破坏数据迁移/IPC/插件合同）

- \`agentType: 'deepchat'\`、\`window.deepchat\`、\`DEEPCHAT_*\` 环境变量与 IPC 频道名
- \`src/main/agent/deepchat/\` 模块路径、\`deepchat://\` 协议、CLI 二进制名 \`deepchat\`
- i18n key 与值中的小写 \`deepchat\`（受保护内置 Agent 的数据库标识）、\`deepchat-inmemory\`
- CUA 插件资产名（DeepChat Computer Use.app 等）与 \`electron-builder.yml\` 的 \`signIgnore\`
- \`x-scheme-handler/deepchat\`、上游插件/公共配置下载源（保持跟随官方更新）
- GitHub Copilot OAuth 回调（需自有 GitHub OAuth App，经 \`.env\` 的
  \`VITE_GITHUB_CLIENT_ID/SECRET/REDIRECT_URI\` 覆盖，见 \`.env.example\`）

## 验证

\`\`\`bash
pnpm run oem:apply
grep -rn "DeepChat\\|ThinkInAIXYZ\\|deepchatai.cn" src/ test/ scripts/ electron-builder.yml package.json \\
  | grep -v -E "agent/deepchat/|window\\.deepchat|DEEPCHAT_|deepchat://|'deepchat'|deepchat-inmemory|scheme-handler/deepchat|data-testid|deepchat\\.exe|deepchat\\.cmd|deepchat\\.mjs|deepchatAgents|deepchatSettings|deepchatType|Copilot|copilot|oauth|OAuth|signIgnore|Computer Use|PublicProviderConf|tape"
\`\`\`

Node 版本要求见 \`mise.toml\`（Node 24.x / pnpm 10.x）。
`
writeFileSync(join(root, 'README.md'), readme)
report.changed.push('README.md (fork 版)')

// ---------- 7. 二轮收敛：独立品牌词清扫（标识符自适应保护） ----------

// 为什么用扫描而不是逐条清单：上游 merge 后新增的品牌串无需维护清单即可被再次收敛。
// 安全性按构造保证：
//  - 后瞻 (?![A-Za-z0-9_])：DeepChatAgentConfig / DeepChatDefaults / DeepChatAgentsSettings
//    等标识符不匹配
//  - 前缀自适应掩码：createdByDeepChat、getDaysWithDeepChat 这类以 DeepChat 结尾的标识符
//    运行时自动识别并原样保留
//  - 显式掩码：CUA 插件资产名（DeepChat Computer Use，与 signIgnore/插件清单是硬合同）、
//    X-DeepChat-Artifact-Id 协议头
//  - 小写 deepchat（agentType/IPC 频道/协议/表名/CLI 二进制名/DEEPCHAT_* 环境变量）
//    大小写敏感，天然不匹配
// DeepChat.app 保留：packageContract 的「另一个 app」非法夹具依赖它与 MioAgent.app 并存，
// 清成双 MioAgent 根会让夹具语义从「异包」退化成「重复根」
const SWEEP_MASKS = ['DeepChat Computer Use', 'X-DeepChat-Artifact-Id', 'x-deepchat-artifact-id', 'DeepChat.app']
const SWEEP_STANDALONE = /(?:DeepChat|MioAgent|MioClaw)(?![A-Za-z0-9_])/g
const SWEEP_SUFFIX_IDENT = /[A-Za-z](?:DeepChat|MioAgent|MioClaw)(?![A-Za-z0-9_])/g

function sweepTokens(relPath) {
  const abs = join(root, relPath)
  let text
  try {
    text = readFileSync(abs, 'utf8')
  } catch {
    return
  }
  const restores = []
  let masked = text
  for (const literal of SWEEP_MASKS) {
    while (masked.includes(literal)) {
      const placeholder = `\u0000${restores.length}\u0000`
      restores.push([placeholder, literal])
      masked = masked.replace(literal, placeholder)
    }
  }
  masked = masked.replace(SWEEP_SUFFIX_IDENT, (m) => {
    const placeholder = `\u0000${restores.length}\u0000`
    restores.push([placeholder, m])
    return placeholder
  })
  const hits = masked.match(SWEEP_STANDALONE)
  if (!hits) return
  masked = masked.replace(SWEEP_STANDALONE, cfg.productName)
  for (const [placeholder, literal] of restores) {
    masked = masked.split(placeholder).join(literal)
  }
  writeFileSync(abs, masked)
  report.changed.push(`${relPath} (独立品牌词 ×${hits.length})`)
}

const SWEEP_PATH_EXCLUSIONS = [
  /\/agent\/deepchat\//, // 内置 agent 模块：标识符与运行时合同，永不触碰
  /\/i18n\//, // 语言包由第 4 节按「只改 value」规则处理
  /\/plugins\//, // 上游插件包（CUA/feishu）自带品牌合同，跟随官方发布物
  /node_modules\//, // 任意深度的依赖目录
  /^(out|runtime)\//, // 仅仓库顶层构建产物目录；嵌套源码目录（如 agent/acp/runtime）不豁免，
  // 否则 clientInfo 等对外身份串会漏清扫（上一版用 (^|\/)(out|runtime)\/ 连 src 里的同名目录一起跳过了）
  /pnpm-lock\.yaml$/,
  /electron-builder\.yml$/, // 打包合同由第 2 节精确改；signIgnore 的 CUA 资产名不能动
  /package\.json$/
]
const SWEEP_CODE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|vue|css|scss|html|md)$/

function collectSweepFiles(dirRel, acc = []) {
  let entries
  try {
    entries = readdirSync(join(root, dirRel))
  } catch {
    return acc
  }
  for (const name of entries) {
    const rel = `${dirRel}/${name}`
    if (SWEEP_PATH_EXCLUSIONS.some((re) => re.test(rel))) continue
    let st
    try {
      st = statSync(join(root, rel))
    } catch {
      continue
    }
    if (st.isDirectory()) collectSweepFiles(rel, acc)
    else if (SWEEP_CODE_EXT.test(name)) acc.push(rel)
  }
  return acc
}

let sweptFiles = 0
let sweptHits = 0
for (const base of ['src', 'scripts', 'test']) {
  for (const rel of collectSweepFiles(base)) {
    const before = report.changed.length
    sweepTokens(rel)
    if (report.changed.length > before) {
      sweptFiles++
      sweptHits += Number(
        (report.changed[report.changed.length - 1].match(/×(\d+)$/) ?? [])[1] ?? 0
      )
    }
  }
}
report.changed.push(`二轮清扫: ${sweptFiles} 个文件 / ${sweptHits} 处独立品牌词`)

// ---------- 汇总 ----------

console.log(`[oem] apply 完成: ${report.changed.length} 项修改, ${report.skipped.length} 项跳过`)
for (const line of report.changed) console.log(`  changed: ${line}`)
for (const line of report.skipped) console.log(`  skipped: ${line}`)
if (report.failed.length > 0) {
  console.error(`[oem] ${report.failed.length} 项失败:`)
  for (const line of report.failed) console.error(`  FAILED: ${line}`)
  process.exit(1)
}
