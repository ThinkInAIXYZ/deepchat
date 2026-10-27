import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AcpRegistryService,
  type AcpRegistryServiceOptions
} from '@/agent/acp/catalog/acpRegistryService'

const mockFetchIcon = vi.fn()

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    __esModule: true,
    ...actual,
    default: actual
  }
})

type RegistryManifestFixture = {
  version: string
  agents: Array<{
    id: string
    name: string
    version: string
    icon?: string
    distribution: {
      binary?: Record<
        string,
        {
          archive: string
          cmd: string
          sha256?: string
        }
      >
      npx?: {
        package: string
      }
    }
  }>
}

describe('AcpRegistryService', () => {
  let tempRoot: string
  let appRoot: string
  let userDataRoot: string

  const createService = (options: Partial<AcpRegistryServiceOptions> = {}) =>
    new AcpRegistryService({
      userDataDirectory: userDataRoot,
      builtInDirectory: path.join(appRoot, 'resources', 'acp-registry'),
      fetchIcon: mockFetchIcon,
      ...options
    })

  const writeBuiltInIcon = (agentId: string, markup: string) => {
    const iconDir = path.join(appRoot, 'resources', 'acp-registry', 'icons')
    fs.mkdirSync(iconDir, { recursive: true })
    fs.writeFileSync(path.join(iconDir, `${agentId}.svg`), markup, 'utf-8')
  }

  const writeBuiltInManifest = (manifest: RegistryManifestFixture) => {
    const registryDir = path.join(appRoot, 'resources', 'acp-registry')
    fs.mkdirSync(registryDir, { recursive: true })
    fs.writeFileSync(path.join(registryDir, 'registry.json'), JSON.stringify(manifest), 'utf-8')
  }

  const createManifest = (agentId = 'claude-acp'): RegistryManifestFixture => ({
    version: '1',
    agents: [
      {
        id: agentId,
        name: 'Claude Agent',
        version: '0.22.2',
        icon: `https://cdn.agentclientprotocol.com/registry/v1/latest/${agentId}.svg`,
        distribution: {
          npx: {
            package: '@zed-industries/claude-agent-acp@0.22.2'
          }
        }
      }
    ]
  })

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-acp-registry-'))
    appRoot = path.join(tempRoot, 'app-root')
    userDataRoot = path.join(tempRoot, 'user-data')
    fs.mkdirSync(appRoot, { recursive: true })
    fs.mkdirSync(userDataRoot, { recursive: true })

    mockFetchIcon.mockReset()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('falls back to bundled icon markup without network fetch in render path', async () => {
    writeBuiltInIcon(
      'claude-acp',
      '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h16v16H0z" /></svg>'
    )

    const service = createService()

    const markup = await service.getIconMarkup(
      'claude-acp',
      'https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg'
    )

    expect(markup).toContain('focusable="false"')
    expect(markup).toContain('color="currentColor"')
    expect(mockFetchIcon).not.toHaveBeenCalled()
  })

  it('skips the automatic registry refresh when privacy mode is enabled', async () => {
    const manifest = createManifest()
    writeBuiltInManifest(manifest)

    const globalFetch = vi.fn()
    vi.stubGlobal('fetch', globalFetch)

    const service = createService({
      isPrivacyModeEnabled: () => true
    })

    service.initialize()
    await service.refresh(false, { automatic: true })

    expect(globalFetch).not.toHaveBeenCalled()
    expect(service.listAgents()).toHaveLength(1)
  })

  it('preserves valid binary checksums while normalizing the registry', async () => {
    const checksum = 'A'.repeat(64)
    writeBuiltInManifest({
      version: '1',
      agents: [
        {
          id: 'binary-agent',
          name: 'Binary Agent',
          version: '1.0.0',
          distribution: {
            binary: {
              'darwin-aarch64': {
                archive: 'https://example.com/binary-agent.zip',
                cmd: './binary-agent',
                sha256: checksum
              }
            }
          }
        }
      ]
    })

    const service = createService({
      isPrivacyModeEnabled: () => true
    })

    await service.initialize()

    expect(service.listAgents()[0].distribution.binary?.['darwin-aarch64']?.sha256).toBe(
      checksum.toLowerCase()
    )
  })

  it('rejects binary targets with malformed checksums', async () => {
    writeBuiltInManifest({
      version: '1',
      agents: [
        {
          id: 'binary-agent',
          name: 'Binary Agent',
          version: '1.0.0',
          distribution: {
            binary: {
              'darwin-aarch64': {
                archive: 'https://example.com/binary-agent.zip',
                cmd: './binary-agent',
                sha256: 'not-a-checksum'
              }
            },
            npx: {
              package: 'binary-agent@1.0.0'
            }
          }
        }
      ]
    })

    const service = createService({
      isPrivacyModeEnabled: () => true
    })

    await service.initialize()

    expect(service.listAgents()[0].distribution).toEqual({
      npx: {
        package: 'binary-agent@1.0.0'
      }
    })
  })

  it('writes refreshed icon cache and prunes stale cached icons', async () => {
    const manifest = createManifest()
    const globalFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify(manifest))
    })
    vi.stubGlobal('fetch', globalFetch)

    mockFetchIcon.mockResolvedValue(
      '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h16v16H0z" /></svg>'
    )

    const staleIconDir = path.join(userDataRoot, 'acp-registry', 'icons')
    fs.mkdirSync(staleIconDir, { recursive: true })
    fs.writeFileSync(path.join(staleIconDir, 'obsolete.svg'), '<svg></svg>', 'utf-8')

    const service = createService()

    await service.refresh(true)

    expect(fs.existsSync(path.join(staleIconDir, 'claude-acp.svg'))).toBe(true)
    expect(fs.existsSync(path.join(staleIconDir, 'obsolete.svg'))).toBe(false)

    const markup = await service.getIconMarkup('claude-acp', manifest.agents[0].icon)
    expect(markup).toContain('currentColor')
    expect(mockFetchIcon).toHaveBeenCalledTimes(1)
  })

  it('keeps manual refresh available while privacy mode is enabled', async () => {
    const manifest = createManifest()
    writeBuiltInManifest(manifest)

    const globalFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify(manifest))
    })
    vi.stubGlobal('fetch', globalFetch)

    mockFetchIcon.mockResolvedValue(
      '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h16v16H0z" /></svg>'
    )

    const service = createService({
      isPrivacyModeEnabled: () => true
    })

    await service.refresh(true)

    expect(globalFetch).toHaveBeenCalledTimes(1)
    expect(mockFetchIcon).toHaveBeenCalledTimes(1)
  })

  it('preserves existing cached icon when refreshing a new icon fails', async () => {
    const manifest = createManifest()
    const globalFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify(manifest))
    })
    vi.stubGlobal('fetch', globalFetch)

    const iconDir = path.join(userDataRoot, 'acp-registry', 'icons')
    fs.mkdirSync(iconDir, { recursive: true })
    const oldMarkup = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h8v16H0z" /></svg>'
    fs.writeFileSync(path.join(iconDir, 'claude-acp.svg'), oldMarkup, 'utf-8')

    mockFetchIcon.mockRejectedValue(new Error('Service Unavailable'))

    const service = createService()

    await service.refresh(true)

    expect(fs.readFileSync(path.join(iconDir, 'claude-acp.svg'), 'utf-8')).toBe(oldMarkup)

    const markup = await service.getIconMarkup('claude-acp', manifest.agents[0].icon)
    expect(markup).toContain('currentColor')
  })

  it('rejects manifests with duplicate agent ids', async () => {
    const duplicateManifest: RegistryManifestFixture = {
      version: '1',
      agents: [createManifest('claude-acp').agents[0], createManifest('claude-acp').agents[0]]
    }
    const globalFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify(duplicateManifest))
    })
    vi.stubGlobal('fetch', globalFetch)

    const service = createService()

    await expect(service.refresh(true)).rejects.toThrow(
      '[ACP Registry] No registry snapshot is available.'
    )
  })

  it('loads the local catalog without starting detached network work', async () => {
    const manifest = createManifest()
    delete manifest.agents[0].icon
    writeBuiltInManifest(manifest)
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest)))
    vi.stubGlobal('fetch', fetch)
    const service = createService()

    service.initialize()
    expect(service.listAgents()[0].id).toBe('claude-acp')
    expect(fetch).not.toHaveBeenCalled()
    await service.refresh(false, { automatic: true })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each(['shutdown', 'task cancellation'])(
    'drains a held refresh and rejects late writes after %s',
    async (reason) => {
      const initial = createManifest('initial')
      writeBuiltInManifest(initial)
      const service = createService()
      service.initialize()
      const cache = path.join(userDataRoot, 'acp-registry', 'registry.json')
      const meta = path.join(userDataRoot, 'acp-registry', 'meta.json')
      fs.writeFileSync(cache, JSON.stringify(initial))
      fs.writeFileSync(meta, JSON.stringify({ version: '1', lastUpdated: 1 }))
      const original = [cache, meta].map((file) => fs.readFileSync(file, 'utf8'))
      let release!: (response: Response) => void
      let requestSignal!: AbortSignal
      const fetch = vi.fn((_url: string, options: { signal: AbortSignal }) => {
        requestSignal = options.signal
        return new Promise<Response>((resolve) => {
          release = resolve
        })
      })
      vi.stubGlobal('fetch', fetch)
      const caller = new AbortController()
      const refresh = service.refresh(true, { signal: caller.signal })
      const rejected = expect(refresh).rejects.toMatchObject({ name: 'AbortError' })
      const joined = expect(service.refresh(true)).rejects.toMatchObject({ name: 'AbortError' })
      expect(fetch).toHaveBeenCalledOnce()
      if (reason === 'shutdown') service.stop()
      else caller.abort()
      expect(requestSignal.aborted).toBe(true)
      let drained = false
      const drain = service.drain().then(() => {
        drained = true
      })
      await Promise.resolve()
      expect(drained).toBe(false)
      release(new Response(JSON.stringify(createManifest('late'))))
      await Promise.all([rejected, joined, drain])
      expect([cache, meta].map((file) => fs.readFileSync(file, 'utf8'))).toEqual(original)
      expect(service.listAgents()[0].id).toBe('initial')

      if (reason === 'task cancellation') {
        const next = createManifest('fresh')
        delete next.agents[0].icon
        fetch.mockResolvedValue(new Response(JSON.stringify(next)))
        expect((await service.refresh(true))[0].id).toBe('fresh')
      } else {
        await expect(service.refresh(true)).rejects.toMatchObject({ name: 'AbortError' })
        expect(fetch).toHaveBeenCalledOnce()
      }
    }
  )

  it.each(['manifest body', 'icon body'])(
    'fences a late %s and preserves the committed catalog on shutdown',
    async (phase) => {
      const initial = createManifest('initial')
      writeBuiltInManifest(initial)
      const service = createService()
      service.initialize()
      const cache = path.join(userDataRoot, 'acp-registry', 'registry.json')
      fs.writeFileSync(cache, JSON.stringify(initial))
      const original = fs.readFileSync(cache, 'utf8')
      let release!: (text: string) => void
      let entered!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const held = () => {
        entered()
        return new Promise<string>((resolve) => {
          release = resolve
        })
      }
      const next = createManifest('late')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          text: phase === 'manifest body' ? held : async () => JSON.stringify(next)
        })
      )
      mockFetchIcon.mockImplementation(held)
      const rejected = expect(service.refresh(true)).rejects.toMatchObject({ name: 'AbortError' })
      await started
      service.stop()
      release(phase === 'manifest body' ? JSON.stringify(next) : '<svg><path /></svg>')
      await Promise.all([rejected, service.drain()])
      expect(fs.readFileSync(cache, 'utf8')).toBe(original)
      expect(fs.existsSync(path.join(userDataRoot, 'acp-registry', 'icons', 'late.svg'))).toBe(
        false
      )
    }
  )
})
