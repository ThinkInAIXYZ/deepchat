import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AcpLaunchSpecService } from '@/agent/acp/launch/acpLaunchSpecService'

vi.unmock('fs')

const platformMap: Record<string, string> = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'windows'
}
const archMap: Record<string, string> = {
  arm64: 'aarch64',
  x64: 'x86_64'
}

const getCurrentPlatformKey = () => `${platformMap[process.platform]}-${archMap[process.arch]}`

describe('AcpLaunchSpecService', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const tempDir of tempDirs) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    tempDirs.length = 0
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const createService = () => {
    const dir = path.join(
      os.tmpdir(),
      `deepchat-acp-spec-${Math.random().toString(16).slice(2, 10)}`
    )
    fs.mkdirSync(dir, { recursive: true })
    tempDirs.push(dir)
    return new AcpLaunchSpecService(dir)
  }

  it('prefers binary over npx and uvx for preview generation', () => {
    const service = createService()
    const platformKey = getCurrentPlatformKey()

    const preview = service.buildRegistryPreview({
      id: 'codex-acp',
      name: 'Codex CLI',
      version: '0.10.0',
      distribution: {
        binary: {
          [platformKey]: {
            archive: 'https://example.com/codex.tar.gz',
            cmd: './codex-acp'
          }
        },
        npx: {
          package: '@zed-industries/codex-acp@0.10.0'
        },
        uvx: {
          package: 'codex-acp==0.10.0'
        }
      },
      source: 'registry',
      enabled: false
    })

    expect(preview).toEqual({
      command: './codex-acp',
      args: []
    })
  })

  it('builds a manual launch spec without registry installation', () => {
    const service = createService()

    expect(
      service.resolveManualLaunchSpec({
        id: 'local-agent',
        name: 'Local',
        command: 'acp-local',
        args: ['serve'],
        env: { LOCAL_ENV: '1' },
        enabled: true,
        source: 'manual'
      })
    ).toEqual({
      agentId: 'local-agent',
      source: 'manual',
      distributionType: 'manual',
      command: 'acp-local',
      args: ['serve'],
      env: { LOCAL_ENV: '1' },
      installDir: null
    })
  })

  it('rejects unsafe registry install path segments', async () => {
    const service = createService()
    const platformKey = getCurrentPlatformKey()

    await expect(
      service.ensureRegistryAgentInstalled(
        {
          id: '../escape',
          name: 'Unsafe Agent',
          version: '1.0.0',
          distribution: {
            binary: {
              [platformKey]: {
                archive: 'https://example.com/unsafe.tar.gz',
                cmd: './unsafe-agent'
              }
            }
          },
          source: 'registry',
          enabled: false
        },
        null
      )
    ).rejects.toThrow('Unsafe ACP registry agent id')
  })

  it('verifies a registry binary checksum before extracting it', async () => {
    const service = createService()
    const platformKey = getCurrentPlatformKey()
    const archive = zipSync({ 'codex-acp': Buffer.from('binary') })
    const sha256 = createHash('sha256').update(archive).digest('hex')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(archive)))

    const state = await service.ensureRegistryAgentInstalled(
      {
        id: 'codex-acp',
        name: 'Codex CLI',
        version: '0.10.0',
        distribution: {
          binary: {
            [platformKey]: {
              archive: 'https://example.com/codex.zip',
              cmd: './codex-acp',
              sha256
            }
          }
        },
        source: 'registry',
        enabled: false
      },
      null
    )

    expect(state.status).toBe('installed')
    expect(fs.readFileSync(path.join(state.installDir!, 'codex-acp'), 'utf-8')).toBe('binary')
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(state.installDir!, 'codex-acp')).mode & 0o777).toBe(0o755)
    }
  })

  it.skipIf(process.platform === 'win32')(
    'preserves executable helpers and resource permissions on install and repair',
    async () => {
      const service = createService()
      const platformKey = getCurrentPlatformKey()
      const rawZip = Buffer.from(
        zipSync({
          agent: [
            Buffer.from('#!/bin/sh\nexec "${0%/*}/helpers/辅助程序"\n'),
            { os: 3, attrs: 0o100755 << 16 }
          ],
          'helpers/辅助程序': [
            Buffer.from('#!/bin/sh\nprintf helper-ok\n'),
            { os: 19, attrs: 0o100555 << 16 }
          ],
          'resources/config.json': [Buffer.from('{}'), { os: 3, attrs: 0o100640 << 16 }],
          'resources/untyped.txt': [Buffer.from('plain'), { os: 3, attrs: 0o100000 << 16 }]
        })
      )
      const archiveComment = Buffer.from('ACP permissions')
      rawZip.writeUInt16LE(archiveComment.length, rawZip.length - 2)
      const archive = Buffer.concat([rawZip, archiveComment, Buffer.from('trailing-bytes')])
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(archive))
      )
      const agent = {
        id: 'permission-agent',
        name: 'Permission Agent',
        version: '1.0.0',
        distribution: {
          binary: {
            [platformKey]: {
              archive: 'https://example.com/agent.zip',
              cmd: './agent'
            }
          }
        },
        source: 'registry' as const,
        enabled: false
      }
      const verifyInstallation = (installDir: string) => {
        expect(fs.statSync(path.join(installDir, 'agent')).mode & 0o777).toBe(0o755)
        expect(fs.statSync(path.join(installDir, 'helpers/辅助程序')).mode & 0o777).toBe(0o555)
        expect(fs.statSync(path.join(installDir, 'resources/config.json')).mode & 0o777).toBe(0o640)
        expect(fs.statSync(path.join(installDir, 'resources/untyped.txt')).mode & 0o400).toBe(0o400)
        expect(fs.readFileSync(path.join(installDir, 'resources/untyped.txt'), 'utf-8')).toBe(
          'plain'
        )
        expect(execFileSync(path.join(installDir, 'agent'), { encoding: 'utf-8' })).toBe(
          'helper-ok'
        )
      }

      const installed = await service.ensureRegistryAgentInstalled(agent, null)
      expect(installed.status).toBe('installed')
      verifyInstallation(installed.installDir!)

      fs.chmodSync(path.join(installed.installDir!, 'helpers/辅助程序'), 0o644)
      const repaired = await service.ensureRegistryAgentInstalled(agent, installed, {
        repair: true
      })
      expect(repaired.status).toBe('installed')
      verifyInstallation(repaired.installDir!)
    }
  )

  it('preserves permissions when the ZIP directory uses ZIP64 records', async () => {
    const service = createService()
    const platformKey = getCurrentPlatformKey()
    const zip = Buffer.from(
      zipSync({
        agent: [Buffer.from('#!/bin/sh\nprintf zip64-ok\n'), { os: 3, attrs: 0o100555 << 16 }]
      })
    )
    const endOffset = zip.length - 22
    const zip64 = Buffer.alloc(56)
    zip64.writeUInt32LE(0x06064b50)
    zip64.writeBigUInt64LE(44n, 4)
    zip64.writeUInt16LE(45, 12)
    zip64.writeUInt16LE(45, 14)
    zip64.writeBigUInt64LE(1n, 24)
    zip64.writeBigUInt64LE(1n, 32)
    zip64.writeBigUInt64LE(BigInt(zip.readUInt32LE(endOffset + 12)), 40)
    zip64.writeBigUInt64LE(BigInt(zip.readUInt32LE(endOffset + 16)), 48)
    const locator = Buffer.alloc(20)
    locator.writeUInt32LE(0x07064b50)
    locator.writeBigUInt64LE(BigInt(endOffset), 8)
    locator.writeUInt32LE(1, 16)
    const end = Buffer.from(zip.subarray(endOffset))
    end.writeUInt16LE(0xffff, 8)
    end.writeUInt16LE(0xffff, 10)
    end.writeUInt32LE(0xffffffff, 12)
    end.writeUInt32LE(0xffffffff, 16)
    const archive = Buffer.concat([zip.subarray(0, endOffset), zip64, locator, end])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(archive))
    )

    const state = await service.ensureRegistryAgentInstalled(
      {
        id: 'zip64-agent',
        name: 'ZIP64 Agent',
        version: '1.0.0',
        distribution: {
          binary: {
            [platformKey]: {
              archive: 'https://example.com/agent.zip',
              cmd: './agent'
            }
          }
        },
        source: 'registry',
        enabled: false
      },
      null
    )

    expect(state.status).toBe('installed')
    const command = path.join(state.installDir!, 'agent')
    expect(fs.readFileSync(command, 'utf-8')).toBe('#!/bin/sh\nprintf zip64-ok\n')
    if (process.platform !== 'win32') {
      expect(fs.statSync(command).mode & 0o777).toBe(0o555)
      expect(execFileSync(command, { encoding: 'utf-8' })).toBe('zip64-ok')
    }
  })

  it('rejects a registry binary with a mismatched checksum', async () => {
    const service = createService()
    const platformKey = getCurrentPlatformKey()
    const archive = zipSync({ 'codex-acp': Buffer.from('tampered') })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(archive)))

    const state = await service.ensureRegistryAgentInstalled(
      {
        id: 'codex-acp',
        name: 'Codex CLI',
        version: '0.10.0',
        distribution: {
          binary: {
            [platformKey]: {
              archive: 'https://example.com/codex.zip',
              cmd: './codex-acp',
              sha256: createHash('sha256').update('expected').digest('hex')
            }
          }
        },
        source: 'registry',
        enabled: false
      },
      null
    )

    expect(state).toMatchObject({
      status: 'error',
      error: 'SHA-256 checksum mismatch for ACP registry agent codex-acp'
    })
    expect(fs.existsSync(path.join(state.installDir!, 'codex-acp'))).toBe(false)
  })

  it('aborts a stalled registry binary download after the bounded timeout', async () => {
    const service = createService()
    const platformKey = getCurrentPlatformKey()
    const timeoutController = new AbortController()
    const timeoutSignal = timeoutController.signal
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal)
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const installPromise = service.ensureRegistryAgentInstalled(
      {
        id: 'codex-acp',
        name: 'Codex CLI',
        version: '0.10.0',
        distribution: {
          binary: {
            [platformKey]: {
              archive: 'https://example.com/codex.zip',
              cmd: './codex-acp'
            }
          }
        },
        source: 'registry',
        enabled: false
      },
      null
    )

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    timeoutController.abort(new DOMException('download timed out', 'TimeoutError'))

    await expect(installPromise).resolves.toMatchObject({
      status: 'error',
      error: 'download timed out'
    })
    expect(timeoutSpy).toHaveBeenCalledWith(120_000)
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/codex.zip', {
      signal: timeoutSignal
    })
  })

  it('uninstalls binary registry agents by removing the install directory', async () => {
    const service = createService()
    const platformKey = getCurrentPlatformKey()

    const agent = {
      id: 'codex-acp',
      name: 'Codex CLI',
      version: '0.10.0',
      distribution: {
        binary: {
          [platformKey]: {
            archive: 'https://example.com/codex.zip',
            cmd: './codex-acp'
          }
        }
      },
      source: 'registry' as const,
      enabled: false
    }

    const installDir = path.join(tempDirs[0], 'agents', agent.id, agent.version)
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(path.join(installDir, 'codex-acp'), 'binary')

    await service.uninstallRegistryAgent(agent, {
      status: 'installed',
      distributionType: 'binary',
      version: agent.version,
      installDir
    })

    expect(fs.existsSync(installDir)).toBeFalsy()
    expect(fs.existsSync(path.join(tempDirs[0], 'agents', agent.id))).toBeFalsy()
  })

  it('rejects uninstall paths outside the managed install root', async () => {
    const service = createService()
    const platformKey = getCurrentPlatformKey()

    await expect(
      service.uninstallRegistryAgent(
        {
          id: 'codex-acp',
          name: 'Codex CLI',
          version: '0.10.0',
          distribution: {
            binary: {
              [platformKey]: {
                archive: 'https://example.com/codex.zip',
                cmd: './codex-acp'
              }
            }
          },
          source: 'registry',
          enabled: false
        },
        {
          status: 'installed',
          distributionType: 'binary',
          version: '0.10.0',
          installDir: path.join(os.tmpdir(), 'outside-deepchat-acp')
        }
      )
    ).rejects.toThrow('Unsafe ACP install directory for uninstall')
  })
})
