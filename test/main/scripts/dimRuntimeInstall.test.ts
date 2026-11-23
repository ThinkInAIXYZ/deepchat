import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { installDim, loadDimLock } from '../../../scripts/install-dim.mjs'
import { buildRuntimeInstallPlan } from '../../../scripts/install-runtime.mjs'

vi.unmock('node:fs')
vi.unmock('fs')

const temporary: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

it('plans the pinned host plus Node without changing default runtime selection', async () => {
  const lock = await loadDimLock()
  expect(Object.keys(lock.artifacts)).toHaveLength(6)
  expect(
    buildRuntimeInstallPlan({ types: ['node', 'dim'] }).map(({ type, version }) => ({
      type,
      version
    }))
  ).toEqual([
    { type: 'node', version: 'v24.22.1' },
    { type: 'dim', version: lock.version }
  ])
  expect(buildRuntimeInstallPlan().some(({ type }) => type === 'dim')).toBe(false)
})

it('rejects a bad archive before touching a previously installed runtime', async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-install-'))
  temporary.push(target)
  await writeFile(path.join(target, 'existing'), 'keep')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('corrupted download'))
  )
  await expect(installDim({ target, platform: 'linux', arch: 'x64' })).rejects.toThrow(
    'checksum mismatch'
  )
  expect(await readFile(path.join(target, 'existing'), 'utf8')).toBe('keep')
  expect(await readdir(target)).toEqual(['existing'])
})

it('rejects unsupported targets without downloading anything', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(installDim({ platform: 'freebsd', arch: 'x64' })).rejects.toThrow(
    'Unsupported dim platform'
  )
  expect(fetch).not.toHaveBeenCalled()
})
