import fs from 'node:fs/promises'
import path from 'node:path'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'

const LINUX_APP_NAME = 'deepchat'
const VSS_EXTENSION_NAME = 'vss.duckdb_extension'
const gzipAsync = promisify(gzip)
const ARCH_NAMES = new Map([
  [0, 'ia32'],
  [1, 'x64'],
  [2, 'armv7l'],
  [3, 'arm64'],
  [4, 'universal']
])

function getArchName(arch) {
  return typeof arch === 'string' ? arch : ARCH_NAMES.get(arch)
}

function getFffBinaryPackages(platform, arch) {
  const archName = getArchName(arch)

  if (platform === 'darwin' && archName === 'universal') {
    return ['@ff-labs/fff-bin-darwin-x64', '@ff-labs/fff-bin-darwin-arm64']
  }

  switch (`${platform}:${archName}`) {
    case 'darwin:x64':
      return ['@ff-labs/fff-bin-darwin-x64']
    case 'darwin:arm64':
      return ['@ff-labs/fff-bin-darwin-arm64']
    case 'win32:x64':
      return ['@ff-labs/fff-bin-win32-x64']
    case 'win32:arm64':
      return ['@ff-labs/fff-bin-win32-arm64']
    case 'linux:x64':
      return ['@ff-labs/fff-bin-linux-x64-gnu']
    case 'linux:arm64':
      return ['@ff-labs/fff-bin-linux-arm64-gnu']
    default:
      return []
  }
}

function getParcelWatcherBinaryPackages(platform, arch) {
  const archName = getArchName(arch)

  if (platform === 'darwin' && archName === 'universal') {
    return ['@parcel/watcher-darwin-x64', '@parcel/watcher-darwin-arm64']
  }

  switch (`${platform}:${archName}`) {
    case 'darwin:x64':
      return ['@parcel/watcher-darwin-x64']
    case 'darwin:arm64':
      return ['@parcel/watcher-darwin-arm64']
    case 'win32:x64':
      return ['@parcel/watcher-win32-x64']
    case 'win32:arm64':
      return ['@parcel/watcher-win32-arm64']
    case 'win32:ia32':
      return ['@parcel/watcher-win32-ia32']
    case 'linux:x64':
      return ['@parcel/watcher-linux-x64-glibc']
    case 'linux:arm64':
      return ['@parcel/watcher-linux-arm64-glibc']
    case 'linux:armv7l':
      return ['@parcel/watcher-linux-arm-glibc']
    default:
      return []
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function resolveInstalledPackageDir(projectDir, packageName) {
  const packagePathParts = packageName.split('/')
  const candidates = [
    path.join(projectDir, 'node_modules', ...packagePathParts),
    path.join(projectDir, 'node_modules', '.pnpm', 'node_modules', ...packagePathParts)
  ]

  const pnpmVirtualStoreDir = path.join(projectDir, 'node_modules', '.pnpm')
  try {
    const virtualStoreEntries = await fs.readdir(pnpmVirtualStoreDir, { withFileTypes: true })
    for (const entry of virtualStoreEntries) {
      if (entry.isDirectory()) {
        candidates.push(path.join(pnpmVirtualStoreDir, entry.name, 'node_modules', ...packagePathParts))
      }
    }
  } catch {
    // Non-pnpm installs only need the direct node_modules candidates above.
  }

  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, 'package.json'))) {
      return fs.realpath(candidate)
    }
  }

  throw new Error(`Unable to find installed native package: ${packageName}`)
}

function getResourcesDir(context) {
  const { appOutDir, electronPlatformName, packager } = context

  if (electronPlatformName === 'darwin') {
    const productFilename = packager?.appInfo?.productFilename ?? 'DeepChat'
    return path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
  }

  return path.join(appOutDir, 'resources')
}

async function copyFffNativePackages(context) {
  const { arch, electronPlatformName, packager } = context
  const packageNames = getFffBinaryPackages(electronPlatformName, arch)

  if (packageNames.length === 0) {
    return
  }

  const nodeModulesDir = path.join(getResourcesDir(context), 'app.asar.unpacked', 'node_modules')
  const fffNodeDir = path.join(nodeModulesDir, '@ff-labs', 'fff-node')

  if (!(await pathExists(fffNodeDir))) {
    throw new Error(
      `Missing unpacked @ff-labs/fff-node at ${fffNodeDir}. Check electron-builder asarUnpack configuration.`
    )
  }

  const projectDir = packager?.projectDir ?? process.cwd()

  for (const packageName of packageNames) {
    const sourceDir = await resolveInstalledPackageDir(projectDir, packageName)
    const destinationDir = path.join(nodeModulesDir, ...packageName.split('/'))

    await fs.mkdir(path.dirname(destinationDir), { recursive: true })
    await fs.cp(sourceDir, destinationDir, { recursive: true, force: true, dereference: true })
  }
}

async function copyParcelWatcherNativePackages(context) {
  const { arch, electronPlatformName, packager } = context
  const packageNames = getParcelWatcherBinaryPackages(electronPlatformName, arch)

  if (packageNames.length === 0) {
    return
  }

  const nodeModulesDir = path.join(getResourcesDir(context), 'app.asar.unpacked', 'node_modules')
  const parcelWatcherDir = path.join(nodeModulesDir, '@parcel', 'watcher')

  if (!(await pathExists(parcelWatcherDir))) {
    throw new Error(
      `Missing unpacked @parcel/watcher at ${parcelWatcherDir}. Check electron-builder asarUnpack configuration.`
    )
  }

  const projectDir = packager?.projectDir ?? process.cwd()

  for (const packageName of packageNames) {
    const sourceDir = await resolveInstalledPackageDir(projectDir, packageName)
    const destinationDir = path.join(nodeModulesDir, ...packageName.split('/'))

    await fs.mkdir(path.dirname(destinationDir), { recursive: true })
    await fs.cp(sourceDir, destinationDir, { recursive: true, force: true, dereference: true })
  }
}

function isLinux(targets) {
  const re = /AppImage|snap|deb|rpm|freebsd|pacman/i
  return !!targets.find((target) => re.test(target.name))
}

async function afterPackLinux({ appOutDir }) {
  const scriptPath = path.join(appOutDir, LINUX_APP_NAME)
  const script = `#!/bin/bash\n"\${BASH_SOURCE%/*}"/${LINUX_APP_NAME}.bin --no-sandbox "$@"`
  await fs.rename(scriptPath, `${scriptPath}.bin`)
  await fs.writeFile(scriptPath, script)
  await fs.chmod(scriptPath, 0o755)
}

async function encodeMacVssExtension(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const extensionPath = path.join(
    getResourcesDir(context),
    'app.asar.unpacked',
    'runtime',
    'duckdb',
    'extensions',
    VSS_EXTENSION_NAME
  )

  if (!(await pathExists(extensionPath))) {
    return
  }

  const base64Path = `${extensionPath}.b64`
  const extension = await fs.readFile(extensionPath)
  const compressed = await gzipAsync(extension)
  await fs.writeFile(base64Path, compressed.toString('base64'), 'utf8')
  await fs.rm(extensionPath, { force: true })
  console.info(`[afterPack] encoded macOS DuckDB VSS extension: ${base64Path}`)
}

async function afterPack(context) {
  const { targets, appOutDir } = context

  await copyFffNativePackages(context)
  await copyParcelWatcherNativePackages(context)
  await encodeMacVssExtension(context)

  if (isLinux(targets)) {
    await afterPackLinux({ appOutDir })
  }
}

export default afterPack
