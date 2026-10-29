import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const DEFAULT_PROVIDER_DB_URL =
  'https://raw.githubusercontent.com/ThinkInAIXYZ/PublicProviderConf/refs/heads/dev/dist/all.json'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    __esModule: true,
    ...actual,
    default: actual
  }
})

describe('ProviderDbLoader', () => {
  let tempRoot: string
  let appRoot: string
  let userDataRoot: string

  const importLoaderFactory = async () => {
    const mod = await import('../../../src/main/provider/providerDbLoader')
    return () => {
      const loader = new mod.ProviderDbLoader()
      loader.configure({
        userDataDirectory: userDataRoot,
        builtInCatalogPath: path.join(appRoot, 'resources', 'model-db', 'providers.json')
      })
      return loader
    }
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
    fs.writeFileSync(getMetaFile(), JSON.stringify({ schemaVersion: 2, ...meta }), 'utf-8')
  }

  const readMeta = () => JSON.parse(fs.readFileSync(getMetaFile(), 'utf-8'))

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-provider-db-'))
    appRoot = path.join(tempRoot, 'app-root')
    userDataRoot = path.join(tempRoot, 'user-data')
    fs.mkdirSync(appRoot, { recursive: true })
    fs.mkdirSync(userDataRoot, { recursive: true })

    vi.unstubAllGlobals()
    delete process.env.PROVIDER_DB_TTL_HOURS
    delete process.env.PROVIDER_DB_URL
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.PROVIDER_DB_TTL_HOURS
    delete process.env.PROVIDER_DB_URL
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('keeps imports inert until explicit profile bootstrap and rejects profile replacement', async () => {
    const { ProviderDbLoader } = await import('../../../src/main/provider/providerDbLoader')
    const loader = new ProviderDbLoader()
    expect(loader.getDb()).toBeNull()
    expect(fs.existsSync(getCacheDir())).toBe(false)
    await expect(loader.refreshIfNeeded(true)).rejects.toThrow('paths are required')
    loader.configure({
      userDataDirectory: userDataRoot,
      builtInCatalogPath: path.join(appRoot, 'resources', 'model-db', 'providers.json')
    })
    expect(() =>
      loader.configure({
        userDataDirectory: path.join(tempRoot, 'another-profile'),
        builtInCatalogPath: path.join(appRoot, 'resources', 'model-db', 'providers.json')
      })
    ).toThrow('another profile')
  })

  it('drains a stopped refresh without accepting late response headers', async () => {
    writeBuiltInDb(createAggregate(['builtin']))
    let release!: (response: Response) => void
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, options) => {
        signal = options.signal
        return new Promise<Response>((resolve) => {
          release = resolve
        })
      })
    )
    const createLoader = await importLoaderFactory()
    const loader = createLoader()
    expect(loader.getProvider('builtin')).toBeDefined()
    const changed = vi.fn()
    loader.subscribeCatalogChanges(changed)
    const refresh = loader.refreshIfNeeded(true)
    loader.stop()
    let drained = false
    const drain = loader.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(signal?.aborted).toBe(true)
    expect(drained).toBe(false)
    release(new Response(JSON.stringify(createAggregate(['late']))))
    expect((await refresh).status).toBe('skipped')
    await drain
    expect(changed).not.toHaveBeenCalled()
    expect(loader.getProvider('late')).toBeUndefined()
    expect(fs.existsSync(getCacheFile())).toBe(false)
    expect(fs.existsSync(getMetaFile())).toBe(false)
    expect((await loader.refreshIfNeeded(true)).status).toBe('skipped')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each(['shutdown', 'task cancellation'] as const)(
    'rejects a late body after %s without changing existing cache or metadata',
    async (reason) => {
      writeCachedDb(createAggregate(['cached']))
      const meta = { sourceUrl: DEFAULT_PROVIDER_DB_URL, lastUpdated: 1, ttlHours: 4 }
      writeMeta(meta)
      const originalMeta = fs.readFileSync(getMetaFile(), 'utf8')
      let bodyStarted!: () => void
      const started = new Promise<void>((resolve) => {
        bodyStarted = resolve
      })
      let release!: (value: string) => void
      const body = new Promise<string>((resolve) => {
        release = resolve
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          headers: new Headers({ etag: 'late' }),
          body: null,
          text: () => {
            bodyStarted()
            return body
          }
        }))
      )
      const createLoader = await importLoaderFactory()
      const loader = createLoader()
      const owner = new AbortController()
      const refresh = loader.refreshIfNeeded(true, { signal: owner.signal })
      await started
      if (reason === 'shutdown') loader.stop()
      else owner.abort()
      release(JSON.stringify(createAggregate(['late'])))
      expect((await refresh).status).toBe('skipped')
      await loader.drain()
      expect(JSON.parse(fs.readFileSync(getCacheFile(), 'utf8'))).toEqual(
        createAggregate(['cached'])
      )
      expect(fs.readFileSync(getMetaFile(), 'utf8')).toBe(originalMeta)
      if (reason === 'task cancellation') {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => new Response(JSON.stringify(createAggregate(['fresh']))))
        )
        expect((await loader.refreshIfNeeded(true)).status).toBe('updated')
        expect(loader.getProvider('fresh')).toBeDefined()
      }
    }
  )

  it('uses the explicit profile instead of the ambient E2E directory', async () => {
    const oldDir = process.env.DEEPCHAT_E2E_USER_DATA_DIR
    const e2eUserDataRoot = path.join(tempRoot, 'e2e-user-data')
    process.env.DEEPCHAT_E2E_USER_DATA_DIR = e2eUserDataRoot
    const createLoader = await importLoaderFactory()
    createLoader()
    expect(fs.existsSync(path.join(e2eUserDataRoot, 'provider-db'))).toBe(false)
    expect(fs.existsSync(getCacheDir())).toBe(true)
    if (oldDir === undefined) {
      delete process.env.DEEPCHAT_E2E_USER_DATA_DIR
    } else {
      process.env.DEEPCHAT_E2E_USER_DATA_DIR = oldDir
    }
  })

  it('loads cache without detaching work and permits an explicit automatic startup refresh', async () => {
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

    const createLoader = await importLoaderFactory()
    const loader = createLoader()
    const catalogChanged = vi.fn()
    loader.subscribeCatalogChanges(catalogChanged)

    await loader.initialize()

    expect(loader.getDb()?.providers).toHaveProperty('openai')
    expect(fetchMock).not.toHaveBeenCalled()
    await loader.refreshIfNeeded(true, { automatic: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(catalogChanged).toHaveBeenCalledWith({
      reason: 'loaded',
      providersCount: 1
    })
  })

  it('skips the automatic startup refresh when privacy mode is enabled', async () => {
    writeBuiltInDb(createAggregate(['builtin']))
    writeCachedDb(createAggregate(['openai']))

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const createLoader = await importLoaderFactory()
    const loader = createLoader()
    loader.setPrivacyModeResolver(() => true)

    await loader.initialize()

    expect(loader.getDb()?.providers).toHaveProperty('openai')
    await loader.refreshIfNeeded(true, { automatic: true })
    expect(fetchMock).not.toHaveBeenCalled()
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

    const createLoader = await importLoaderFactory()
    const loader = createLoader()

    const result = await loader.refreshIfNeeded(false)

    expect(result.status).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([undefined, 1])(
    'redownloads schema %s caches even with an unchanged ETag',
    async (schemaVersion) => {
      writeCachedDb(createAggregate(['zhipuai']))
      fs.writeFileSync(
        getMetaFile(),
        JSON.stringify({
          schemaVersion,
          sourceUrl: DEFAULT_PROVIDER_DB_URL,
          etag: '"same"',
          lastUpdated: Date.now(),
          ttlHours: 4
        })
      )
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              providers: {
                zhipuai: {
                  id: 'zhipuai',
                  models: [
                    {
                      id: 'glm-5.3',
                      reasoning: { supported: true },
                      reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }]
                    }
                  ]
                }
              }
            }),
            { status: 200, headers: { etag: '"same"' } }
          )
        )
        .mockResolvedValueOnce(new Response(null, { status: 304 }))
      vi.stubGlobal('fetch', fetchMock)
      const createLoader = await importLoaderFactory()
      const loader = createLoader()
      expect((await loader.refreshIfNeeded()).status).toBe('updated')
      expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('If-None-Match')
      expect(
        loader.getModel('zhipuai', 'glm-5.3')?.extra_capabilities?.reasoning?.effort_options
      ).toEqual(['low', 'high', 'max'])
      expect((await loader.refreshIfNeeded(true)).status).toBe('not-modified')
      expect(fetchMock.mock.calls[1][1].headers['If-None-Match']).toBe('"same"')
      expect(
        createLoader().getModel('zhipuai', 'glm-5.3')?.extra_capabilities?.reasoning?.effort_options
      ).toEqual(['low', 'high', 'max'])
    }
  )

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

    const createLoader = await importLoaderFactory()
    const loader = createLoader()

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

  it('writes refreshed provider data and notifies catalog listeners on success', async () => {
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

    const createLoader = await importLoaderFactory()
    const loader = createLoader()
    const catalogChanged = vi.fn()
    loader.subscribeCatalogChanges(catalogChanged)

    const result = await loader.refreshIfNeeded(true)

    expect(result.status).toBe('updated')
    expect(result.providersCount).toBe(2)
    expect(loader.getDb()?.providers).toHaveProperty('anthropic')
    expect(catalogChanged).toHaveBeenCalledWith({
      reason: 'updated',
      providersCount: 2,
      lastUpdated: expect.any(Number)
    })
  })

  it('uses the GitHub provider DB URL even when the legacy override env var is set', async () => {
    process.env.PROVIDER_DB_URL = 'https://cdn.example.invalid/provider-db.json'
    writeCachedDb(createAggregate(['openai']))

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: {
        get: vi.fn().mockReturnValue('"etag-github"')
      },
      text: vi.fn().mockResolvedValue(JSON.stringify(createAggregate(['openai', 'github'])))
    })
    vi.stubGlobal('fetch', fetchMock)

    const createLoader = await importLoaderFactory()
    const loader = createLoader()

    await loader.refreshIfNeeded(true)

    expect(fetchMock).toHaveBeenCalledWith(DEFAULT_PROVIDER_DB_URL, expect.any(Object))
  })

  it('keeps manual refresh available while privacy mode is enabled', async () => {
    writeCachedDb(createAggregate(['openai']))

    const refreshedAggregate = createAggregate(['openai', 'anthropic'])
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: {
        get: vi.fn().mockReturnValue('"etag-privacy"')
      },
      text: vi.fn().mockResolvedValue(JSON.stringify(refreshedAggregate))
    })
    vi.stubGlobal('fetch', fetchMock)

    const createLoader = await importLoaderFactory()
    const loader = createLoader()
    loader.setPrivacyModeResolver(() => true)

    const result = await loader.refreshIfNeeded(true)

    expect(result.status).toBe('updated')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(loader.getDb()?.providers).toHaveProperty('anthropic')
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

    const createLoader = await importLoaderFactory()
    const loader = createLoader()

    const result = await loader.refreshIfNeeded(true)

    expect(result.status).toBe('error')
    expect(result.message).toBe('network down')
    expect(JSON.parse(fs.readFileSync(getCacheFile(), 'utf-8'))).toEqual(cachedAggregate)
    expect(readMeta().lastAttemptedAt).toBeGreaterThan(now)
  })
})
