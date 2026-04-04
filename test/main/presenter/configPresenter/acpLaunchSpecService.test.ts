import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AcpLaunchSpecService } from '../../../../src/main/presenter/configPresenter/acpLaunchSpecService'

describe('AcpLaunchSpecService', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    tempDirs.length = 0
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
    const platformMap: Record<string, string> = {
      darwin: 'darwin',
      linux: 'linux',
      win32: 'windows'
    }
    const archMap: Record<string, string> = {
      arm64: 'aarch64',
      x64: 'x86_64'
    }
    const platformKey = `${platformMap[process.platform]}-${archMap[process.arch]}`

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
    const platformMap: Record<string, string> = {
      darwin: 'darwin',
      linux: 'linux',
      win32: 'windows'
    }
    const archMap: Record<string, string> = {
      arm64: 'aarch64',
      x64: 'x86_64'
    }
    const platformKey = `${platformMap[process.platform]}-${archMap[process.arch]}`

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

  it('uninstalls binary registry agents by removing the install directory', async () => {
    const service = createService()
    const platformMap: Record<string, string> = {
      darwin: 'darwin',
      linux: 'linux',
      win32: 'windows'
    }
    const archMap: Record<string, string> = {
      arm64: 'aarch64',
      x64: 'x86_64'
    }
    const platformKey = `${platformMap[process.platform]}-${archMap[process.arch]}`

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
    const platformMap: Record<string, string> = {
      darwin: 'darwin',
      linux: 'linux',
      win32: 'windows'
    }
    const archMap: Record<string, string> = {
      arm64: 'aarch64',
      x64: 'x86_64'
    }
    const platformKey = `${platformMap[process.platform]}-${archMap[process.arch]}`

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
