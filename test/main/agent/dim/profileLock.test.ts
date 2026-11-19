import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')

let profileRoot = ''
afterEach(() => rm(profileRoot, { recursive: true, force: true }))

async function writeUnattestableRecord(address: string, recordedAt: number): Promise<string> {
  const records = path.join(profileRoot, 'child-processes', 'dim-host')
  await mkdir(records, { recursive: true })
  const name = `${address.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80)}_${createHash('sha1')
    .update(address)
    .digest('hex')
    .slice(0, 8)}.json`
  // A live, unrelated pid with no recorded start time: the registry cannot attest it.
  await writeFile(
    path.join(records, name),
    JSON.stringify({
      version: 1,
      subsystem: 'dim-host',
      recordId: address,
      pid: process.ppid,
      ownerPid: 2 ** 31 - 2,
      commandLine: ['deepchat-dim-host'],
      recordedAt
    })
  )
  return records
}

function supervisor() {
  return new DimRuntimeSupervisor({
    runtimeRoot: path.join(profileRoot, 'runtime'),
    profileRoot,
    nodeExecutable: '/unused',
    nativePlugins: true
  })
}

it.each([
  { title: 'keeps an unattestable host lock during startup', ageMs: 0, blocked: true },
  { title: 'releases an older lock with no listener', ageMs: 60_000, blocked: false }
])('$title', async ({ ageMs, blocked }) => {
  profileRoot = await mkdtemp(path.join(tmpdir(), 'dim-lock-'))
  const address =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\deepchat-dim-absent-${process.pid}-${Date.now()}`
      : path.join(profileRoot, 'absent', 'host.sock')
  const records = await writeUnattestableRecord(address, Date.now() - ageMs)
  const failure = await supervisor()
    .start()
    .catch((error: Error) => error)
  expect(String(failure).includes('in use by another host')).toBe(blocked)
  expect(await readdir(records)).toHaveLength(blocked ? 1 : 0)
})
