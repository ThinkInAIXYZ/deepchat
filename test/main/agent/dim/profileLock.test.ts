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

async function writeStaleRecord(address: string): Promise<string> {
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
      recordedAt: Date.now()
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

it('releases a profile lock whose unattestable host no longer listens at its address', async () => {
  profileRoot = await mkdtemp(path.join(tmpdir(), 'dim-lock-'))
  const address =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\deepchat-dim-absent-${process.pid}-${Date.now()}`
      : path.join(profileRoot, 'absent', 'host.sock')
  const records = await writeStaleRecord(address)
  // Startup passes the lock and then fails only on the missing runtime fixture.
  const failure = await supervisor()
    .start()
    .catch((error: Error) => error)
  expect(String(failure)).not.toContain('in use by another host')
  expect(await readdir(records)).toEqual([])
})
