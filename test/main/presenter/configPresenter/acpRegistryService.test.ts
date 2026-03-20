import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetPath = vi.fn()
const mockGetAppPath = vi.fn()
const mockNetFetch = vi.fn()

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    __esModule: true,
    ...actual,
    default: actual
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: mockGetPath,
    getAppPath: mockGetAppPath
  },
  net: {
    fetch: mockNetFetch
  }
}))

type RegistryManifestFixture = {
  version: string
  agents: Array<{
    id: string
    name: string
    version: string
    icon?: string
    distribution: {
      npx: {
        package: string
      }
    }
  }>
}

describe('AcpRegistryService', () => {
  let tempRoot: string
  let appRoot: string
  let userDataRoot: string

  const importService = async () => {
    const mod = await import('../../../../src/main/presenter/configPresenter/acpRegistryService')
    return mod.AcpRegistryService
  }

  const writeBuiltInIcon = (agentId: string, markup: string) => {
    const iconDir = path.join(appRoot, 'resources', 'acp-registry', 'icons')
    fs.mkdirSync(iconDir, { recursive: true })
    fs.writeFileSync(path.join(iconDir, `${agentId}.svg`), markup, 'utf-8')
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

    mockGetPath.mockImplementation((name: string) => {
      if (name === 'userData') {
        return userDataRoot
      }
      return userDataRoot
    })
    mockGetAppPath.mockReturnValue(appRoot)
    mockNetFetch.mockReset()
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

    const AcpRegistryService = await importService()
    const service = new AcpRegistryService()

    const markup = await service.getIconMarkup(
      'claude-acp',
      'https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg'
    )

    expect(markup).toContain('focusable="false"')
    expect(markup).toContain('color="currentColor"')
    expect(mockNetFetch).not.toHaveBeenCalled()
  })

  it('writes refreshed icon cache and prunes stale cached icons', async () => {
    const manifest = createManifest()
    const globalFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify(manifest))
    })
    vi.stubGlobal('fetch', globalFetch)

    mockNetFetch.mockResolvedValue({
      ok: true,
      text: vi
        .fn()
        .mockResolvedValue(
          '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h16v16H0z" /></svg>'
        )
    })

    const staleIconDir = path.join(userDataRoot, 'acp-registry', 'icons')
    fs.mkdirSync(staleIconDir, { recursive: true })
    fs.writeFileSync(path.join(staleIconDir, 'obsolete.svg'), '<svg></svg>', 'utf-8')

    const AcpRegistryService = await importService()
    const service = new AcpRegistryService()

    await service.refresh(true)

    expect(fs.existsSync(path.join(staleIconDir, 'claude-acp.svg'))).toBe(true)
    expect(fs.existsSync(path.join(staleIconDir, 'obsolete.svg'))).toBe(false)

    const markup = await service.getIconMarkup('claude-acp', manifest.agents[0].icon)
    expect(markup).toContain('currentColor')
    expect(mockNetFetch).toHaveBeenCalledTimes(1)
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

    mockNetFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable'
    })

    const AcpRegistryService = await importService()
    const service = new AcpRegistryService()

    await service.refresh(true)

    expect(fs.readFileSync(path.join(iconDir, 'claude-acp.svg'), 'utf-8')).toBe(oldMarkup)

    const markup = await service.getIconMarkup('claude-acp', manifest.agents[0].icon)
    expect(markup).toContain('currentColor')
  })
})
