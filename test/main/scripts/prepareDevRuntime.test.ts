import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { prepareDevRuntime } from '../../../scripts/prepare-dev-runtime.mjs'

vi.unmock('fs')
vi.unmock('node:fs')
const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-dev-'))
  temporary.push(root)
  const files: Record<string, string> = {
    'resources/dim-runtime-lock.json': JSON.stringify({
      version: 'pinned',
      sourceCommit: 'source'
    }),
    'resources/dim-native-host-lock.json': '{}',
    'resources/runtime-versions.json': JSON.stringify({
      schemaVersion: 3,
      tinyRuntimeInjector: '0.0.0',
      node: '24.22.1',
      uv: '0.0.0',
      cloudflared: '0.0.0',
      nodeArtifacts: {
        [`${process.platform}-${process.arch}`]: { executableSha256: 'a'.repeat(64) }
      }
    }),
    'resources/dim-plugin-runtime/package.json': '{}',
    'resources/dim-plugin-runtime/pnpm-lock.yaml': 'lock',
    'native/dim-host/Cargo.toml': 'cargo',
    'native/dim-host/Cargo.lock': 'lock',
    'native/dim-host/rust-toolchain.toml': '[toolchain]\nchannel = "1.98.1"\n',
    'native/dim-host/src/main.rs': 'native source',
    'plugins/dim/deepchat-host/index.mjs': 'plugin source',
    'scripts/build-dim-host.mjs': 'builder',
    'scripts/prepare-dim-source.mjs': 'assembly',
    'scripts/install-dim.mjs': 'installer',
    'scripts/install-runtime.mjs': 'runtime installer',
    'scripts/package-dim-runtime.mjs': 'runtime verifier',
    'scripts/dim-native-contract.mjs': 'contract',
    'scripts/prepare-dev-runtime.mjs': 'preparation'
  }
  for (const [file, body] of Object.entries(files)) {
    const destination = path.join(root, file)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, body)
  }
  const run = vi.fn(async () => {
    await mkdir(path.join(root, 'runtime/dim'), { recursive: true })
  })
  const verify = vi.fn(async () => ({ manifest: { sha256: 'host' }, nodeSha256: 'node' }))
  const verifyNode = vi.fn(async () => {})
  return { root, options: { projectDir: root, run, verify, verifyNode }, run, verify, verifyNode }
}

it('prepares missing dependencies, reuses verified assets offline and rebuilds changed sources', async () => {
  const f = await fixture()
  f.verify.mockRejectedValueOnce(new Error('missing runtime'))
  f.verifyNode.mockRejectedValueOnce(new Error('missing Node'))
  await prepareDevRuntime(f.options)
  expect(f.run.mock.calls).toEqual(
    expect.arrayContaining([
      [
        expect.any(String),
        ['--version'],
        expect.objectContaining({
          env: expect.objectContaining({ RUSTUP_TOOLCHAIN: '1.98.1' })
        })
      ],
      [expect.any(String), ['--use-env-proxy', 'scripts/install-dim.mjs'], expect.any(Object)],
      [expect.any(String), ['scripts/build-dim-host.mjs', '--dev'], expect.any(Object)]
    ])
  )
  const count = f.run.mock.calls.length
  await prepareDevRuntime(f.options)
  expect(f.run).toHaveBeenCalledTimes(count)
  await writeFile(path.join(f.root, 'plugins/dim/deepchat-host/index.mjs'), 'updated plugin')
  await prepareDevRuntime(f.options)
  expect(f.run.mock.calls.length).toBeGreaterThan(count)
})

it('invalidates the cache when release or native locks change even if assets still verify', async () => {
  const f = await fixture()
  await prepareDevRuntime(f.options)
  let count = f.run.mock.calls.length
  for (const file of ['resources/dim-runtime-lock.json', 'resources/dim-native-host-lock.json']) {
    const filename = path.join(f.root, file)
    const lock = JSON.parse(await readFile(filename, 'utf8'))
    await writeFile(filename, JSON.stringify({ ...lock, sourceCommit: 'updated-source' }))
    await prepareDevRuntime(f.options)
    expect(f.run.mock.calls.length).toBeGreaterThan(count)
    count = f.run.mock.calls.length
  }
})

it('reuses an installed release but repairs runtime damage even with a matching stamp', async () => {
  const f = await fixture()
  const release = path.join(
    f.root,
    'runtime/dim/releases',
    `pinned-${process.platform}-${process.arch}`
  )
  await mkdir(release, { recursive: true })
  await writeFile(
    path.join(release, 'release-manifest.json'),
    JSON.stringify({ version: 'pinned', sourceCommit: 'source' })
  )
  await prepareDevRuntime(f.options)
  expect(f.run.mock.calls).toContainEqual([
    expect.any(String),
    ['--use-env-proxy', 'scripts/install-dim.mjs', '--plugins-only'],
    expect.any(Object)
  ])
  const count = f.run.mock.calls.length
  f.verify.mockRejectedValueOnce(new Error('damaged runtime'))
  await prepareDevRuntime(f.options)
  expect(f.run.mock.calls.length).toBeGreaterThan(count)
})

it('fails before downloading or stamping when the pinned Rust toolchain is unavailable', async () => {
  const f = await fixture()
  f.run.mockRejectedValueOnce(new Error('missing cargo'))
  await expect(prepareDevRuntime(f.options)).rejects.toThrow('rustup toolchain install 1.98.1')
  expect(f.run).toHaveBeenCalledTimes(1)
  await expect(readFile(path.join(f.root, 'runtime/dim/development.json'))).rejects.toThrow()
})

it('does not cache an incomplete native build and retries preparation', async () => {
  const f = await fixture()
  f.verify.mockRejectedValueOnce(new Error('not installed'))
  f.verify.mockRejectedValueOnce(new Error('incomplete native build'))
  await expect(prepareDevRuntime(f.options)).rejects.toThrow('incomplete native build')
  await expect(readFile(path.join(f.root, 'runtime/dim/development.json'))).rejects.toThrow()
  await prepareDevRuntime(f.options)
  await expect(
    readFile(path.join(f.root, 'runtime/dim/development.json'), 'utf8')
  ).resolves.toContain('host')
})
