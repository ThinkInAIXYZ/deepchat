import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'

const OFFICIAL_PLUGIN_SOURCE = 'deepchat-official'

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
    targetPlatform: process.env.TARGET_PLATFORM ?? null,
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
  if (parts[0] === 'runtime' && parts[1] === 'darwin' && parts[2]) {
    return parts[2] !== args.targetArch
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

    files[relativePath] = new Uint8Array(fs.readFileSync(absolutePath))
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
  if (next.source?.type === OFFICIAL_PLUGIN_SOURCE) {
    const assetName = artifactFileName(next, args.targetPlatform, args.targetArch)
    next.source.url = `https://github.com/ThinkInAIXYZ/deepchat/releases/download/${releaseTag(version)}/${assetName}`
  }
  return next
}

function validateCuaRuntime(pluginDir, manifest, args) {
  if (manifest.id !== 'com.deepchat.plugins.cua') {
    return
  }
  const targetPlatform = args.targetPlatform ?? 'darwin'
  if (targetPlatform !== 'darwin') {
    throw new Error('CUA plugin packaging currently supports darwin runtime packages only')
  }
  assertFile(
    pluginDir,
    `runtime/darwin/${args.targetArch}/DeepChat Computer Use.app/Contents/MacOS/cua-driver`,
    `CUA runtime binary ${targetPlatform}/${args.targetArch}`
  )
  const expectedDetect = [
    `plugin:runtime/darwin/${args.targetArch}/DeepChat Computer Use.app/Contents/MacOS/cua-driver`,
    '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'
  ]
  if (JSON.stringify(manifest.runtime?.detect ?? []) !== JSON.stringify(expectedDetect)) {
    throw new Error('CUA runtime detect paths must point to the bundled helper app first')
  }

  const cuaServer = (manifest.mcpServers ?? []).find((server) => server.id === 'cua-driver')
  if (!cuaServer) {
    throw new Error('CUA plugin must declare the cua-driver MCP server')
  }
  if (cuaServer.command !== '${runtime.cua-driver.command}') {
    throw new Error('CUA MCP server command must reference ${runtime.cua-driver.command}')
  }
  const env = cuaServer.env ?? {}
  const requiredEnv = {
    CUA_DRIVER_MCP_MODE: '1',
    DEEPCHAT_COMPUTER_USE_APP_PATH: '${runtime.cua-driver.helperAppPath}',
    DEEPCHAT_COMPUTER_USE_BINARY_PATH: '${runtime.cua-driver.command}'
  }
  for (const [key, expected] of Object.entries(requiredEnv)) {
    if (env[key] !== expected) {
      throw new Error(`CUA MCP server env ${key} must be ${expected}`)
    }
  }
}

function buildChecksums(files) {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filePath, content]) => [
        filePath,
        createHash('sha256').update(Buffer.from(content)).digest('hex')
      ])
  )
}

function packagePlugin(pluginDir, outDir, manifest, args) {
  const files = collectFiles(pluginDir, pluginDir, {}, manifest, args)
  files['plugin.json'] = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
  files['checksums.json'] = new TextEncoder().encode(
    `${JSON.stringify(buildChecksums(files), null, 2)}\n`
  )

  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, artifactFileName(manifest, args.targetPlatform, args.targetArch))
  fs.writeFileSync(outPath, Buffer.from(zipSync(files, { level: 6 })))
  return outPath
}

try {
  const args = parseArgs(process.argv.slice(2))
  const sourceManifest = readManifest(args.pluginDir)
  const manifest = createPackageManifest(sourceManifest, args)
  validateManifest(args.pluginDir, manifest)
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
