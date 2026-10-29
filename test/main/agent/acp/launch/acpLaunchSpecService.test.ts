import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
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

  const binaryAgent = () => ({
    id: 'owned-agent',
    name: 'Owned agent',
    version: '1.0.0',
    distribution: {
      binary: {
        [getCurrentPlatformKey()]: {
          archive: 'https://example.com/owned-agent.zip',
          cmd: './owned-agent'
        }
      }
    },
    source: 'registry' as const,
    enabled: false
  })

  const deferred = <T>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((settle) => {
      resolve = settle
    })
    return { promise, resolve }
  }

  it('coalesces explicit and implicit installs and serializes a queued repair', async () => {
    const service = createService()
    const agent = binaryAgent()
    const body = deferred<Uint8Array>()
    const entered = deferred<void>()
    const archive = zipSync({ 'owned-agent': Buffer.from('binary') })
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => ({
        ok: true,
        arrayBuffer: () => {
          entered.resolve()
          return body.promise
        }
      }))
      .mockImplementation(async () => new Response(archive))
    vi.stubGlobal('fetch', fetchMock)

    const first = service.ensureRegistryAgentInstalled(agent, null)
    await entered.promise
    const second = service.ensureRegistryAgentInstalled(agent, null)
    const launch = service.resolveRegistryLaunchSpec(agent, null)
    const repair = service.ensureRegistryAgentInstalled(agent, null, { repair: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    body.resolve(archive)
    const [installed, shared, resolved, repaired] = await Promise.all([
      first,
      second,
      launch,
      repair
    ])
    expect(shared).toEqual(installed)
    expect(resolved.command).toBe(path.join(installed.installDir!, 'owned-agent'))
    expect(repaired.status).toBe('installed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['headers', 'body'])(
    'drains actual canceled %s and permits a fresh owner operation',
    async (phase) => {
      const service = createService()
      const agent = binaryAgent()
      const entered = deferred<void>()
      const release = deferred<void>()
      const archive = zipSync({ 'owned-agent': Buffer.from('binary') })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          if (phase === 'headers') {
            entered.resolve()
            await release.promise
          }
          return {
            ok: true,
            arrayBuffer: async () => {
              if (phase === 'body') {
                entered.resolve()
                await release.promise
              }
              return archive
            }
          }
        })
      )
      const rejected = expect(
        service.ensureRegistryAgentInstalled(agent, null)
      ).rejects.toMatchObject({ name: 'AbortError' })
      await entered.promise
      service.cancelPendingInstallations()
      let drained = false
      const drain = service.drain().then(() => {
        drained = true
      })
      await Promise.resolve()
      expect(drained).toBe(false)
      release.resolve()
      await Promise.all([rejected, drain])
      expect(fs.existsSync(path.join(tempDirs[0], 'agents', agent.id, agent.version))).toBe(false)
      expect(fs.readdirSync(path.join(tempDirs[0], 'agents', agent.id))).toEqual([])
      const state = await service.ensureRegistryAgentInstalled(agent, null)
      expect(state.status).toBe('installed')
    }
  )

  it('rejects new work after stop and waits for an uncancelable body before cleanup', async () => {
    const service = createService()
    const agent = binaryAgent()
    const entered = deferred<void>()
    const body = deferred<Uint8Array>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: () => {
          entered.resolve()
          return body.promise
        }
      }))
    )
    const rejected = expect(
      service.ensureRegistryAgentInstalled(agent, null)
    ).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    service.stop()
    let drained = false
    const drain = service.drain().then(() => {
      drained = true
    })
    await expect(service.ensureRegistryAgentInstalled(agent, null)).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(drained).toBe(false)
    body.resolve(zipSync({ 'owned-agent': Buffer.from('late') }))
    await Promise.all([rejected, drain])
    expect(fs.readdirSync(path.join(tempDirs[0], 'agents', agent.id))).toEqual([])
  })

  it('keeps the acknowledged binary when a staged repair fails validation', async () => {
    const service = createService()
    const agent = binaryAgent()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(zipSync({ 'owned-agent': Buffer.from('original') })))
    )
    const original = await service.ensureRegistryAgentInstalled(agent, null)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(zipSync({ 'wrong-agent': Buffer.from('bad') })))
    )
    const repaired = await service.ensureRegistryAgentInstalled(agent, original, { repair: true })
    expect(repaired.status).toBe('error')
    expect(fs.readFileSync(path.join(original.installDir!, 'owned-agent'), 'utf8')).toBe('original')
    expect(fs.readdirSync(path.dirname(original.installDir!))).toEqual([agent.version])
    fs.renameSync(original.installDir!, `${original.installDir}.prev`)
    const restored = await service.ensureRegistryAgentInstalled(agent, original)
    expect(restored.status).toBe('installed')
    expect(fs.readFileSync(path.join(restored.installDir!, 'owned-agent'), 'utf8')).toBe('original')
  })

  it('prevents canceled installs and queued repairs from recreating an uninstalled binary', async () => {
    const service = createService()
    const agent = binaryAgent()
    const entered = deferred<void>()
    const body = deferred<Uint8Array>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: () => {
          entered.resolve()
          return body.promise
        }
      }))
    )
    const install = expect(service.ensureRegistryAgentInstalled(agent, null)).rejects.toMatchObject(
      { name: 'AbortError' }
    )
    await entered.promise
    const repair = expect(
      service.ensureRegistryAgentInstalled(agent, null, { repair: true })
    ).rejects.toMatchObject({ name: 'AbortError' })
    const uninstall = service.uninstallRegistryAgent(agent, null)
    await expect(service.ensureRegistryAgentInstalled(agent, null)).rejects.toThrow(
      'uninstall is in progress'
    )
    body.resolve(zipSync({ 'owned-agent': Buffer.from('late') }))
    await Promise.all([install, repair, uninstall, service.drain()])
    expect(fs.existsSync(path.join(tempDirs[0], 'agents', agent.id))).toBe(false)
  })

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
      signal: expect.any(AbortSignal)
    })
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
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
