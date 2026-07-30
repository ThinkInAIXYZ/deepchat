import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'
import { readCuaToolCatalog } from './cua-tool-catalog-contract.mjs'
import { CUA_DARWIN_ALLOWED_ENTITLEMENTS } from './cua-macos-contract.mjs'

const OFFICIAL_PLUGIN_SOURCE = 'deepchat-official'
const CUA_DARWIN_HELPER_APP = 'DeepChat Computer Use.app'
const CUA_DARWIN_HELPER_EXECUTABLE = 'deepchat-cua-driver'
const CUA_DARWIN_HELPER_BUNDLE_ID = 'com.deepchat.computeruse.helper'
const CUA_DARWIN_MANAGED_HELPER_DETECT = `app-helper:${CUA_DARWIN_HELPER_APP}/Contents/MacOS/${CUA_DARWIN_HELPER_EXECUTABLE}`
const CUA_PLUGIN_ID = 'com.deepchat.plugins.cua'
const CUA_INTEGRITY_DESCRIPTOR_NAME = 'integrity.json'
const CUA_EMBEDDED_ADAPTER_CONTRACT = Object.freeze({
  hostBundleId: 'com.wefonk.deepchat',
  driverVersion: '0.14.1',
  contractVersion: '0.2.0',
  toolsListSchemaVersion: '1',
  capabilityVersion: '1',
  mcpProtocolVersion: '2025-06-18'
})
const CUA_PLATFORM_SPECIFIC_TOOL_PLATFORMS = Object.freeze({
  debug_window_info: Object.freeze(['win32']),
  mouse_button_down: Object.freeze(['linux']),
  mouse_button_up: Object.freeze(['linux']),
  mouse_drag: Object.freeze(['linux']),
  parallel_mouse_drag: Object.freeze(['linux'])
})

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function flatRecordEquals(actual, expected) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    return false
  }
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every(
      (key, index) => key === expectedKeys[index] && actual[key] === expected[key]
    )
  )
}

function parseArgs(argv) {
  const environmentPurpose = process.env.PACKAGE_PURPOSE || null
  const args = {
    validateOnly: false,
    outDir: path.resolve('dist', 'plugins'),
    pluginDir: null,
    releaseVersionFromRoot: false,
    version: null,
    targetPlatform: process.env.TARGET_PLATFORM ?? process.platform,
    targetArch: process.env.TARGET_ARCH ?? process.arch,
    purpose: environmentPurpose
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
    if (arg === '--purpose') {
      args.purpose = argv[index + 1] || ''
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
  if (
    args.purpose !== null &&
    !['distribution', 'verification'].includes(args.purpose)
  ) {
    throw new Error(`Invalid package purpose: ${args.purpose || '<empty>'}`)
  }
  if (environmentPurpose && args.purpose !== environmentPurpose) {
    throw new Error(
      `Package purpose mismatch: argument=${args.purpose}, PACKAGE_PURPOSE=${environmentPurpose}`
    )
  }
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

function scopeCuaToolPolicyToTarget(pluginDir, manifest, args) {
  if (manifest.id !== CUA_PLUGIN_ID) {
    return
  }

  const policies = (manifest.toolPolicies ?? []).filter(
    (policy) => policy.serverId === 'cua-driver'
  )
  if (
    policies.length !== 1 ||
    !policies[0].tools ||
    typeof policies[0].tools !== 'object' ||
    Array.isArray(policies[0].tools)
  ) {
    throw new Error('CUA must declare exactly one cua-driver tool policy')
  }
  const policy = policies[0]
  for (const [toolName, decision] of Object.entries(policy.tools)) {
    if (!['allow', 'ask', 'deny'].includes(decision)) {
      throw new Error(`CUA tool policy ${toolName} has invalid decision: ${decision}`)
    }
  }

  const cuaServer = (manifest.mcpServers ?? []).find((server) => server.id === 'cua-driver')
  if (!cuaServer?.toolCatalog) {
    throw new Error('CUA plugin must declare a target-specific tool catalog')
  }
  const catalogFile = assertFile(
    pluginDir,
    cuaServer.toolCatalog,
    `CUA MCP tool catalog ${targetKey(args.targetPlatform, args.targetArch)}`
  )
  const catalog = readCuaToolCatalog(catalogFile)
  const catalogNames = catalog.tools.map((tool) => tool.name)
  const catalogNameSet = new Set(catalogNames)
  const policyNames = Object.keys(policy.tools)
  const policyNameSet = new Set(policyNames)
  const missing = catalogNames.filter((name) => !policyNameSet.has(name))
  const invalidPlatformTools = catalogNames.filter((name) => {
    const platforms = Object.hasOwn(CUA_PLATFORM_SPECIFIC_TOOL_PLATFORMS, name)
      ? CUA_PLATFORM_SPECIFIC_TOOL_PLATFORMS[name]
      : undefined
    return platforms && !platforms.includes(args.targetPlatform)
  })
  const invalidExtra = policyNames.filter((name) => {
    if (catalogNameSet.has(name)) {
      return false
    }
    const platforms = Object.hasOwn(CUA_PLATFORM_SPECIFIC_TOOL_PLATFORMS, name)
      ? CUA_PLATFORM_SPECIFIC_TOOL_PLATFORMS[name]
      : undefined
    return !platforms || platforms.includes(args.targetPlatform)
  })
  if (missing.length > 0 || invalidPlatformTools.length > 0 || invalidExtra.length > 0) {
    const extra = [...new Set([...invalidPlatformTools, ...invalidExtra])].sort()
    throw new Error(
      `CUA tool policy/catalog mismatch (missing: ${missing.sort().join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`
    )
  }

  policy.tools = Object.fromEntries(
    catalogNames.map((toolName) => [toolName, policy.tools[toolName]])
  )
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
  if (manifest.id !== CUA_PLUGIN_ID) {
    return
  }
  const targetPlatform = args.targetPlatform ?? process.platform
  const key = targetKey(targetPlatform, args.targetArch)
  if (!isManifestTargetSupported(manifest, targetPlatform, args.targetArch)) {
    throw new Error(`CUA plugin does not support ${key}`)
  }

  const requiredByTarget = {
    [`darwin/${args.targetArch}`]: [
      `runtime/darwin/${args.targetArch}/${CUA_DARWIN_HELPER_APP}/Contents/MacOS/${CUA_DARWIN_HELPER_EXECUTABLE}`,
      `runtime/darwin/${args.targetArch}/tool-catalog.json`
    ],
    [`win32/${args.targetArch}`]: [
      `runtime/win32/${args.targetArch}/cua-driver.exe`,
      `runtime/win32/${args.targetArch}/tool-catalog.json`
    ],
    [`linux/${args.targetArch}`]: [
      `runtime/linux/${args.targetArch}/cua-driver`,
      `runtime/linux/${args.targetArch}/tool-catalog.json`
    ]
  }
  const requiredFiles = requiredByTarget[key]
  if (!requiredFiles) {
    throw new Error(`CUA plugin has no runtime validation rule for ${key}`)
  }
  for (const relativePath of requiredFiles) {
    assertFile(pluginDir, relativePath, `CUA runtime binary ${key}`)
  }
  if (
    targetPlatform === 'win32' &&
    fileExists(pluginDir, `runtime/win32/${args.targetArch}/cua-driver-uia.exe`)
  ) {
    throw new Error(`CUA Windows runtime ${key} must not bundle cua-driver-uia.exe`)
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
  if (manifest.runtime?.adapter !== 'cua-embedded-v1') {
    throw new Error('CUA runtime must use the cua-embedded-v1 adapter')
  }
  const expectedIntegrityDescriptor = `runtime/${targetPlatform}/${args.targetArch}/${CUA_INTEGRITY_DESCRIPTOR_NAME}`
  if (manifest.runtime.integrityDescriptor !== expectedIntegrityDescriptor) {
    throw new Error(`CUA runtime integrityDescriptor must be ${expectedIntegrityDescriptor}`)
  }
  if (!flatRecordEquals(manifest.runtime.adapterContract, CUA_EMBEDDED_ADAPTER_CONTRACT)) {
    throw new Error(
      `CUA runtime adapter contract must be ${JSON.stringify(CUA_EMBEDDED_ADAPTER_CONTRACT)}`
    )
  }
  const expectedArgs = ['mcp', '--embedded']
  if (JSON.stringify(cuaServer.args ?? []) !== JSON.stringify(expectedArgs)) {
    throw new Error(`CUA MCP server args must be ${JSON.stringify(expectedArgs)}`)
  }
  if (
    cuaServer.startMode !== 'onDemand' ||
    JSON.stringify(cuaServer.surfaces) !== JSON.stringify(['tools']) ||
    cuaServer.inheritEnv !== 'minimal'
  ) {
    throw new Error(
      'CUA MCP server must be on-demand, tools-only, and use minimal environment inheritance'
    )
  }
  const expectedCatalogPath = `runtime/${targetPlatform}/${args.targetArch}/tool-catalog.json`
  if (cuaServer.toolCatalog !== expectedCatalogPath) {
    throw new Error(`CUA MCP server toolCatalog must be ${expectedCatalogPath}`)
  }
  const env = cuaServer.env ?? {}
  if (!flatRecordEquals(env, {})) {
    throw new Error('CUA MCP server must not declare environment overrides')
  }

  const catalogFile = assertFile(pluginDir, expectedCatalogPath, `CUA MCP tool catalog ${key}`)
  const catalog = readCuaToolCatalog(catalogFile)
  if (catalog.version !== CUA_EMBEDDED_ADAPTER_CONTRACT.driverVersion) {
    throw new Error(
      `CUA MCP tool catalog version must be ${CUA_EMBEDDED_ADAPTER_CONTRACT.driverVersion}`
    )
  }
  validateCuaToolPolicies(manifest, catalog)
}

function validateCuaToolPolicies(manifest, catalog) {
  const policies = (manifest.toolPolicies ?? []).filter(
    (policy) => policy.serverId === 'cua-driver'
  )
  if (policies.length !== 1 || !policies[0].tools || typeof policies[0].tools !== 'object') {
    throw new Error('CUA must declare exactly one cua-driver tool policy')
  }
  const catalogNames = catalog.tools.map((tool) => tool.name).sort()
  const policyNames = Object.keys(policies[0].tools).sort()
  if (JSON.stringify(policyNames) !== JSON.stringify(catalogNames)) {
    const missing = catalogNames.filter((name) => !policyNames.includes(name))
    const extra = policyNames.filter((name) => !catalogNames.includes(name))
    throw new Error(
      `CUA tool policy/catalog mismatch (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`
    )
  }
  for (const [toolName, decision] of Object.entries(policies[0].tools)) {
    if (!['allow', 'ask', 'deny'].includes(decision)) {
      throw new Error(`CUA tool policy ${toolName} has invalid decision: ${decision}`)
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

function createDarwinSigningContract(purpose) {
  const distribution = purpose === 'distribution'
  const teamId = distribution ? String(process.env.DEEPCHAT_APPLE_NOTARY_TEAM_ID ?? '') : null
  if (distribution && !/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error('CUA macOS distribution integrity descriptor requires a valid Apple Team ID')
  }
  return {
    bundlePath: CUA_DARWIN_HELPER_APP,
    bundleIdentifier: CUA_DARWIN_HELPER_BUNDLE_ID,
    signatureType: distribution ? 'developer-id' : 'ad-hoc',
    teamId,
    hardenedRuntime: true,
    entitlements: { ...CUA_DARWIN_ALLOWED_ENTITLEMENTS }
  }
}

function isPackagedExecutable(relativePath, file, targetPlatform) {
  if (targetPlatform === 'win32') {
    return ['.bat', '.cmd', '.com', '.exe', '.ps1'].includes(
      path.posix.extname(relativePath).toLowerCase()
    )
  }
  return (file.mode & 0o111) !== 0
}

export function createCuaRuntimeIntegrityDescriptor(files, manifest, args) {
  const runtimeRoot = `runtime/${args.targetPlatform}/${args.targetArch}`
  const runtimePrefix = `${runtimeRoot}/`
  const targetFiles = Object.entries(files)
    .filter(
      ([filePath]) =>
        filePath.startsWith(runtimePrefix) &&
        filePath !== `${runtimeRoot}/${CUA_INTEGRITY_DESCRIPTOR_NAME}`
    )
    .map(([filePath, file]) => [filePath.slice(runtimePrefix.length), file])
    .sort(([left], [right]) => left.localeCompare(right))
  if (targetFiles.length === 0) {
    throw new Error(`CUA runtime integrity cannot describe an empty target: ${runtimeRoot}`)
  }

  const binaryPath =
    args.targetPlatform === 'darwin'
      ? `${CUA_DARWIN_HELPER_APP}/Contents/MacOS/${CUA_DARWIN_HELPER_EXECUTABLE}`
      : args.targetPlatform === 'win32'
        ? 'cua-driver.exe'
        : 'cua-driver'
  const catalogPath = 'tool-catalog.json'
  const fileHashes = Object.fromEntries(
    targetFiles.map(([filePath, file]) => [
      filePath,
      createHash('sha256').update(Buffer.from(file.content)).digest('hex')
    ])
  )
  for (const requiredPath of [binaryPath, catalogPath]) {
    if (!fileHashes[requiredPath]) {
      throw new Error(`CUA runtime integrity is missing required artifact: ${requiredPath}`)
    }
  }
  const executablePaths = targetFiles
    .filter(([filePath, file]) => isPackagedExecutable(filePath, file, args.targetPlatform))
    .map(([filePath]) => filePath)
  if (executablePaths.length !== 1 || executablePaths[0] !== binaryPath) {
    throw new Error(
      `CUA runtime integrity requires exactly one executable (${binaryPath}), received ${executablePaths.join(', ') || 'none'}`
    )
  }

  return {
    schemaVersion: 1,
    pluginId: manifest.id,
    runtimeId: manifest.runtime.id,
    runtimeVersion: manifest.runtime.adapterContract.driverVersion,
    target: `${args.targetPlatform}/${args.targetArch}`,
    runtimeRoot,
    binaryPath,
    catalogPath,
    files: fileHashes,
    executablePaths,
    ...(args.targetPlatform === 'darwin'
      ? {
          macos: createDarwinSigningContract(args.purpose)
        }
      : {})
  }
}

function packagePlugin(pluginDir, outDir, manifest, args) {
  const files = collectFiles(pluginDir, pluginDir, {}, manifest, args)
  files['plugin.json'] = {
    content: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
    mode: 0o644
  }
  if (manifest.id === CUA_PLUGIN_ID) {
    const policy = manifest.toolPolicies.find((item) => item.serverId === 'cua-driver')
    files['policies/tool-policy.json'] = {
      content: new TextEncoder().encode(`${JSON.stringify(policy, null, 2)}\n`),
      mode: files['policies/tool-policy.json']?.mode ?? 0o644
    }
    const descriptor = createCuaRuntimeIntegrityDescriptor(files, manifest, {
      ...args,
      pluginDir
    })
    files[manifest.runtime.integrityDescriptor] = {
      content: new TextEncoder().encode(`${JSON.stringify(descriptor, null, 2)}\n`),
      mode: 0o644
    }
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
  scopeCuaToolPolicyToTarget(args.pluginDir, manifest, args)
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
