import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeSource } from './prepare-dim-source.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'native/dim-host')
const lock = JSON.parse(await readFile(path.join(root, 'resources/dim-runtime-lock.json'), 'utf8'))
const nativeLock = JSON.parse(
  await readFile(path.join(root, 'resources/dim-native-host-lock.json'), 'utf8')
)
if (
  nativeSource.sourceRevision !== nativeLock.sourceRevision ||
  nativeSource.assemblyPatch.sha256 !== nativeLock.assemblyPatch.sha256 ||
  JSON.stringify(nativeSource.extensionPatches) !== JSON.stringify(nativeLock.extensionPatches)
)
  throw new Error('Native assembly lock mismatch')
const target = `${process.platform}-${process.arch}`
if (!lock.artifacts[target]) throw new Error(`Unsupported native dim host target: ${target}`)
const profile = process.argv.includes('--dev') ? 'dev' : 'release'
const cargo = process.env.CARGO ?? 'cargo'
await new Promise((resolve, reject) => {
  const child = spawn(
    cargo,
    [
      'build',
      '--manifest-path',
      path.join(source, 'Cargo.toml'),
      '--locked',
      ...(profile === 'release' ? ['--release'] : [])
    ],
    { stdio: 'inherit', cwd: source }
  )
  child.once('error', reject)
  child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`cargo exited ${code}`))))
})
const name = process.platform === 'win32' ? 'deepchat-dim-host.exe' : 'deepchat-dim-host'
const destination = path.join(root, 'runtime/dim/native', target)
await mkdir(destination, { recursive: true })
const binary = await readFile(
  path.join(source, 'target', profile === 'dev' ? 'debug' : 'release', name)
)
const cargoLock = await readFile(path.join(source, 'Cargo.lock'))
if (createHash('sha256').update(cargoLock).digest('hex') !== nativeLock.cargoLockSha256)
  throw new Error('Native Cargo.lock digest mismatch')
await copyFile(
  path.join(source, 'target', profile === 'dev' ? 'debug' : 'release', name),
  path.join(destination, `${name}.tmp`)
)
await rename(path.join(destination, `${name}.tmp`), path.join(destination, name))
const officialRelease = path.join(root, 'runtime/dim/releases', `${lock.version}-${target}`)
await cp(path.join(officialRelease, 'licenses'), path.join(destination, 'licenses'), {
  recursive: true
})
for (const name of ['LICENSE', 'NOTICE'])
  await copyFile(path.join(officialRelease, name), path.join(destination, name))
await writeFile(
  path.join(destination, 'DEEPCHAT-NATIVE-NOTICE.txt'),
  `DeepChat native dim assembly\nBase: ${lock.sourceCommit}\n` +
    'Modified Provider assembly to enable ProviderSecretHost and referenced custom headers.\n' +
    'Resolves explicitly referenced product admission for anonymous connections.\n' +
    'Adds an explicit Session host-value replacement to the builder assembly API.\n' +
    'Re-exports the public AgentIndex and exposes read-only ProviderService activity.\n' +
    'DeepChat adds configuration, auxiliary-model, context and credential-reference plugins.\n' +
    'Execution implementations are supplied by dim. DeepChat additions: Apache-2.0.\n'
)
// The release tag's Cargo package still says alpha.18. Record both identities explicitly.
await writeFile(
  path.join(destination, 'manifest.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      target,
      profile,
      executable: name,
      sourceRevision: nativeLock.sourceRevision,
      baseRelease: lock.version,
      serverVersion: nativeLock.serverVersion,
      bridgeVersion: nativeLock.bridgeVersion,
      apiVersion: nativeLock.apiVersion,
      sha256: createHash('sha256').update(binary).digest('hex'),
      cargoLockSha256: createHash('sha256').update(cargoLock).digest('hex'),
      assemblyPatch: nativeSource.assemblyPatch,
      extensionPatches: nativeSource.extensionPatches
    },
    null,
    2
  ) + '\n'
)
console.log(`Built native dim plugin host: ${destination}`)
