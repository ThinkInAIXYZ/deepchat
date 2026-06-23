import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'
import { signMacHelperForRelease } from './sign-cua-helper.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = process.env.DEEPCHAT_ROOT_DIR
  ? path.resolve(process.env.DEEPCHAT_ROOT_DIR)
  : path.resolve(__dirname, '..')
const pluginDir = process.env.DEEPCHAT_CUA_PLUGIN_DIR
  ? path.resolve(process.env.DEEPCHAT_CUA_PLUGIN_DIR)
  : path.join(rootDir, 'plugins', 'cua')
const vendorRoot = process.env.DEEPCHAT_CUA_VENDOR_ROOT
  ? path.resolve(process.env.DEEPCHAT_CUA_VENDOR_ROOT)
  : path.join(pluginDir, 'vendor', 'cua-driver')
const upstreamMetadataPath = path.join(vendorRoot, 'upstream.json')
const helperBinaryName = 'cua-driver'
const upstreamDarwinHelperAppDirName = 'CuaDriver.app'
export const darwinHelperAppDirName = 'DeepChat Computer Use.app'
export const darwinHelperBinaryName = 'deepchat-cua-driver'
export const darwinHelperBundleIdentifier = 'com.deepchat.computeruse.helper'
const darwinHelperBundleName = 'DeepChat Computer Use'

const targetAssetKeys = {
  'darwin/arm64': 'darwin-arm64',
  'darwin/x64': 'darwin-x64',
  'win32/x64': 'windows-x64',
  'win32/arm64': 'windows-arm64',
  'linux/x64': 'linux-x64'
}

const executableByTarget = {
  darwin: path.join(darwinHelperAppDirName, 'Contents', 'MacOS', darwinHelperBinaryName),
  win32: `${helperBinaryName}.exe`,
  linux: helperBinaryName
}

function parseArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      continue
    }
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      args.set(key, next)
      index += 1
    } else {
      args.set(key, 'true')
    }
  }
  return args
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`)
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options
  })
}

function read(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim()
}

function ensureTool(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' })
  if (result.error) {
    throw new Error(`Required tool is missing: ${command}`)
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function readUpstreamMetadata() {
  let metadata
  try {
    metadata = JSON.parse(await fs.readFile(upstreamMetadataPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `Unable to read CUA upstream metadata at ${path.relative(rootDir, upstreamMetadataPath)}: ${error instanceof Error ? error.message : error}`
    )
  }

  const requiredFields = [
    'sourceKind',
    'upstreamRepo',
    'tag',
    'commit',
    'version',
    'updatedAt',
    'releaseUrl',
    'checksumsAsset'
  ]
  for (const field of requiredFields) {
    if (typeof metadata[field] !== 'string' || metadata[field].length === 0) {
      throw new Error(`CUA upstream metadata is missing required string field: ${field}`)
    }
  }
  if (metadata.sourceKind !== 'upstream-release') {
    throw new Error(`CUA vendor sourceKind must be upstream-release, got ${metadata.sourceKind}`)
  }
  if (!metadata.assets || typeof metadata.assets !== 'object') {
    throw new Error('CUA upstream metadata must declare release assets')
  }
  return metadata
}

function getTarget(platform, arch, metadata) {
  const target = `${platform}/${arch}`
  const assetKey = targetAssetKeys[target]
  if (!assetKey) {
    const unsupported = metadata.unsupportedTargets ?? []
    const reason = unsupported.includes(target) ? 'unsupported' : 'unknown'
    throw new Error(`CUA plugin runtime target ${target} is ${reason}`)
  }

  const asset = metadata.assets[assetKey]
  if (!asset || typeof asset.name !== 'string') {
    throw new Error(`CUA upstream metadata is missing asset mapping for ${target}`)
  }

  return {
    target,
    assetKey,
    assetName: asset.name
  }
}

function downloadUrl(metadata, assetName) {
  return `https://github.com/trycua/cua/releases/download/${metadata.tag}/${assetName}`
}

async function downloadFile(url, outputPath) {
  if (await pathExists(outputPath)) {
    return
  }

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, buffer)
  } catch (error) {
    await fs.rm(outputPath, { force: true })
    throw error
  }
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  hash.update(await fs.readFile(filePath))
  return hash.digest('hex')
}

function parseChecksums(contents) {
  const checksums = new Map()
  for (const line of contents.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+(.+)$/i)
    if (match) {
      checksums.set(match[2].trim(), match[1].toLowerCase())
    }
  }
  return checksums
}

async function verifyChecksum(checksumsPath, assetPath, assetName) {
  const checksums = parseChecksums(await fs.readFile(checksumsPath, 'utf8'))
  const expected = checksums.get(assetName)
  if (!expected) {
    await fs.rm(checksumsPath, { force: true })
    throw new Error(`checksums.txt does not contain ${assetName}`)
  }
  const actual = await sha256File(assetPath)
  if (actual !== expected) {
    await fs.rm(assetPath, { force: true })
    throw new Error(`Checksum mismatch for ${assetName}. Expected ${expected}, got ${actual}`)
  }
}

async function extractArchive(archivePath, outputDir) {
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })
  if (archivePath.endsWith('.zip')) {
    const files = unzipSync(new Uint8Array(await fs.readFile(archivePath)))
    for (const [relativePath, content] of Object.entries(files)) {
      if (relativePath.endsWith('/')) {
        continue
      }
      const normalized = relativePath.replace(/\\/g, '/')
      if (normalized.startsWith('/') || normalized.includes('..') || /^[A-Za-z]:/.test(normalized)) {
        throw new Error(`Unsafe CUA release archive path: ${relativePath}`)
      }
      const outputPath = path.resolve(outputDir, ...normalized.split('/').filter(Boolean))
      const relativeToRoot = path.relative(outputDir, outputPath)
      if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
        throw new Error(`CUA release archive path escapes extraction root: ${relativePath}`)
      }
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, Buffer.from(content))
    }
    return
  }

  ensureTool('tar', ['--version'])
  run('tar', ['-xzf', archivePath, '-C', outputDir])
}

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

async function findFirst(root, predicate) {
  const files = await collectFiles(root)
  return files.find(predicate)
}

async function findDirectory(root, directoryName) {
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory() && entry.name === directoryName) {
      return entryPath
    }
    if (entry.isDirectory()) {
      const nested = await findDirectory(entryPath, directoryName)
      if (nested) {
        return nested
      }
    }
  }
  return undefined
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function upsertPlistString(contents, key, value) {
  const escapedKey = escapeRegExp(key)
  const nextEntry = `    <key>${key}</key>\n    <string>${escapeXml(value)}</string>`
  const existingPattern = new RegExp(`(<key>${escapedKey}</key>\\s*)<string>[^<]*</string>`)
  if (existingPattern.test(contents)) {
    return contents.replace(existingPattern, `$1<string>${escapeXml(value)}</string>`)
  }

  const dictCloseIndex = contents.lastIndexOf('</dict>')
  if (dictCloseIndex === -1) {
    throw new Error(`CUA macOS helper Info.plist is missing </dict>`)
  }
  return `${contents.slice(0, dictCloseIndex)}${nextEntry}\n${contents.slice(dictCloseIndex)}`
}

export async function rewriteDarwinHelperInfoPlist(appPath) {
  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist')
  let contents = await fs.readFile(infoPlistPath, 'utf8')
  contents = upsertPlistString(contents, 'CFBundleIdentifier', darwinHelperBundleIdentifier)
  contents = upsertPlistString(contents, 'CFBundleName', darwinHelperBundleName)
  contents = upsertPlistString(contents, 'CFBundleDisplayName', darwinHelperBundleName)
  contents = upsertPlistString(contents, 'CFBundleExecutable', darwinHelperBinaryName)
  await fs.writeFile(infoPlistPath, contents)
}

async function renameDarwinHelperExecutable(appPath) {
  const macOsDir = path.join(appPath, 'Contents', 'MacOS')
  const upstreamExecutable = path.join(macOsDir, helperBinaryName)
  const deepchatExecutable = path.join(macOsDir, darwinHelperBinaryName)
  if (await pathExists(deepchatExecutable)) {
    await fs.rm(upstreamExecutable, { force: true })
    return
  }
  if (!(await pathExists(upstreamExecutable))) {
    throw new Error(`CUA macOS archive is missing ${helperBinaryName}`)
  }
  await fs.rename(upstreamExecutable, deepchatExecutable)
}

export async function normalizeDarwinHelperBundle(appPath) {
  await renameDarwinHelperExecutable(appPath)
  await rewriteDarwinHelperInfoPlist(appPath)
  await fs.rm(path.join(appPath, 'Contents', '_CodeSignature'), { recursive: true, force: true })
  await fs.rm(path.join(appPath, 'Contents', 'CodeResources'), { force: true })
}

export async function stageDarwinRuntime(extractDir, runtimeDir) {
  const sourceApp = await findDirectory(extractDir, upstreamDarwinHelperAppDirName)
  if (!sourceApp) {
    throw new Error(`CUA macOS archive is missing ${upstreamDarwinHelperAppDirName}`)
  }
  const targetApp = path.join(runtimeDir, darwinHelperAppDirName)
  await fs.cp(sourceApp, targetApp, {
    recursive: true,
    force: true
  })
  await normalizeDarwinHelperBundle(targetApp)
}

async function stageWindowsRuntime(extractDir, runtimeDir) {
  const driver = await findFirst(extractDir, (file) => path.basename(file) === 'cua-driver.exe')
  const uia = await findFirst(extractDir, (file) => path.basename(file) === 'cua-driver-uia.exe')
  if (!driver || !uia) {
    throw new Error('CUA Windows archive must contain cua-driver.exe and cua-driver-uia.exe')
  }
  await fs.copyFile(driver, path.join(runtimeDir, 'cua-driver.exe'))
  await fs.copyFile(uia, path.join(runtimeDir, 'cua-driver-uia.exe'))
}

async function stageLinuxRuntime(extractDir, runtimeDir) {
  const driver = await findFirst(
    extractDir,
    (file) => path.basename(file) === 'cua-driver' && !file.endsWith('.exe')
  )
  if (!driver) {
    throw new Error('CUA Linux archive is missing cua-driver')
  }
  const target = path.join(runtimeDir, 'cua-driver')
  await fs.copyFile(driver, target)
  await fs.chmod(target, 0o755)
}

async function stageRuntime(targetPlatform, targetArch, extractDir) {
  const runtimeDir = path.join(pluginDir, 'runtime', targetPlatform, targetArch)
  await fs.rm(runtimeDir, { recursive: true, force: true })
  await fs.mkdir(runtimeDir, { recursive: true })

  if (targetPlatform === 'darwin') {
    await stageDarwinRuntime(extractDir, runtimeDir)
  } else if (targetPlatform === 'win32') {
    await stageWindowsRuntime(extractDir, runtimeDir)
  } else if (targetPlatform === 'linux') {
    await stageLinuxRuntime(extractDir, runtimeDir)
  } else {
    throw new Error(`Unsupported CUA runtime platform: ${targetPlatform}`)
  }

  const executable = path.join(runtimeDir, executableByTarget[targetPlatform])
  if (!(await pathExists(executable))) {
    throw new Error(`Staged CUA runtime is missing executable: ${executable}`)
  }
  if (targetPlatform !== 'win32') {
    await fs.chmod(executable, 0o755)
  }
  return { runtimeDir, executable }
}

function canRunTarget(targetPlatform, targetArch) {
  return process.platform === targetPlatform && process.arch === targetArch
}

function isLinuxGlibcLoaderMismatch(output) {
  return /libc\.so\.6/.test(output) && /GLIBC_\d+\.\d+/.test(output) && /not found/.test(output)
}

function smokeCheck(executable, targetPlatform, targetArch) {
  if (!canRunTarget(targetPlatform, targetArch)) {
    console.log(`Skipping CUA runtime smoke check for non-host target ${targetPlatform}/${targetArch}`)
    return
  }

  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    const output = `${result.stderr || ''}${result.stdout || ''}`
    if (targetPlatform === 'linux' && isLinuxGlibcLoaderMismatch(output)) {
      console.warn(
        `Skipping CUA runtime smoke check because the host glibc loader cannot execute ${targetPlatform}/${targetArch}: ${output.trim()}`
      )
      return
    }
    throw new Error(
      `CUA runtime smoke check failed with exit code ${result.status}: ${result.stderr || result.stdout}`
    )
  }
  console.log((result.stdout || result.stderr).trim())
}

function validateDarwinArchitecture(executable, targetPlatform, targetArch) {
  if (targetPlatform !== 'darwin' || process.platform !== 'darwin') {
    return
  }
  ensureTool('/usr/bin/lipo', ['-info', process.execPath])
  const expected = targetArch === 'x64' ? 'x86_64' : targetArch
  const archs = read('/usr/bin/lipo', ['-archs', executable]).split(/\s+/).filter(Boolean)
  if (!archs.includes(expected)) {
    throw new Error(`Helper arch mismatch. Expected ${expected}, got ${archs.join(', ')}`)
  }
}

async function signDarwinHelper(runtimeDir, targetPlatform) {
  if (targetPlatform !== 'darwin' || process.platform !== 'darwin') {
    return
  }
  ensureTool('codesign', ['--version'])
  const helperAppPath = path.join(runtimeDir, darwinHelperAppDirName)
  const entitlementsPath = path.join(pluginDir, 'build', 'entitlements.plist')
  const signedForRelease = await signMacHelperForRelease({
    appPath: helperAppPath,
    entitlementsPath,
    cwd: rootDir
  })
  if (!signedForRelease) {
    run('codesign', [
      '--force',
      '--deep',
      '--sign',
      '-',
      '--entitlements',
      entitlementsPath,
      '--options',
      'runtime',
      '--timestamp=none',
      helperAppPath
    ])
  }
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', helperAppPath])
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const targetPlatform = String(
    args.get('platform') ?? process.env.TARGET_PLATFORM ?? process.platform
  ).toLowerCase()
  const targetArch = String(
    args.get('arch') ?? process.env.TARGET_ARCH ?? process.arch
  ).toLowerCase()
  const metadata = await readUpstreamMetadata()
  const target = getTarget(targetPlatform, targetArch, metadata)
  const cacheDir = process.env.DEEPCHAT_CUA_DOWNLOAD_CACHE
    ? path.resolve(process.env.DEEPCHAT_CUA_DOWNLOAD_CACHE)
    : path.join(os.tmpdir(), 'deepchat-cua-driver-cache', metadata.tag)
  const workRoot = path.join(
    os.tmpdir(),
    'deepchat-cua-plugin-build',
    `${metadata.tag}-${targetPlatform}-${targetArch}-${process.pid}`
  )
  const extractDir = path.join(workRoot, 'extract')
  const assetPath = path.join(cacheDir, target.assetName)
  const checksumsPath = path.join(cacheDir, metadata.checksumsAsset)

  await downloadFile(downloadUrl(metadata, metadata.checksumsAsset), checksumsPath)
  await downloadFile(downloadUrl(metadata, target.assetName), assetPath)
  await verifyChecksum(checksumsPath, assetPath, target.assetName)
  await extractArchive(assetPath, extractDir)

  const { runtimeDir, executable } = await stageRuntime(targetPlatform, targetArch, extractDir)
  validateDarwinArchitecture(executable, targetPlatform, targetArch)
  await signDarwinHelper(runtimeDir, targetPlatform)
  smokeCheck(executable, targetPlatform, targetArch)

  const relativeRuntimePath = path.relative(rootDir, runtimeDir)
  const stat = await fs.stat(executable)
  if (!fsSync.existsSync(executable) || stat.size === 0) {
    throw new Error('Staged CUA runtime is invalid')
  }

  await fs.rm(workRoot, { recursive: true, force: true })
  console.log(`CUA Driver ${metadata.tag} staged at ${relativeRuntimePath}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
