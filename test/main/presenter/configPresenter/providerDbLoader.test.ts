import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  getPath: vi.fn(),
  getAppPath: vi.fn(),
  send: vi.fn()
}))

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
    getPath: state.getPath,
    getAppPath: state.getAppPath
  }
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    send: state.send
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

describe('ProviderDbLoader', () => {
  let tempRoot: string
  let appRoot: string
  let userDataRoot: string

  const importLoader = async () => {
    const mod = await import('../../../../src/main/presenter/configPresenter/providerDbLoader')
    return mod.ProviderDbLoader
  }

  const getCacheDir = () => path.join(userDataRoot, 'provider-db')
  const getCacheFile = () => path.join(getCacheDir(), 'providers.json')
  const getMetaFile = () => path.join(getCacheDir(), 'meta.json')

  const createAggregate = (providerIds: string[]) => ({
    providers: Object.fromEntries(
      providerIds.map((providerId) => [
        providerId,
        {
          id: providerId,
          name: providerId,
          models: [
            {
              id: `${providerId}-model`
            }
          ]
        }
      ])
    )
  })

  const writeBuiltInDb = (aggregate: Record<string, unknown>) => {
    const modelDbDir = path.join(appRoot, 'resources', 'model-db')
    fs.mkdirSync(modelDbDir, { recursive: true })
    fs.writeFileSync(path.join(modelDbDir, 'providers.json'), JSON.stringify(aggregate), 'utf-8')
  }

  const writeCachedDb = (aggregate: Record<string, unknown>) => {
    fs.mkdirSync(getCacheDir(), { recursive: true })
    fs.writeFileSync(getCacheFile(), JSON.stringify(aggregate), 'utf-8')
  }

  const writeMeta = (meta: {
    sourceUrl: string
    etag?: string
    lastUpdated: number
    ttlHours: number
    lastAttemptedAt?: number
  }) => {
    fs.mkdirSync(getCacheDir(), { recursive: true })
    fs.writeFileSync(getMetaFile(), JSON.stringify(meta), 'utf-8')
  }

  const readMeta = () => JSON.parse(fs.readFileSync(getMetaFile(), 'utf-8'))

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-provider-db-'))
    appRoot = path.join(tempRoot, 'app-root')
    userDataRoot = path.join(tempRoot, 'user-data')
    fs.mkdirSync(appRoot, { recursive: true })
    fs.mkdirSync(userDataRoot, { recursive: true })

    state.getPath.mockImplementation((name: string) => {
      if (name === 'userData') return userDataRoot
      return userDataRoot
    })
    state.getAppPath.mockReturnValue(appRoot)
    state.send.mockReset()
    vi.unstubAllGlobals()
    delete process.env.PROVIDER_DB_TTL_HOURS
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.PROVIDER_DB_TTL_HOURS
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('initializes from cache and still triggers a startup refresh when cache is fresh', async () => {
    writeBuiltInDb(createAggregate(['builtin']))
    writeCachedDb(createAggregate(['openai']))
    const now = Date.now()
    writeMeta({
      sourceUrl: 'https://example.com/provider-db.json',
      etag: '"etag-1"',
      lastUpdated: now,
      lastAttemptedAt: now,
      ttlHours: 4
    })

    const fetchMock = vi.fn().mockResolvedValue({
      status: 304,
      ok: false,
      headers: {
        get: vi.fn().mockReturnValue('"etag-1"')
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const ProviderDbLoader = await importLoader()
    const loader = new ProviderDbLoader()

    await loader.initialize()

    expect(loader.getDb()?.providers).toHaveProperty('openai')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.send).toHaveBeenCalledWith('provider-db:loaded', 'ALL_WINDOWS', {
      providersCount: 1
    })
  })

  it('skips non-forced refreshes within the default 4-hour TTL', async () => {
    writeCachedDb(createAggregate(['openai']))
    const now = Date.now()
    writeMeta({
      sourceUrl: 'https://example.com/provider-db.json',
      lastUpdated: now - 5_000,
      lastAttemptedAt: now - 5_000,
      ttlHours: 4
    })

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const ProviderDbLoader = await importLoader()
    const loader = new ProviderDbLoader()

    const result = await loader.refreshIfNeeded(false)

    expect(result.status).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats 304 responses as fresh and avoids another fetch inside the TTL window', async () => {
    writeCachedDb(createAggregate(['openai']))
    const staleTimestamp = Date.now() - 10 * 3600 * 1000
    writeMeta({
      sourceUrl: 'https://example.com/provider-db.json',
      etag: '"etag-2"',
      lastUpdated: staleTimestamp,
      lastAttemptedAt: staleTimestamp,
      ttlHours: 4
    })

    const fetchMock = vi.fn().mockResolvedValue({
      status: 304,
      ok: false,
      headers: {
        get: vi.fn().mockReturnValue('"etag-2"')
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const ProviderDbLoader = await importLoader()
    const loader = new ProviderDbLoader()

    const result = await loader.refreshIfNeeded(true)

    expect(result.status).toBe('not-modified')
    expect(result.lastUpdated).toBe(staleTimestamp)

    const meta = readMeta()
    expect(meta.lastUpdated).toBe(staleTimestamp)
    expect(meta.lastAttemptedAt).toBeGreaterThan(staleTimestamp)

    fetchMock.mockClear()
    const nextResult = await loader.refreshIfNeeded(false)
    expect(nextResult.status).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('writes refreshed provider data and emits an update event on success', async () => {
    writeCachedDb(createAggregate(['openai']))

    const refreshedAggregate = createAggregate(['openai', 'anthropic'])
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: {
        get: vi.fn().mockReturnValue('"etag-3"')
      },
      text: vi.fn().mockResolvedValue(JSON.stringify(refreshedAggregate))
    })
    vi.stubGlobal('fetch', fetchMock)

    const ProviderDbLoader = await importLoader()
    const loader = new ProviderDbLoader()

    const result = await loader.refreshIfNeeded(true)

    expect(result.status).toBe('updated')
    expect(result.providersCount).toBe(2)
    expect(loader.getDb()?.providers).toHaveProperty('anthropic')
    expect(state.send).toHaveBeenCalledWith('provider-db:updated', 'ALL_WINDOWS', {
      providersCount: 2,
      lastUpdated: expect.any(Number)
    })
  })

  it('returns an error result and preserves the existing cache when refresh fails', async () => {
    const cachedAggregate = createAggregate(['openai'])
    writeCachedDb(cachedAggregate)
    const now = Date.now() - 10 * 3600 * 1000
    writeMeta({
      sourceUrl: 'https://example.com/provider-db.json',
      lastUpdated: now,
      lastAttemptedAt: now,
      ttlHours: 4
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const ProviderDbLoader = await importLoader()
    const loader = new ProviderDbLoader()

    const result = await loader.refreshIfNeeded(true)

    expect(result.status).toBe('error')
    expect(result.message).toBe('network down')
    expect(JSON.parse(fs.readFileSync(getCacheFile(), 'utf-8'))).toEqual(cachedAggregate)
    expect(readMeta().lastAttemptedAt).toBeGreaterThan(now)
  })
})
