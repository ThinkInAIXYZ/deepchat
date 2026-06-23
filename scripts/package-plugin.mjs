import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'

const OFFICIAL_PLUGIN_SOURCE = 'deepchat-official'
const CUA_DARWIN_HELPER_APP = 'DeepChat Computer Use.app'
const CUA_DARWIN_HELPER_EXECUTABLE = 'deepchat-cua-driver'
const CUA_DARWIN_HELPER_BUNDLE_ID = 'com.deepchat.computeruse.helper'
const CUA_DARWIN_MANAGED_HELPER_DETECT = `app-helper:${CUA_DARWIN_HELPER_APP}/Contents/MacOS/${CUA_DARWIN_HELPER_EXECUTABLE}`

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function parseArgs(argv) {
  const args = {
    validateOnly: false,
    outDir: path.resolve('dist', 'plugins'),
    pluginDir: null,
    releaseVersionFromRoot: false,
    version: null,
    targetPlatform: process.env.TARGET_PLATFORM ?? process.platform,
    targetArch: process.env.TARGET_ARCH ?? process.arch
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--validate') {
      args.validateOnly = true
      continue
    }
    if (arg === '--out') {
      args.outDir = path.resolve(argv[index + 1] || '')
      index += 1
      continue
    }
    if (arg === '--release-version-from-root') {
      args.releaseVersionFromRoot = true
      continue
    }
    if (arg === '--version') {
      args.version = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg === '--target-platform') {
      args.targetPlatform = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg === '--target-arch') {
      args.targetArch = argv[index + 1] || ''
      index += 1
      continue
    }
    if (!args.pluginDir) {
      args.pluginDir = path.resolve(arg)
    }
  }

  if (!args.pluginDir) {
    throw new Error('Usage: node scripts/package-plugin.mjs [--validate] [--out <dir>] <pluginDir>')
  }
  args.targetPlatform = String(args.targetPlatform).toLowerCase()
  args.targetArch = String(args.targetArch).toLowerCase()
  return args
}

function readRootPackageVersion() {
  return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version
}

function assertSafeRelativePath(relativePath, label) {
  const normalized = relativePath.replace(/\\/g, '/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('..') ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe ${label}: ${relativePath}`)
  }
  return normalized
}

function assertFile(pluginDir, relativePath, label) {
  const normalized = assertSafeRelativePath(relativePath, label)
  const absolutePath = path.resolve(pluginDir, ...normalized.split('/').filter(Boolean))
  const relativeToRoot = path.relative(pluginDir, absolutePath)
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error(`${label} escapes plugin root: ${relativePath}`)
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Missing ${label}: ${relativePath}`)
  }
  return absolutePath
}

function fileExists(pluginDir, relativePath) {
  const normalized = assertSafeRelativePath(relativePath, relativePath)
  const absolutePath = path.resolve(pluginDir, ...normalized.split('/').filter(Boolean))
  const relativeToRoot = path.relative(pluginDir, absolutePath)
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error(`Path escapes plugin root: ${relativePath}`)
  }
  return fs.existsSync(absolutePath)
}

function readPlistString(plistContents, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = plistContents.match(
    new RegExp(`<key>${escapedKey}</key>\\s*<string>([^<]*)</string>`)
  )
  return match?.[1]
}

function readManifest(pluginDir) {
  const manifestPath = assertFile(pluginDir, 'plugin.json', 'manifest')
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

function validateManifest(pluginDir, manifest) {
  for (const field of ['id', 'name', 'version', 'publisher']) {
    if (typeof manifest[field] !== 'string' || manifest[field].trim().length === 0) {
      throw new Error(`plugin.json field "${field}" is required`)
    }
  }

  if (manifest.source?.type !== OFFICIAL_PLUGIN_SOURCE) {
    throw new Error('Only official-source plugins can be packaged')
  }

  if (manifest.source.publisher !== manifest.publisher) {
    throw new Error('source.publisher must match publisher')
  }

  if (!Array.isArray(manifest.engines?.platforms) || manifest.engines.platforms.length === 0) {
    throw new Error('engines.platforms must declare at least one platform')
  }
  if (
    manifest.engines.targets !== undefined &&
    (!Array.isArray(manifest.engines.targets) || manifest.engines.targets.length === 0)
  ) {
    throw new Error('engines.targets must be a non-empty array when declared')
  }

  for (const skill of manifest.skills ?? []) {
    assertFile(pluginDir, skill.path, `skill ${skill.id}`)
  }

  for (const contribution of manifest.settingsContributions ?? []) {
    assertFile(pluginDir, contribution.entry, `settings entry ${contribution.id}`)
    assertFile(pluginDir, contribution.preloadTypes, `preload types ${contribution.id}`)
  }
}

function shouldSkipPackageEntry(relativePath, manifest, args) {
  if (manifest?.id !== 'com.deepchat.plugins.cua') {
    return false
  }

  const parts = relativePath.split('/')
  if (parts[0] === 'runtime' && parts[1] && parts[2]) {
    return parts[1] !== args.targetPlatform || parts[2] !== args.targetArch
  }

  return false
}

function collectFiles(pluginDir, currentDir = pluginDir, files = {}, manifest, args) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (
      entry.isSymbolicLink() ||
      entry.name === '.DS_Store' ||
      entry.name === 'vendor' ||
      entry.name === 'build' ||
      entry.name === 'node_modules' ||
      entry.name === '.build'
    ) {
      continue
    }

    const absolutePath = path.join(currentDir, entry.name)
    const relativePath = path.relative(pluginDir, absolutePath).replace(/\\/g, '/')
    if (shouldSkipPackageEntry(relativePath, manifest, args)) {
      continue
    }

    if (entry.isDirectory()) {
      collectFiles(pluginDir, absolutePath, files, manifest, args)
      continue
    }

    const stat = fs.statSync(absolutePath)
    files[relativePath] = {
      content: new Uint8Array(fs.readFileSync(absolutePath)),
      mode: stat.mode
    }
  }
  return files
}

function artifactBaseName(manifest) {
  return manifest.id.startsWith('com.deepchat.plugins.')
    ? `deepchat-plugin-${manifest.id.slice('com.deepchat.plugins.'.length)}`
    : manifest.id
}

function artifactFileName(manifest, targetPlatform, targetArch) {
  const safeId = artifactBaseName(manifest).replace(/[^a-zA-Z0-9._-]/g, '-')
  const targetSuffix = targetPlatform && targetArch ? `-${targetPlatform}-${targetArch}` : ''
  return `${safeId}-${manifest.version}${targetSuffix}.dcplugin`
}

function targetKey(targetPlatform, targetArch) {
  return `${targetPlatform}/${targetArch}`
}

function releaseTag(version) {
  return version.startsWith('v') ? version : `v${version}`
}

function createPackageManifest(manifest, args) {
  const version = args.version || (args.releaseVersionFromRoot ? readRootPackageVersion() : manifest.version)
  const next = JSON.parse(
    JSON.stringify({ ...manifest, version })
      .replaceAll('${app.version}', version)
      .replaceAll('${arch}', args.targetArch)
      .replaceAll('${target.platform}', args.targetPlatform ?? '')
      .replaceAll(
        '${github.release.download}',
        `https://github.com/ThinkInAIXYZ/deepchat/releases/download/${releaseTag(version)}`
      )
  )
  if (
    Array.isArray(next.engines?.targets) &&
    isManifestTargetSupported(next, args.targetPlatform, args.targetArch)
  ) {
    next.engines.targets = [targetKey(args.targetPlatform, args.targetArch)]
  }
  if (next.source?.type === OFFICIAL_PLUGIN_SOURCE) {
    const assetName = artifactFileName(next, args.targetPlatform, args.targetArch)
    next.source.url = `https://github.com/ThinkInAIXYZ/deepchat/releases/download/${releaseTag(version)}/${assetName}`
  }
  return next
}

function isManifestTargetSupported(manifest, targetPlatform, targetArch) {
  const normalizedPlatform = String(targetPlatform).toLowerCase()
  const normalizedArch = String(targetArch).toLowerCase()
  const aliases =
    normalizedPlatform === 'darwin' ? ['darwin', 'macos', 'mac'] : [normalizedPlatform]
  const targets = manifest.engines?.targets ?? []
  if (targets.length > 0) {
    const supportedTargets = targets.map((target) => String(target).toLowerCase())
    return aliases.some((platform) => supportedTargets.includes(`${platform}/${normalizedArch}`))
  }

  const platforms = new Set(
    (manifest.engines?.platforms ?? []).map((platform) => String(platform).toLowerCase())
  )
  return aliases.some((platform) => platforms.has(platform))
}

function validateCuaRuntime(pluginDir, manifest, args) {
  if (manifest.id !== 'com.deepchat.plugins.cua') {
    return
  }
  const targetPlatform = args.targetPlatform ?? process.platform
  const key = targetKey(targetPlatform, args.targetArch)
  if (!isManifestTargetSupported(manifest, targetPlatform, args.targetArch)) {
    throw new Error(`CUA plugin does not support ${key}`)
  }

  const requiredByTarget = {
    [`darwin/${args.targetArch}`]: [
      `runtime/darwin/${args.targetArch}/${CUA_DARWIN_HELPER_APP}/Contents/MacOS/${CUA_DARWIN_HELPER_EXECUTABLE}`
    ],
    [`win32/${args.targetArch}`]: [
      `runtime/win32/${args.targetArch}/cua-driver.exe`,
      `runtime/win32/${args.targetArch}/cua-driver-uia.exe`
    ],
    [`linux/${args.targetArch}`]: [`runtime/linux/${args.targetArch}/cua-driver`]
  }
  const requiredFiles = requiredByTarget[key]
  if (!requiredFiles) {
    throw new Error(`CUA plugin has no runtime validation rule for ${key}`)
  }
  for (const relativePath of requiredFiles) {
    assertFile(pluginDir, relativePath, `CUA runtime binary ${key}`)
  }
  if (targetPlatform === 'darwin') {
    validateCuaDarwinRuntime(pluginDir, args.targetArch)
    if (manifest.runtime?.detect?.[0] !== CUA_DARWIN_MANAGED_HELPER_DETECT) {
      throw new Error(`CUA macOS runtime detect path must prefer ${CUA_DARWIN_MANAGED_HELPER_DETECT}`)
    }
  }

  const expectedDetect = [
    CUA_DARWIN_MANAGED_HELPER_DETECT,
    `plugin:runtime/darwin/${args.targetArch}/${CUA_DARWIN_HELPER_APP}/Contents/MacOS/${CUA_DARWIN_HELPER_EXECUTABLE}`,
    `plugin:runtime/win32/${args.targetArch}/cua-driver.exe`,
    `plugin:runtime/linux/${args.targetArch}/cua-driver`
  ]
  for (const detectPath of expectedDetect) {
    if (!manifest.runtime?.detect?.includes(detectPath)) {
      throw new Error(`CUA runtime detect paths must include ${detectPath}`)
    }
  }
  const forbiddenDetect = [
    `plugin:runtime/darwin/${args.targetArch}/CuaDriver.app/Contents/MacOS/cua-driver`,
    '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'
  ]
  for (const detectPath of forbiddenDetect) {
    if (manifest.runtime?.detect?.includes(detectPath)) {
      throw new Error(`CUA runtime detect paths must not include ${detectPath}`)
    }
  }

  const cuaServer = (manifest.mcpServers ?? []).find((server) => server.id === 'cua-driver')
  if (!cuaServer) {
    throw new Error('CUA plugin must declare the cua-driver MCP server')
  }
  if (cuaServer.command !== '${runtime.cua-driver.command}') {
    throw new Error('CUA MCP server command must reference ${runtime.cua-driver.command}')
  }
  const expectedArgs = ['mcp', '--no-daemon-relaunch']
  if (JSON.stringify(cuaServer.args ?? []) !== JSON.stringify(expectedArgs)) {
    throw new Error(`CUA MCP server args must be ${JSON.stringify(expectedArgs)}`)
  }
  const env = cuaServer.env ?? {}
  const requiredEnv = {
    CUA_DRIVER_MCP_MODE: '1',
    CUA_DRIVER_RS_MCP_NO_RELAUNCH: '1',
    DEEPCHAT_COMPUTER_USE_APP_PATH: '${runtime.cua-driver.helperAppPath}',
    DEEPCHAT_COMPUTER_USE_BINARY_PATH: '${runtime.cua-driver.command}'
  }
  for (const [key, expected] of Object.entries(requiredEnv)) {
    if (env[key] !== expected) {
      throw new Error(`CUA MCP server env ${key} must be ${expected}`)
    }
  }
}

function validateCuaDarwinRuntime(pluginDir, targetArch) {
  const helperRoot = `runtime/darwin/${targetArch}/${CUA_DARWIN_HELPER_APP}`
  const legacyExecutablePath = `runtime/darwin/${targetArch}/CuaDriver.app/Contents/MacOS/cua-driver`
  const legacyCodeResourcesPath = `${helperRoot}/Contents/CodeResources`
  if (fileExists(pluginDir, legacyExecutablePath)) {
    throw new Error(`CUA macOS runtime must not stage legacy helper path ${legacyExecutablePath}`)
  }
  if (fileExists(pluginDir, legacyCodeResourcesPath)) {
    throw new Error(`CUA macOS runtime must not stage legacy signature file ${legacyCodeResourcesPath}`)
  }

  const infoPlistPath = `${helperRoot}/Contents/Info.plist`
  const infoPlistFile = assertFile(pluginDir, infoPlistPath, `CUA macOS helper Info.plist ${targetArch}`)
  const infoPlist = fs.readFileSync(infoPlistFile, 'utf8')
  const bundleIdentifier = readPlistString(infoPlist, 'CFBundleIdentifier')
  if (bundleIdentifier !== CUA_DARWIN_HELPER_BUNDLE_ID) {
    throw new Error(
      `CUA macOS helper CFBundleIdentifier must be ${CUA_DARWIN_HELPER_BUNDLE_ID}`
    )
  }
  const executable = readPlistString(infoPlist, 'CFBundleExecutable')
  if (executable !== CUA_DARWIN_HELPER_EXECUTABLE) {
    throw new Error(`CUA macOS helper CFBundleExecutable must be ${CUA_DARWIN_HELPER_EXECUTABLE}`)
  }
}

function buildChecksums(files) {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filePath, content]) => [
        filePath,
        createHash('sha256').update(Buffer.from(content.content)).digest('hex')
      ])
  )
}

function createZipInput(files) {
  return Object.fromEntries(
    Object.entries(files).map(([filePath, file]) => {
      const mode = file.mode & 0o777
      if ((mode & 0o111) !== 0) {
        return [filePath, [file.content, { os: 3, attrs: mode << 16 }]]
      }
      return [filePath, file.content]
    })
  )
}

function packagePlugin(pluginDir, outDir, manifest, args) {
  const files = collectFiles(pluginDir, pluginDir, {}, manifest, args)
  files['plugin.json'] = {
    content: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
    mode: 0o644
  }
  files['checksums.json'] = {
    content: new TextEncoder().encode(`${JSON.stringify(buildChecksums(files), null, 2)}\n`),
    mode: 0o644
  }

  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, artifactFileName(manifest, args.targetPlatform, args.targetArch))
  fs.writeFileSync(outPath, Buffer.from(zipSync(createZipInput(files), { level: 6 })))
  return outPath
}

try {
  const args = parseArgs(process.argv.slice(2))
  const sourceManifest = readManifest(args.pluginDir)
  const manifest = createPackageManifest(sourceManifest, args)
  validateManifest(args.pluginDir, manifest)
  if (!isManifestTargetSupported(manifest, args.targetPlatform, args.targetArch)) {
    throw new Error(`Plugin ${manifest.id} does not support ${targetKey(args.targetPlatform, args.targetArch)}`)
  }
  validateCuaRuntime(args.pluginDir, manifest, args)
  if (args.validateOnly) {
    console.log(`Plugin ${manifest.id}@${manifest.version} is valid`)
  } else {
    const outPath = packagePlugin(args.pluginDir, args.outDir, manifest, args)
    console.log(`Packaged ${manifest.id}@${manifest.version}: ${outPath}`)
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
