import { afterEach, expect, it, vi } from 'vitest'
import type { VERTEX_PROVIDER } from '@shared/types/provider'
import { resolveVertexSettings } from '@/provider/vertexSettings'
import { DimProviderCredentials } from '@/agent/dim/providerCredentials'

afterEach(() => vi.unstubAllEnvs())

const provider = (options: Partial<VERTEX_PROVIDER> = {}): VERTEX_PROVIDER => ({
  id: 'vertex',
  name: 'Vertex',
  apiType: 'vertex',
  apiKey: '',
  baseUrl: '',
  enable: true,
  projectId: 'project-one',
  location: 'us-central1',
  ...options
})

it.each([
  ['global', 'aiplatform.googleapis.com'],
  ['us-central1', 'us-central1-aiplatform.googleapis.com'],
  ['eu', 'aiplatform.eu.rep.googleapis.com'],
  ['us', 'aiplatform.us.rep.googleapis.com']
])('preserves the Vertex project, API version and %s routing', (location, host) => {
  vi.stubEnv('GOOGLE_VERTEX_API_KEY', '')
  const result = resolveVertexSettings(provider({ location, apiVersion: 'v1beta1' }))
  expect(result.apiKey).toBe(false)
  expect(result.baseUrl).toBe(
    `https://${host}/v1beta1/projects/project-one/locations/${location}/publishers/google`
  )
})

it('keeps express keys out of public connection facts and preserves custom prefixes', () => {
  const result = resolveVertexSettings(
    provider({
      apiKey: 'private-api-key',
      baseUrl: 'https://proxy.test/vertex/v1/',
      projectId: '',
      location: ''
    })
  )
  expect(result).toMatchObject({
    apiKey: true,
    baseUrl: 'https://proxy.test/vertex/v1/publishers/google'
  })
  expect(JSON.stringify(result)).not.toContain('private-api-key')
})

it('rejects missing OAuth routing fields and malformed locations', () => {
  vi.stubEnv('GOOGLE_VERTEX_API_KEY', '')
  vi.stubEnv('GOOGLE_VERTEX_PROJECT', '')
  vi.stubEnv('GOOGLE_VERTEX_LOCATION', '')
  expect(() => resolveVertexSettings(provider({ projectId: '' }))).toThrow('project and location')
  expect(() => resolveVertexSettings(provider({ location: '../another-project' }))).toThrow(
    'location'
  )
})

it('keeps API key authentication in the existing secret owner', async () => {
  const vertexAuth = vi.fn()
  const owner = new DimProviderCredentials({ vertexAuth })
  expect(
    await owner.resolve(provider({ apiKey: 'protected-key' }), new AbortController().signal)
  ).toBe('protected-key')
  expect(vertexAuth).not.toHaveBeenCalled()
})

it('lets Google Auth own service-account refresh and replaces the client after key rotation', async () => {
  vi.stubEnv('GOOGLE_VERTEX_API_KEY', '')
  let version = 0
  const getAccessToken = vi.fn(async () => `access-token-${++version}`)
  const vertexAuth = vi.fn(() => ({ getAccessToken }))
  const owner = new DimProviderCredentials({ vertexAuth })
  const configured = provider({
    accountClientEmail: 'service@example.test',
    accountPrivateKey: 'private-key-one'
  })
  expect(await owner.resolve(configured, new AbortController().signal)).toBe('access-token-1')
  expect(vertexAuth).toHaveBeenLastCalledWith(
    expect.objectContaining({
      projectId: 'project-one',
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      credentials: { client_email: 'service@example.test', private_key: 'private-key-one' }
    })
  )
  await owner.resolve(configured, new AbortController().signal)
  expect(vertexAuth).toHaveBeenCalledTimes(1)
  configured.accountPrivateKey = 'private-key-two'
  await owner.resolve(configured, new AbortController().signal)
  expect(vertexAuth).toHaveBeenCalledTimes(2)
})

it('uses the application-default credential owner without synthesizing a service account', async () => {
  vi.stubEnv('GOOGLE_VERTEX_API_KEY', '')
  const vertexAuth = vi.fn(() => ({ getAccessToken: async () => 'adc-token' }))
  const owner = new DimProviderCredentials({ vertexAuth })
  expect(await owner.resolve(provider(), new AbortController().signal)).toBe('adc-token')
  expect(vertexAuth.mock.calls[0][0]).not.toHaveProperty('credentials')
})

it('refuses incomplete service accounts and discards token results after cancellation', async () => {
  vi.stubEnv('GOOGLE_VERTEX_API_KEY', '')
  let finish!: (value: string) => void
  const token = new Promise<string>((resolve) => {
    finish = resolve
  })
  const vertexAuth = vi.fn(() => ({ getAccessToken: () => token }))
  const owner = new DimProviderCredentials({ vertexAuth })
  await expect(
    owner.resolve(
      provider({ accountClientEmail: 'incomplete@example.test' }),
      new AbortController().signal
    )
  ).rejects.toThrow('Provider credential is unavailable')
  expect(vertexAuth).not.toHaveBeenCalled()
  const abort = new AbortController()
  const pending = owner.resolve(provider(), abort.signal).catch((error: unknown) => error)
  abort.abort(new Error('cancel Vertex authentication'))
  finish('discarded-access-token')
  expect(await pending).toMatchObject({ message: 'cancel Vertex authentication' })
})
