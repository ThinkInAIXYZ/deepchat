import { createHash } from 'node:crypto'
import { access, lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDimBinary, dimRustTarget } from './dim-native-contract.mjs'
import { signMacHelper } from './sign-cua-helper.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const json = async (file) => JSON.parse(await readFile(file, 'utf8'))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const contained = (root, relative) => {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative))
    throw new Error('Invalid dim runtime entry')
  const resolved = path.resolve(root, relative)
  const suffix = path.relative(root, resolved)
  if (!suffix || suffix === '..' || suffix.startsWith(`..${path.sep}`) || path.isAbsolute(suffix))
    throw new Error('Dim runtime entry escapes the plugin directory')
  return resolved
}

export async function verifyDimRuntime({
  runtimeRoot,
  platform = process.platform,
  arch = process.arch,
  projectDir = repository,
  development = false,
  originalNode = false
}) {
  const target = `${platform}-${arch}`
  const expectedRustTarget = dimRustTarget(platform, arch)
  const [sourceLock, hostLock, versions] = await Promise.all([
    json(path.join(projectDir, 'resources/dim-runtime-lock.json')),
    json(path.join(projectDir, 'resources/dim-native-host-lock.json')),
    json(path.join(projectDir, 'resources/runtime-versions.json'))
  ])
  const plugins = path.join(runtimeRoot, 'dim/plugins')
  const directory = path.join(runtimeRoot, 'dim/native', target)
  const [lock, nativeLock, manifest, entry] = await Promise.all([
    json(path.join(plugins, 'runtime-lock.json')),
    json(path.join(plugins, 'native-host-lock.json')),
    json(path.join(directory, 'manifest.json')),
    json(path.join(plugins, 'runtime-entry.json'))
  ])
  const executable = platform === 'win32' ? 'deepchat-dim-host.exe' : 'deepchat-dim-host'
  if (
    JSON.stringify(lock) !== JSON.stringify(sourceLock) ||
    JSON.stringify(nativeLock) !== JSON.stringify(hostLock) ||
    manifest.schemaVersion !== 1 ||
    manifest.target !== target ||
    manifest.executable !== executable ||
    manifest.sourceRevision !== hostLock.sourceRevision ||
    manifest.baseRelease !== sourceLock.version ||
    manifest.serverVersion !== hostLock.serverVersion ||
    manifest.bridgeVersion !== hostLock.bridgeVersion ||
    manifest.storeFormat !== hostLock.storeFormat ||
    manifest.apiVersion !== hostLock.apiVersion ||
    manifest.cargoLockSha256 !== hostLock.cargoLockSha256 ||
    JSON.stringify(manifest.assemblyPatch) !== JSON.stringify(hostLock.assemblyPatch) ||
    JSON.stringify(manifest.extensionPatches) !== JSON.stringify(hostLock.extensionPatches) ||
    (manifest.rustTarget !== undefined && manifest.rustTarget !== expectedRustTarget) ||
    (!development && manifest.profile !== 'release')
  )
    throw new Error('Packaged dim runtime identity mismatch')
  const native = path.join(directory, executable)
  const node = path.join(
    runtimeRoot,
    'node',
    ...(platform === 'win32' ? ['node.exe'] : ['bin/node'])
  )
  for (const file of [native, node]) {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid packaged dim executable')
  }
  const [binary, nodeBytes] = await Promise.all([readFile(native), readFile(node)])
  assertDimBinary(binary, platform, arch)
  assertDimBinary(nodeBytes, platform, arch)
  if (hash(binary) !== manifest.sha256) throw new Error('Packaged native dim checksum mismatch')
  const nodeSha256 = hash(nodeBytes)
  const expectedNode =
    !originalNode && manifest.nodeSha256
      ? manifest.nodeSha256
      : versions.nodeArtifacts?.[target]?.executableSha256
  if (!expectedNode || nodeSha256 !== expectedNode)
    throw new Error('Packaged dim Node checksum mismatch')
  const jsRuntime = contained(plugins, entry.relativePath)
  await Promise.all(['LICENSE', 'NOTICE'].map((name) => access(path.join(directory, name))))
  if (!(await readdir(path.join(directory, 'licenses'))).length)
    throw new Error('Missing native dim licenses')
  await Promise.all([
    access(path.join(jsRuntime, 'src/runner.mjs')),
    ...[
      'deepchat-host/index.mjs',
      'deepchat-host/native-client.mjs',
      'deepchat-storage/index.mjs'
    ].map((name) => access(path.join(plugins, 'modules', name)))
  ])
  return { native, node, plugins, jsRuntime, directory, manifest, nodeSha256 }
}

/** Validate first, sign nested executables before the enclosing application is sealed. */
export async function packageDimAssets(context, resourcesDir) {
  const platform = context.electronPlatformName
  const arch =
    typeof context.arch === 'string' ? context.arch : { 1: 'x64', 3: 'arm64' }[context.arch]
  const projectDir = context.packager?.projectDir ?? repository
  const runtimeRoot = path.join(resourcesDir, 'app.asar.unpacked/runtime')
  const runtime = await verifyDimRuntime({
    runtimeRoot,
    platform,
    arch,
    projectDir,
    originalNode: true
  })
  if (platform === 'darwin') {
    const purpose = process.env.PACKAGE_PURPOSE
    await signMacHelper({
      appPath: runtime.native,
      entitlementsPath: path.join(projectDir, 'build/entitlements.dim.plist'),
      purpose,
      cwd: projectDir,
      label: 'dim native host'
    })
    await signMacHelper({
      appPath: runtime.node,
      entitlementsPath: path.join(projectDir, 'build/entitlements.mac.plist'),
      purpose,
      cwd: projectDir,
      label: 'dim Node runtime'
    })
    runtime.manifest.sha256 = hash(await readFile(runtime.native))
    runtime.nodeSha256 = hash(await readFile(runtime.node))
    const ocrFile = path.join(runtimeRoot, 'ocr/manifest.json')
    const ocr = await json(ocrFile)
    if (ocr.paths?.node) {
      ocr.nodeSha256 = runtime.nodeSha256
      await writeFile(ocrFile, JSON.stringify(ocr, null, 2) + '\n')
    }
  }
  runtime.manifest.nodeSha256 = runtime.nodeSha256
  await writeFile(
    path.join(runtime.directory, 'manifest.json'),
    JSON.stringify(runtime.manifest, null, 2) + '\n'
  )
  await verifyDimRuntime({ runtimeRoot, platform, arch, projectDir })
}
