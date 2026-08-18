import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'

import {
  getRequiredPdfiumDirectoryPaths,
  getRequiredPdfiumArtifactPaths,
  groupLightOcrArtifactPaths,
  inspectRegularArtifactTree,
  isEncodedMacLightOcrArtifact
} from './light-ocr-artifacts.mjs'

const LINUX_APP_NAME = 'deepchat'
const VSS_EXTENSION_NAME = 'vss.duckdb_extension'
const LIGHT_OCR_FACADE_PACKAGE = '@arcships/light-ocr'
const LIGHT_OCR_RUNTIME_MANIFEST = path.join('runtime', 'ocr', 'manifest.json')
const LIGHT_OCR_DIRECT_PAYLOAD = 'direct'
const LIGHT_OCR_ENCODED_PAYLOAD = 'gzip-base64-v1'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
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

function getOpendalNativePackages(platform, arch) {
  const archName = getArchName(arch)

  if (platform === 'darwin' && archName === 'universal') {
    return ['@opendal/lib-darwin-x64', '@opendal/lib-darwin-arm64']
  }

  switch (`${platform}:${archName}`) {
    case 'darwin:x64':
      return ['@opendal/lib-darwin-x64']
    case 'darwin:arm64':
      return ['@opendal/lib-darwin-arm64']
    case 'win32:x64':
      return ['@opendal/lib-win32-x64-msvc']
    case 'win32:arm64':
      return ['@opendal/lib-win32-arm64-msvc']
    case 'linux:x64':
      return ['@opendal/lib-linux-x64-gnu']
    case 'linux:arm64':
      return ['@opendal/lib-linux-arm64-gnu']
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

async function resolveInstalledPackageDir(projectDir, packageName, expectedVersion) {
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
      if (expectedVersion) {
        const packageJson = await readJson(path.join(candidate, 'package.json'))
        if (packageJson.name !== packageName || packageJson.version !== expectedVersion) continue
      }
      return fs.realpath(candidate)
    }
  }

  const versionSuffix = expectedVersion ? `@${expectedVersion}` : ''
  throw new Error(`Unable to find installed package: ${packageName}${versionSuffix}`)
}

async function loadRuntimeVersions(projectDir) {
  return JSON.parse(
    await fs.readFile(path.join(projectDir, 'resources', 'runtime-versions.json'), 'utf8')
  )
}

function getLightOcrNativePackage(runtimeVersions, platform, arch) {
  const archName = getArchName(arch)
  return runtimeVersions.lightOcr.nativePackages[`${platform}-${archName}`] ?? null
}

function getResourcesDir(context) {
  const { appOutDir, electronPlatformName, packager } = context

  if (electronPlatformName === 'darwin') {
    const productFilename = packager?.appInfo?.productFilename ?? 'DeepChat'
    return path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
  }

  return path.join(appOutDir, 'resources')
}

function getNativeKitPrebuilds(platform, arch) {
  const archName = getArchName(arch)

  if (platform === 'darwin' && archName === 'universal') {
    return ['darwin-x64', 'darwin-arm64']
  }

  switch (`${platform}:${archName}`) {
    case 'darwin:x64':
    case 'darwin:arm64':
    case 'win32:x64':
    case 'linux:x64':
    case 'linux:arm64':
      return [`${platform}-${archName}`]
    default:
      return []
  }
}

async function validateNativeKitPrebuilds(context) {
  const prebuilds = getNativeKitPrebuilds(context.electronPlatformName, context.arch)
  if (prebuilds.length === 0) {
    return
  }

  const nativeKitDir = path.join(
    getResourcesDir(context),
    'app.asar.unpacked',
    'node_modules',
    '@zerob13',
    'nativekit'
  )
  for (const prebuild of prebuilds) {
    const binaryName = prebuild.endsWith('-arm64')
      ? 'node.napi.armv8.node'
      : 'node.napi.node'
    const binaryPath = path.join(nativeKitDir, 'prebuilds', prebuild, binaryName)
    if (!(await pathExists(binaryPath))) {
      throw new Error(
        `Missing NativeKit prebuild at ${binaryPath}. Check electron-builder asarUnpack configuration.`
      )
    }
  }
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

async function copyOpendalNativePackages(context) {
  const { arch, electronPlatformName, packager } = context
  const packageNames = getOpendalNativePackages(electronPlatformName, arch)

  if (packageNames.length === 0) {
    return
  }

  const nodeModulesDir = path.join(getResourcesDir(context), 'app.asar.unpacked', 'node_modules')
  const opendalDir = path.join(nodeModulesDir, 'opendal')

  if (!(await pathExists(opendalDir))) {
    throw new Error(
      `Missing unpacked opendal at ${opendalDir}. Check electron-builder asarUnpack configuration.`
    )
  }

  const projectDir = packager?.projectDir ?? process.cwd()
  const opendalPackageJson = await readJson(path.join(opendalDir, 'package.json'))
  if (opendalPackageJson.name !== 'opendal' || typeof opendalPackageJson.version !== 'string') {
    throw new Error(`Invalid unpacked opendal package identity at ${opendalDir}`)
  }

  for (const packageName of packageNames) {
    const sourceDir = await resolveInstalledPackageDir(
      projectDir,
      packageName,
      opendalPackageJson.version
    )
    const destinationDir = path.join(nodeModulesDir, ...packageName.split('/'))

    await fs.mkdir(path.dirname(destinationDir), { recursive: true })
    await fs.cp(sourceDir, destinationDir, { recursive: true, force: true, dereference: true })
  }
}

async function copyPackageToUnpackedApp(
  sourceDir,
  nodeModulesDir,
  packageName,
  { dereference = true } = {}
) {
  const destinationDir = path.join(nodeModulesDir, ...packageName.split('/'))
  await fs.mkdir(path.dirname(destinationDir), { recursive: true })
  await fs.rm(destinationDir, { recursive: true, force: true })
  await fs.cp(sourceDir, destinationDir, { recursive: true, force: true, dereference })
  return destinationDir
}

async function resolveOwnedPackageDir(
  ownerPackageDir,
  packageName,
  expectedVersion,
  resolutionSpecifier = packageName
) {
  const ownerRequire = createRequire(path.join(ownerPackageDir, 'package.json'))
  let packageEntry
  try {
    packageEntry = ownerRequire.resolve(resolutionSpecifier)
  } catch (error) {
    throw new Error(
      `Unable to resolve ${packageName}@${expectedVersion} from ${ownerPackageDir}`,
      { cause: error }
    )
  }

  let candidate = path.dirname(await fs.realpath(packageEntry))
  while (true) {
    const packageJsonPath = path.join(candidate, 'package.json')
    if (await pathExists(packageJsonPath)) {
      const packageJson = await readJson(packageJsonPath)
      if (packageJson.name === packageName && packageJson.version === expectedVersion) {
        return candidate
      }
    }
    const parent = path.dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }
  throw new Error(
    `Resolved package does not match ${packageName}@${expectedVersion}: ${packageEntry}`
  )
}

function extractRelativeModuleSpecifiers(source) {
  const specifiers = new Set()
  const staticPattern = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g
  const dynamicPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const pattern of [staticPattern, dynamicPattern]) {
    let match = pattern.exec(source)
    while (match) {
      if (match[1].startsWith('.')) specifiers.add(match[1])
      match = pattern.exec(source)
    }
  }
  return [...specifiers]
}

export async function copyStandaloneModuleClosure(sourceRoot, destinationRoot, entryRelativePath) {
  const queue = [entryRelativePath]
  const copied = []
  const visited = new Set()

  while (queue.length > 0) {
    const relativePath = queue.shift()
    const sourcePath = resolveContainedPath(sourceRoot, relativePath)
    const canonicalRelativePath = path.relative(path.resolve(sourceRoot), sourcePath)
    if (visited.has(canonicalRelativePath)) continue
    visited.add(canonicalRelativePath)

    const sourceStat = await fs.lstat(sourcePath)
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`Standalone helper dependency must be a regular file: ${relativePath}`)
    }
    const destinationPath = resolveContainedPath(destinationRoot, canonicalRelativePath)
    await fs.mkdir(path.dirname(destinationPath), { recursive: true })
    await fs.copyFile(sourcePath, destinationPath)
    copied.push(canonicalRelativePath)

    if (!/\.(?:c|m)?js$/.test(sourcePath)) continue
    const source = await fs.readFile(sourcePath, 'utf8')
    for (const specifier of extractRelativeModuleSpecifiers(source)) {
      const dependencyPath = path.resolve(path.dirname(sourcePath), specifier)
      const dependencyRelativePath = path.relative(path.resolve(sourceRoot), dependencyPath)
      if (
        !dependencyRelativePath ||
        dependencyRelativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(dependencyRelativePath)
      ) {
        throw new Error(`Standalone helper dependency escapes the build output: ${specifier}`)
      }
      queue.push(dependencyRelativePath)
    }
  }

  return copied
}

async function removeLightOcrPackages(nodeModulesDir) {
  const scopeDir = path.join(nodeModulesDir, '@arcships')
  let entries = []
  try {
    entries = await fs.readdir(scopeDir, { withFileTypes: true })
  } catch {
    return
  }
  await Promise.all(
    entries
      .filter((entry) => entry.name === 'light-ocr' || entry.name.startsWith('light-ocr-'))
      .map((entry) => fs.rm(path.join(scopeDir, entry.name), { recursive: true, force: true }))
  )
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function assertPackageVersion(packageDir, expectedName, expectedVersion) {
  const packageJson = await readJson(path.join(packageDir, 'package.json'))
  if (packageJson.name !== expectedName || packageJson.version !== expectedVersion) {
    throw new Error(
      `Unexpected OCR package identity at ${packageDir}: expected ${expectedName}@${expectedVersion}`
    )
  }
}

async function assertExactPackageDependency(
  packageDir,
  dependencyField,
  dependencyName,
  expectedVersion
) {
  const packageJson = await readJson(path.join(packageDir, 'package.json'))
  if (packageJson[dependencyField]?.[dependencyName] !== expectedVersion) {
    throw new Error(
      `${packageJson.name} must declare exactly ${dependencyName}@${expectedVersion} in ${dependencyField}`
    )
  }
}

async function assertLightOcrDependencyPin(projectDir, expectedVersion) {
  const packageJson = await readJson(path.join(projectDir, 'package.json'))
  if (packageJson.dependencies?.[LIGHT_OCR_FACADE_PACKAGE] !== expectedVersion) {
    throw new Error(
      `DeepChat must depend on exactly ${LIGHT_OCR_FACADE_PACKAGE}@${expectedVersion}`
    )
  }
}

function resolveContainedPath(rootDir, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid OCR integrity manifest path: ${String(relativePath)}`)
  }
  const resolvedRoot = path.resolve(rootDir)
  const resolvedPath = path.resolve(resolvedRoot, relativePath)
  const relative = path.relative(resolvedRoot, resolvedPath)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`OCR integrity manifest path escapes its package: ${relativePath}`)
  }
  return resolvedPath
}

async function hashFile(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolve)
  })
  return hash.digest('hex')
}

async function verifyModelChecksums(bundleDir) {
  const checksumPath = path.join(bundleDir, 'SHA256SUMS')
  const lines = (await fs.readFile(checksumPath, 'utf8')).split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) throw new Error('OCR model SHA256SUMS is empty')

  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line)
    if (!match) throw new Error(`Invalid OCR model checksum line: ${line}`)
    const [, expectedHash, relativePath] = match
    const filePath = resolveContainedPath(bundleDir, relativePath)
    const actualHash = await hashFile(filePath)
    if (actualHash !== expectedHash) {
      throw new Error(`OCR model checksum mismatch for ${relativePath}`)
    }
  }
}

async function verifyNativeArtifacts(nativePackageDir, platform) {
  const artifactManifest = await readJson(path.join(nativePackageDir, 'artifact-hashes.json'))
  if (!Array.isArray(artifactManifest.files) || artifactManifest.files.length === 0) {
    throw new Error('OCR native artifact manifest is empty')
  }
  for (const artifact of artifactManifest.files) {
    if (
      !artifact ||
      typeof artifact.path !== 'string' ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      typeof artifact.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256)
    ) {
      throw new Error('OCR native artifact manifest contains invalid metadata')
    }
    const filePath = resolveContainedPath(nativePackageDir, artifact.path)
    const fileStat = await fs.lstat(filePath)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error(`OCR native artifact is not a regular file: ${artifact.path}`)
    }
    if (fileStat.size !== artifact.bytes) {
      throw new Error(`OCR native artifact size mismatch for ${artifact.path}`)
    }
    const actualHash = await hashFile(filePath)
    if (actualHash !== artifact.sha256) {
      throw new Error(`OCR native artifact checksum mismatch for ${artifact.path}`)
    }
  }
  await assertExactPdfiumDirectory(nativePackageDir, platform)
  return {
    manifest: artifactManifest,
    inventory: groupLightOcrArtifactPaths(
      artifactManifest.files.map((artifact) => artifact.path),
      platform
    )
  }
}

async function assertExactPdfiumDirectory(nativePackageDir, platform) {
  const actual = await inspectRegularArtifactTree(nativePackageDir, 'pdfium')
  const expectedPaths = getRequiredPdfiumArtifactPaths(platform).sort()
  const expectedDirectories = getRequiredPdfiumDirectoryPaths().sort()
  if (
    actual.files.length !== expectedPaths.length ||
    actual.files.some((relativePath, index) => relativePath !== expectedPaths[index]) ||
    actual.directories.length !== expectedDirectories.length ||
    actual.directories.some(
      (relativePath, index) => relativePath !== expectedDirectories[index]
    )
  ) {
    throw new Error(
      `OCR native PDFium directory mismatch for ${platform}: expected ${expectedPaths.join(', ')}`
    )
  }
}

async function encodeMacLightOcrNativeArtifacts(nativePackageDir, artifactManifest) {
  const codeArtifacts = artifactManifest.files.filter((artifact) =>
    isEncodedMacLightOcrArtifact(artifact.path)
  )
  if (codeArtifacts.length === 0) {
    throw new Error('macOS OCR native package has no code artifacts to encode')
  }

  for (const artifact of codeArtifacts) {
    const filePath = resolveContainedPath(nativePackageDir, artifact.path)
    const fileStat = await fs.lstat(filePath)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error(`OCR native code artifact is not a regular file: ${artifact.path}`)
    }
    const compressed = await gzipAsync(await fs.readFile(filePath), { level: 9 })
    await fs.writeFile(`${filePath}.gz.b64`, compressed.toString('base64'), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644
    })
    await fs.rm(filePath)
  }
}

async function assertLegalAssets(facadeDir, runtimeDir, modelDir, nativeDir) {
  const requiredPaths = [
    path.join(facadeDir, 'LICENSE'),
    path.join(facadeDir, 'NOTICE'),
    path.join(runtimeDir, 'LICENSE'),
    path.join(runtimeDir, 'NOTICE'),
    path.join(modelDir, 'LICENSE'),
    path.join(modelDir, 'NOTICE'),
    path.join(modelDir, 'bundle', 'LICENSES', 'MODEL-NOTICE.md'),
    path.join(modelDir, 'bundle', 'LICENSES', 'PaddleOCR-Apache-2.0.txt'),
    path.join(nativeDir, 'LICENSE'),
    path.join(nativeDir, 'NOTICE'),
    path.join(nativeDir, 'licenses'),
    path.join(nativeDir, 'licenses', 'noto-sans-sc-OFL-1.1.txt'),
    path.join(nativeDir, 'pdfium', 'fonts', 'OFL.txt')
  ]
  for (const requiredPath of requiredPaths) await fs.access(requiredPath)
}

async function assertRuntimeEntryPoints(facadeDir, runtimeDir, nativeDir) {
  await Promise.all([
    fs.access(path.join(facadeDir, 'src', 'index.cjs')),
    fs.access(path.join(runtimeDir, 'src', 'index.cjs')),
    fs.access(path.join(nativeDir, 'native', 'runtime-descriptor.json'))
  ])
}

async function writeLightOcrRuntimeManifest(resourcesDir, manifest) {
  const manifestPath = path.join(resourcesDir, 'app.asar.unpacked', LIGHT_OCR_RUNTIME_MANIFEST)
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export async function packageLightOcrAssets(context) {
  const projectDir = context.packager?.projectDir ?? path.join(scriptDir, '..')
  const runtimeVersions = await loadRuntimeVersions(projectDir)
  const { lightOcr } = runtimeVersions
  const platform = context.electronPlatformName
  const arch = getArchName(context.arch)
  const resourcesDir = getResourcesDir(context)
  const unpackedRoot = path.join(resourcesDir, 'app.asar.unpacked')
  const nodeModulesDir = path.join(unpackedRoot, 'node_modules')
  const helperPath = path.join(unpackedRoot, 'out', 'main', 'lightOcrHelper.js')
  const nativePackage = getLightOcrNativePackage(runtimeVersions, platform, context.arch)

  if (!nativePackage) {
    await removeLightOcrPackages(nodeModulesDir)
    await fs.rm(helperPath, { force: true })
    await writeLightOcrRuntimeManifest(resourcesDir, {
      schemaVersion: 3,
      supported: false,
      reason: 'unsupported_platform',
      platform,
      arch: arch ?? 'unknown',
      facadeVersion: lightOcr.facadeVersion,
      runtimeVersion: lightOcr.runtimeVersion,
      modelVersion: lightOcr.modelVersion,
      nativeVersion: lightOcr.nativeVersion,
      pdfSupport: false,
      bundleId: lightOcr.bundleId
    })
    return
  }

  await assertLightOcrDependencyPin(projectDir, lightOcr.facadeVersion)
  await copyStandaloneModuleClosure(
    path.join(projectDir, 'out', 'main'),
    path.join(unpackedRoot, 'out', 'main'),
    'lightOcrHelper.js'
  )
  await removeLightOcrPackages(nodeModulesDir)
  const facadeSourceDir = await resolveInstalledPackageDir(
    projectDir,
    LIGHT_OCR_FACADE_PACKAGE,
    lightOcr.facadeVersion
  )
  const runtimeSourceDir = await resolveOwnedPackageDir(
    facadeSourceDir,
    lightOcr.runtimePackage,
    lightOcr.runtimeVersion
  )
  const modelSourceDir = await resolveOwnedPackageDir(
    facadeSourceDir,
    lightOcr.modelPackage,
    lightOcr.modelVersion,
    `${lightOcr.modelPackage}/bundle/manifest.json`
  )
  const nativeSourceDir = await resolveOwnedPackageDir(
    runtimeSourceDir,
    nativePackage,
    lightOcr.nativeVersion
  )
  const facadeDir = await copyPackageToUnpackedApp(
    facadeSourceDir,
    nodeModulesDir,
    LIGHT_OCR_FACADE_PACKAGE
  )
  const runtimeDir = await copyPackageToUnpackedApp(
    runtimeSourceDir,
    nodeModulesDir,
    lightOcr.runtimePackage
  )
  const modelDir = await copyPackageToUnpackedApp(
    modelSourceDir,
    nodeModulesDir,
    lightOcr.modelPackage
  )
  const nativeDir = await copyPackageToUnpackedApp(
    nativeSourceDir,
    nodeModulesDir,
    nativePackage,
    { dereference: false }
  )

  const nodeRelativePath =
    platform === 'win32'
      ? path.join('runtime', 'node', 'node.exe')
      : path.join('runtime', 'node', 'bin', 'node')
  const nodePath = path.join(unpackedRoot, nodeRelativePath)
  const nodeArtifact = runtimeVersions.nodeArtifacts?.[`${platform}-${arch}`]
  await fs.access(helperPath)
  let nodeSha256 = null
  if (await pathExists(nodePath)) {
    if (!nodeArtifact || typeof nodeArtifact.executableSha256 !== 'string') {
      throw new Error(`Missing bundled Node integrity metadata for ${platform}-${arch}`)
    }
    nodeSha256 = await hashFile(nodePath)
    if (nodeSha256 !== nodeArtifact.executableSha256) {
      throw new Error(
        `Bundled Node checksum mismatch for ${platform}-${arch}: ${nodeSha256} != ${nodeArtifact.executableSha256}`
      )
    }
  }
  await assertPackageVersion(facadeDir, LIGHT_OCR_FACADE_PACKAGE, lightOcr.facadeVersion)
  await assertPackageVersion(runtimeDir, lightOcr.runtimePackage, lightOcr.runtimeVersion)
  await assertPackageVersion(modelDir, lightOcr.modelPackage, lightOcr.modelVersion)
  await assertPackageVersion(nativeDir, nativePackage, lightOcr.nativeVersion)
  await Promise.all([
    assertExactPackageDependency(
      facadeDir,
      'dependencies',
      lightOcr.runtimePackage,
      lightOcr.runtimeVersion
    ),
    assertExactPackageDependency(
      facadeDir,
      'dependencies',
      lightOcr.modelPackage,
      lightOcr.modelVersion
    ),
    assertExactPackageDependency(
      runtimeDir,
      'optionalDependencies',
      nativePackage,
      lightOcr.nativeVersion
    )
  ])

  const bundleDir = path.join(modelDir, 'bundle')
  const bundleManifest = await readJson(path.join(bundleDir, 'manifest.json'))
  if (bundleManifest.bundleId !== lightOcr.bundleId) {
    throw new Error(
      `Unexpected OCR model bundle identity: expected ${lightOcr.bundleId}, received ${String(bundleManifest.bundleId)}`
    )
  }
  await verifyModelChecksums(bundleDir)
  const { manifest: nativeArtifactManifest, inventory: nativeArtifactInventory } =
    await verifyNativeArtifacts(nativeDir, platform)
  await assertRuntimeEntryPoints(facadeDir, runtimeDir, nativeDir)
  await assertLegalAssets(facadeDir, runtimeDir, modelDir, nativeDir)
  let nativePayloadEncoding = LIGHT_OCR_DIRECT_PAYLOAD
  if (platform === 'darwin') {
    await encodeMacLightOcrNativeArtifacts(nativeDir, nativeArtifactManifest)
    nativePayloadEncoding = LIGHT_OCR_ENCODED_PAYLOAD
  }

  await writeLightOcrRuntimeManifest(resourcesDir, {
    schemaVersion: 3,
    supported: true,
    platform,
    arch,
    facadeVersion: lightOcr.facadeVersion,
    runtimeVersion: lightOcr.runtimeVersion,
    modelVersion: lightOcr.modelVersion,
    nativeVersion: lightOcr.nativeVersion,
    pdfSupport: true,
    bundleId: lightOcr.bundleId,
    nodeVersion: runtimeVersions.node,
    ...(nodeSha256 ? { nodeSha256 } : {}),
    nativePackage,
    nativePayloadEncoding,
    nativeArtifactInventory,
    paths: {
      ...(nodeSha256 ? { node: nodeRelativePath } : {}),
      helper: path.join('out', 'main', 'lightOcrHelper.js'),
      facade: path.relative(unpackedRoot, facadeDir),
      runtime: path.relative(unpackedRoot, runtimeDir),
      bundle: path.relative(unpackedRoot, bundleDir),
      native: path.relative(unpackedRoot, nativeDir)
    }
  })
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
  await copyOpendalNativePackages(context)
  await packageLightOcrAssets(context)
  await validateNativeKitPrebuilds(context)
  await encodeMacVssExtension(context)

  if (isLinux(targets)) {
    await afterPackLinux({ appOutDir })
  }
}

export default afterPack
