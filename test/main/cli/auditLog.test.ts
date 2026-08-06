import { link, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliAuditLog } from '@/cli/auditLog'
import type { CliPolicyAuditRecord } from '@/cli/policy'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('fs/promises')
vi.unmock('node:fs/promises')
vi.unmock('path')
vi.unmock('node:path')

const directories: string[] = []

function auditRecord(requestId: string): CliPolicyAuditRecord {
  return {
    timestamp: 1_788_000_000_000,
    principal: 'human',
    connectionId: 'connection-1',
    operation: 'settings.set',
    effect: 'preference-write',
    outcome: 'allowed',
    requestId,
    redactedArgumentsHash: 'a'.repeat(64)
  }
}

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'deepchat-cli-audit-'))
  directories.push(directory)
  return directory
}

async function readRecords(filePath: string): Promise<CliPolicyAuditRecord[]> {
  return (await readFile(filePath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as CliPolicyAuditRecord)
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 }))
  )
})

describe('CliAuditLog', () => {
  it('serializes concurrent records in call order and creates private paths', async () => {
    const directory = path.join(await createDirectory(), 'local-control')
    const log = new CliAuditLog({ directory })

    await Promise.all(Array.from({ length: 20 }, (_, index) => log.record(auditRecord(`${index}`))))
    await log.close()

    const records = await readRecords(path.join(directory, 'audit.jsonl'))
    expect(records.map((record) => record.requestId)).toEqual(
      Array.from({ length: 20 }, (_, index) => `${index}`)
    )
    if (process.platform !== 'win32') {
      expect((await stat(directory)).mode & 0o777).toBe(0o700)
      expect((await stat(path.join(directory, 'audit.jsonl'))).mode & 0o777).toBe(0o600)
    }
  })

  it('keeps only the two newest bounded audit segments', async () => {
    const directory = path.join(await createDirectory(), 'local-control')
    const recordBytes = Buffer.byteLength(`${JSON.stringify(auditRecord('1'))}\n`, 'utf8')
    const log = new CliAuditLog({ directory, maxBytes: recordBytes + 1 })

    await log.record(auditRecord('1'))
    await log.record(auditRecord('2'))
    await log.record(auditRecord('3'))
    await log.close()

    expect(await readRecords(path.join(directory, 'audit.1.jsonl'))).toMatchObject([
      { requestId: '2' }
    ])
    expect(await readRecords(path.join(directory, 'audit.jsonl'))).toMatchObject([
      { requestId: '3' }
    ])
  })

  it('rejects records after close', async () => {
    const directory = path.join(await createDirectory(), 'local-control')
    const log = new CliAuditLog({ directory })
    await log.close()

    await expect(log.record(auditRecord('late'))).rejects.toThrow('audit log is closed')
  })

  it.skipIf(process.platform === 'win32')('refuses to follow a symlinked audit file', async () => {
    const root = await createDirectory()
    const directory = path.join(root, 'local-control')
    const target = path.join(root, 'target.jsonl')
    await mkdir(directory)
    await symlink(target, path.join(directory, 'audit.jsonl'))
    const log = new CliAuditLog({ directory })

    await expect(log.record(auditRecord('1'))).rejects.toMatchObject({ code: 'ELOOP' })
    await log.close()
  })

  it.skipIf(process.platform === 'win32')(
    'refuses an audit file with multiple hard links',
    async () => {
      const root = await createDirectory()
      const directory = path.join(root, 'local-control')
      const target = path.join(root, 'target.jsonl')
      await mkdir(directory)
      await writeFile(target, '')
      await link(target, path.join(directory, 'audit.jsonl'))
      const log = new CliAuditLog({ directory })

      await expect(log.record(auditRecord('1'))).rejects.toThrow('must not have multiple links')
      await log.close()
      expect(await readFile(target, 'utf8')).toBe('')
    }
  )
})
