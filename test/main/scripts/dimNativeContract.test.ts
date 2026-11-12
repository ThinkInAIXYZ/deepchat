import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  assertDimBinary,
  dimPipeName,
  dimRustTarget
} from '../../../scripts/dim-native-contract.mjs'
import { packageDimAssets, verifyDimRuntime } from '../../../scripts/package-dim-runtime.mjs'

vi.unmock('fs')
vi.unmock('node:fs')
vi.mock('../../../scripts/sign-cua-helper.mjs', () => ({
  signMacHelper: vi.fn(async ({ appPath }: { appPath: string }) => {
    await writeFile(appPath, Buffer.concat([await readFile(appPath), Buffer.from('signed')]))
  })
}))
const temporary: string[] = []

it('preserves the native Windows local pipe prefix without JavaScript escape loss', () => {
  const prefix = String.fromCharCode(92, 92, 46, 92, 112, 105, 112, 101, 92)
  expect(dimPipeName('deepchat-offline-123')).toBe(prefix + 'deepchat-offline-123')
  expect(() => dimPipeName('foreign/name')).toThrow('Invalid dim pipe name')
})
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const targets = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64'
]
function binary(target: string) {
  const bytes = Buffer.alloc(128)
  if (target.startsWith('linux')) {
    bytes.set([127, 69, 76, 70, 2, 1])
    bytes.writeUInt16LE(target.endsWith('x64') ? 62 : 183, 18)
  } else if (target.startsWith('darwin')) {
    bytes.writeUInt32LE(0xfeedfacf)
    bytes.writeUInt32LE(target.endsWith('x64') ? 0x01000007 : 0x0100000c, 4)
  } else {
    bytes.write('MZ')
    bytes.writeUInt32LE(64, 0x3c)
    bytes.writeUInt32LE(0x00004550, 64)
    bytes.writeUInt16LE(target.endsWith('x64') ? 0x8664 : 0xaa64, 68)
  }
  return bytes
}
it.each(targets)(
  'accepts %s executables and rejects mislabelled or truncated artifacts',
  (target) => {
    const [platform, arch] = target.split('-')
    expect(dimRustTarget(platform, arch)).toContain(arch === 'x64' ? 'x86_64' : 'aarch64')
    expect(() => assertDimBinary(binary(target), platform, arch)).not.toThrow()
    expect(() =>
      assertDimBinary(binary(target), platform, arch === 'x64' ? 'arm64' : 'x64')
    ).toThrow('target mismatch')
    expect(() => assertDimBinary(binary(target).subarray(0, 2), platform, arch)).toThrow(
      'invalid binary'
    )
  }
)
async function fixture(target = 'linux-x64') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dim-package-contract-'))
  temporary.push(root)
  const resources = path.join(root, 'package/resources')
  const runtimeRoot = path.join(resources, 'app.asar.unpacked/runtime')
  const plugins = path.join(runtimeRoot, 'dim/plugins')
  const directory = path.join(runtimeRoot, 'dim/native', target)
  const [platform, arch] = target.split('-')
  const native = path.join(
    directory,
    platform === 'win32' ? 'deepchat-dim-host.exe' : 'deepchat-dim-host'
  )
  const node = path.join(
    runtimeRoot,
    'node',
    ...(platform === 'win32' ? ['node.exe'] : ['bin/node'])
  )
  const sourceLock = { version: 'pinned', sourceCommit: 'source', pluginApiVersion: 1 }
  const hostLock = {
    sourceRevision: 'source',
    serverVersion: 'server',
    bridgeVersion: 'bridge',
    storeFormat: 36,
    cargoLockSha256: 'cargo',
    apiVersion: 1,
    assemblyPatch: {},
    extensionPatches: []
  }
  const manifest = {
    ...hostLock,
    schemaVersion: 1,
    profile: 'release',
    target,
    rustTarget: dimRustTarget(platform, arch),
    executable: path.basename(native),
    baseRelease: 'pinned',
    sha256: hash(binary(target))
  }
  const files: Record<string, string | Buffer> = {
    'resources/dim-runtime-lock.json': JSON.stringify(sourceLock),
    'resources/dim-native-host-lock.json': JSON.stringify(hostLock),
    'resources/runtime-versions.json': JSON.stringify({
      nodeArtifacts: { [target]: { executableSha256: hash(binary(target)) } }
    })
  }
  for (const [file, bytes] of Object.entries(files)) {
    const destination = path.join(root, file)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, bytes)
  }
  const write = async (file: string, bytes: string | Buffer) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, bytes)
  }
  await write(native, binary(target))
  await write(node, binary(target))
  await write(path.join(directory, 'manifest.json'), JSON.stringify(manifest))
  await write(path.join(plugins, 'runtime-lock.json'), JSON.stringify(sourceLock))
  await write(path.join(plugins, 'native-host-lock.json'), JSON.stringify(hostLock))
  await write(path.join(plugins, 'runtime-entry.json'), JSON.stringify({ relativePath: 'runtime' }))
  await write(path.join(plugins, 'runtime/src/runner.mjs'), 'runner')
  for (const file of ['LICENSE', 'NOTICE', 'licenses/third-party'])
    await write(path.join(directory, file), 'legal')
  for (const file of [
    'deepchat-host/index.mjs',
    'deepchat-host/native-client.mjs',
    'deepchat-host/model-calls.mjs',
    'deepchat-storage/index.mjs'
  ])
    await write(path.join(plugins, 'modules', file), 'plugin')
  const options = { runtimeRoot, platform, arch, projectDir: root }
  return {
    root,
    resources,
    runtimeRoot,
    directory,
    manifest,
    native,
    node,
    plugins,
    options,
    write
  }
}
it('refuses missing or corrupted runtime pieces before packaging', async () => {
  const f = await fixture()
  await expect(verifyDimRuntime(f.options)).resolves.toMatchObject({
    nodeSha256: hash(binary('linux-x64'))
  })
  await writeFile(f.native, binary('linux-arm64'))
  await expect(verifyDimRuntime(f.options)).rejects.toThrow('target mismatch')
  await writeFile(f.native, binary('linux-x64'))
  await writeFile(f.node, Buffer.concat([binary('linux-x64'), Buffer.from('tampered')]))
  await expect(verifyDimRuntime(f.options)).rejects.toThrow('Node checksum')
  await writeFile(f.node, binary('linux-x64'))
  await writeFile(
    path.join(f.plugins, 'runtime-entry.json'),
    JSON.stringify({ relativePath: '../outside' })
  )
  await expect(verifyDimRuntime(f.options)).rejects.toThrow('escapes')
})

it('requires release artifacts in packages and the complete local plugin closure', async () => {
  const f = await fixture()
  await writeFile(
    path.join(f.directory, 'manifest.json'),
    JSON.stringify({ ...f.manifest, profile: 'dev' })
  )
  await expect(verifyDimRuntime(f.options)).rejects.toThrow('identity')
  await expect(verifyDimRuntime({ ...f.options, development: true })).resolves.toBeDefined()
  await rm(path.join(f.plugins, 'runtime/src/runner.mjs'))
  await expect(verifyDimRuntime({ ...f.options, development: true })).rejects.toThrow()
})
it('rejects conflicting plugin APIs even when both packaged locks match their source locks', async () => {
  const f = await fixture()
  const sourceLockPath = path.join(f.root, 'resources/dim-runtime-lock.json')
  const lock = JSON.parse(await readFile(sourceLockPath, 'utf8'))
  lock.pluginApiVersion = 2
  await writeFile(sourceLockPath, JSON.stringify(lock))
  await writeFile(path.join(f.plugins, 'runtime-lock.json'), JSON.stringify(lock))
  await expect(verifyDimRuntime(f.options)).rejects.toThrow('identity')
})

it('requires the model plugin entry point in the packaged plugin closure', async () => {
  const f = await fixture()
  await rm(path.join(f.plugins, 'modules/deepchat-host/model-calls.mjs'))
  await expect(verifyDimRuntime(f.options)).rejects.toThrow()
})

it('records signed native and Node digests before the app is sealed, preserving OCR distribution provenance', async () => {
  const f = await fixture('darwin-arm64')
  const ocrFile = path.join(f.runtimeRoot, 'ocr/manifest.json')
  await f.write(
    ocrFile,
    JSON.stringify({
      paths: { node: 'runtime/node/bin/node' },
      nodeSha256: hash(binary('darwin-arm64'))
    })
  )
  await packageDimAssets(
    { electronPlatformName: 'darwin', arch: 'arm64', packager: { projectDir: f.root } },
    f.resources
  )
  const manifest = JSON.parse(await readFile(path.join(f.directory, 'manifest.json'), 'utf8'))
  expect(manifest.sha256).toBe(hash(await readFile(f.native)))
  expect(manifest.nodeSha256).toBe(hash(await readFile(f.node)))
  expect(manifest.sha256).not.toBe(f.manifest.sha256)
  expect(JSON.parse(await readFile(ocrFile, 'utf8')).nodeSha256).toBe(hash(binary('darwin-arm64')))
  await expect(verifyDimRuntime(f.options)).resolves.toMatchObject({
    nodeSha256: manifest.nodeSha256
  })
})

it('preserves the original shared Node in unsigned macOS verification packages', async () => {
  vi.stubEnv('PACKAGE_PURPOSE', 'verification')
  try {
    const f = await fixture('darwin-arm64')
    await packageDimAssets(
      { electronPlatformName: 'darwin', arch: 'arm64', packager: { projectDir: f.root } },
      f.resources
    )
    expect(hash(await readFile(f.node))).toBe(hash(binary('darwin-arm64')))
    const manifest = JSON.parse(await readFile(path.join(f.directory, 'manifest.json'), 'utf8'))
    expect(manifest.sha256).not.toBe(f.manifest.sha256)
    expect(manifest.nodeSha256).toBe(hash(binary('darwin-arm64')))
    await expect(verifyDimRuntime(f.options)).resolves.toBeDefined()
  } finally {
    vi.unstubAllEnvs()
  }
})
