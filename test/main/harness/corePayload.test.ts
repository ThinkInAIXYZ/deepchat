import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { CorePayloadStore } from '../../../src/harness/core/payload'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

const stores: CorePayloadStore[] = []
const roots: string[] = []
async function pair() {
  const root = await mkdtemp(path.join(tmpdir(), 'core-payload-test-'))
  roots.push(root)
  const main = await CorePayloadStore.create(root)
  const core = new CorePayloadStore(main.config, 'core')
  stores.push(main, core)
  return { main, core }
}
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('preserves IPC values inline and through encrypted large carriers', async () => {
  const { main, core } = await pair()
  const value = {
    missing: undefined,
    date: new Date('0000-01-01T00:00:00Z'),
    integer: 9n,
    map: new Map([['x', new Set([1])]])
  }
  expect(await core.decode(await main.encode(value))).toEqual(value)
  const large = { secret: 'private-payload', bytes: Buffer.alloc(3 * 1024 * 1024, 37) }
  const ref = await main.encode(large)
  const files = await readdir(main.config.directory)
  expect(files).toHaveLength(1)
  expect(
    (await readFile(path.join(main.config.directory, files[0]))).includes(Buffer.from(large.secret))
  ).toBe(false)
  expect(await core.decode(ref)).toEqual(large)
  await expect(core.decode(ref)).rejects.toThrow()
})

it('authenticates carrier generation, direction and metadata before consuming it', async () => {
  const { main, core } = await pair()
  const ref = await main.encode(Buffer.alloc(32 * 1024, 41))
  if ('inline' in ref) throw new Error('Expected carrier')
  await expect(main.decode(ref)).rejects.toThrow('direction')
  await expect(core.decode({ ...ref, bytes: ref.bytes + 1 })).rejects.toThrow('size')
  const foreign = new CorePayloadStore({ ...main.config, generation: randomUUID() }, 'core')
  stores.push(foreign)
  await expect(foreign.decode(ref)).rejects.toThrow()
  const [file] = await readdir(main.config.directory)
  const location = path.join(main.config.directory, file)
  const original = await readFile(location)
  const changed = Buffer.from(original)
  changed[changed.length - 1] ^= 1
  await writeFile(location, changed)
  await expect(core.decode(ref)).rejects.toThrow()
  await writeFile(location, original)
  expect(await core.decode(ref)).toEqual(Buffer.alloc(32 * 1024, 41))
})

it('bounds retained files and reclaims consumed carriers without a timing retry', async () => {
  const { main, core } = await pair()
  const refs = await Promise.all(
    Array.from({ length: 4 }, () => main.encode(Buffer.alloc(32 * 1024)))
  )
  await expect(main.encode(Buffer.alloc(32 * 1024))).rejects.toThrow('quota')
  await core.decode(refs[0])
  await main.encode(Buffer.alloc(32 * 1024))
  await main.close()
  expect(await readdir(main.config.directory)).toHaveLength(0)
  await expect(main.encode(undefined)).rejects.toThrow('closed')
})
