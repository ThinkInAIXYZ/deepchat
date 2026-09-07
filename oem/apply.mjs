#!/usr/bin/env node
/**
 * MioAgent OEM 品牌层重放脚本（幂等，可反复执行）。
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
  { old: "const GITHUB_OWNER = 'ThinkInAIXYZ'", new: `const GITHUB_OWNER = '${cfg.githubOwner}'`, must: true },
  { old: "const GITHUB_REPO = 'deepchat'", new: `const GITHUB_REPO = '${cfg.githubRepo}'`, must: true },
  { old: "const OFFICIAL_DOWNLOAD_URL = 'https://deepchatai.cn/#/download'", new: `const OFFICIAL_DOWNLOAD_URL = '${cfg.officialDownloadUrl}'`, must: true }
])

editFile('src/main/device/index.ts', [
  { old: "'https://deepchatai.cn'", new: `'${cfg.httpReferer}'` },
  { re: /'X-Title': 'DeepChat'/g, new: `'X-Title': '${cfg.productName}'` },
  { re: /`DeepChat\/\$\{version\}`/g, new: `\`${cfg.productName}/\${version}\`` }
])

editFile('src/main/provider/baseProvider.ts', [
  { re: /'HTTP-Referer': 'https:\/\/deepchatai\.cn'/g, new: `'HTTP-Referer': '${cfg.httpReferer}'` },
  { re: /'X-Title': 'DeepChat'/g, new: `'X-Title': '${cfg.productName}'` },
  { re: /`DeepChat\/\$\{version\}`/g, new: `\`${cfg.productName}/\${version}\`` }
])

editFile('src/main/mcp/mcprouterManager.ts', [
  { old: "'HTTP-Referer': 'deepchatai.cn',", new: `'HTTP-Referer': 'github.com/${cfg.githubOwner}/${cfg.githubRepo}',` },
  { old: "'X-Title': 'DeepChat'", new: `'X-Title': '${cfg.productName}'` }
])

editFile('src/main/mcp/inMemoryServers/artifactsServer.ts', [
  {
    old: 'Generated with [DeepChat](https://github.com/ThinkInAIXYZ/deepchat)',
    new: `Generated with [${cfg.productName}](${repoUrl})`,
    must: true
  },
  {
    old: '<a href="https://github.com/ThinkInAIXYZ/deepchat">DeepChat</a>',
    new: `<a href="${repoUrl}">${cfg.productName}</a>`,
    must: true
  }
])

editFile('src/renderer/settings/components/AboutUsSettings.vue', [
  { old: 'https://github.com/ThinkInAIXYZ/deepchat/blob/dev/LICENSE', new: `${repoUrl}/blob/main/LICENSE` },
  { old: 'https://github.com/ThinkInAIXYZ/deepchat/discussions/1226', new: cfg.issuesUrl },
  { old: 'https://github.com/ThinkInAIXYZ/deepchat', new: repoUrl }
])

editFile('src/renderer/src/components/mcp-config/McpServerForm.vue', [
  { old: 'HTTP-Referer=deepchatai.cn', new: `HTTP-Referer=github.com/${cfg.githubOwner}/${cfg.githubRepo}` }
])

// Windows AUMID 必须与 electron-builder.yml 的 appId 一致，否则通知/跳转列表归因错乱
editFile('src/main/app/mainProcess.ts', [
  { old: "electronApp.setAppUserModelId('com.wefonk.deepchat')", new: `electronApp.setAppUserModelId('${cfg.appId}')`, must: true }
])

// ---------- 2. electron-builder.yml ----------

editFile('electron-builder.yml', [
  { old: 'appId: com.wefonk.deepchat', new: `appId: ${cfg.appId}`, must: true },
  { old: 'productName: DeepChat', new: `productName: ${cfg.productName}`, must: true },
  { old: 'executableName: DeepChat', new: `executableName: ${cfg.winExecutableName}` },
  { old: 'maintainer: ThinkInAIXYZ', new: `maintainer: ${cfg.maintainer}` },
  {
    old: 'publish:\n  provider: github\n  owner: ThinkInAIXYZ\n  repo: deepchat',
    new: `publish:\n  provider: github\n  owner: ${cfg.githubOwner}\n  repo: ${cfg.githubRepo}`,
    must: true
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
  { re: /`DeepChat\/\$\{version\}`/g, new: `\`${cfg.productName}/\${version}\`` }
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

// OCR 冒烟夹具锚点：全大写 DEEPCHAT 不匹配清扫规则（清扫只命中大小写混排的 DeepChat），
// 必须显式改锚点，与测试夹具词（MioAgent）保持同步；DEEPCHAT_* 环境变量名是受保护前缀，不能整词替换
editFile('scripts/smoke-light-ocr.js', [
  { old: "normalized.includes('DEEPCHAT')", new: "normalized.includes('MIOAGENT')" },
  { old: '>DEEPCHAT</text>', new: '>MIOAGENT</text>' }
])

// 该测试位于 test/main/agent/deepchat/ 清扫排除区内（保护标识符），但其断言的是
// src/shared/lib/deepchatSubagents.ts 的用户可见报错文案，需要显式跟随品牌化
editFile('test/main/agent/deepchat/deepChatAgentRepository.test.ts', [
  {
    old: 'Enabled DeepChat Subagents require at least one valid slot.',
    new: `Enabled ${cfg.productName} Subagents require at least one valid slot.`
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
const SWEEP_STANDALONE = /DeepChat(?![A-Za-z0-9_])/g
const SWEEP_SUFFIX_IDENT = /[A-Za-z]DeepChat(?![A-Za-z0-9_])/g

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
