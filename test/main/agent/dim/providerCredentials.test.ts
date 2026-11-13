import { expect, it, vi } from 'vitest'
import type { AWS_BEDROCK_PROVIDER, LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import type { ProviderSettingsPort } from '@/provider/settings'
import { DimProviderCredentials } from '@/agent/dim/providerCredentials'
import { DimModelCatalog } from '@/agent/dim/modelCatalog'
import { createHash } from 'node:crypto'
import { dimDatabase } from './fixtures/database'

const aws = (): AWS_BEDROCK_PROVIDER => ({
  id: 'aws-bedrock',
  name: 'AWS',
  apiType: 'aws-bedrock',
  apiKey: '',
  baseUrl: '',
  enable: true,
  credential: { accessKeyId: 'access', secretAccessKey: 'private', region: 'eu-west-2' }
})
const signal = () => new AbortController().signal

it('passes explicit AWS credentials and session tokens without an SDK credential lookup', async () => {
  const awsChain = vi.fn()
  const owner = new DimProviderCredentials({ awsChain })
  const provider = aws()
  provider.credential!.sessionToken = 'temporary-session'
  expect(await owner.resolve(provider, signal())).toEqual({
    accessKeyId: 'access',
    secretAccessKey: 'private',
    sessionToken: 'temporary-session'
  })
  expect(awsChain).not.toHaveBeenCalled()
  provider.credential!.secretAccessKey = 'rotated'
  expect(await owner.resolve(provider, signal())).toMatchObject({ secretAccessKey: 'rotated' })
})

it('lets the AWS SDK own profile and default-chain refresh, scoped to profile and region', async () => {
  const resolve = vi.fn(async () => ({
    accessKeyId: 'chain-access',
    secretAccessKey: 'chain-private',
    sessionToken: 'chain-session'
  }))
  const awsChain = vi.fn(() => resolve)
  const owner = new DimProviderCredentials({ awsChain })
  const provider = aws()
  provider.credential = {
    authMode: 'profile',
    profile: 'work',
    accessKeyId: '',
    secretAccessKey: '',
    region: 'eu-west-2'
  }
  expect(await owner.resolve(provider, signal())).toEqual(await resolve())
  await owner.resolve(provider, signal())
  expect(awsChain).toHaveBeenCalledTimes(1)
  expect(awsChain).toHaveBeenLastCalledWith({
    profile: 'work',
    clientConfig: { region: 'eu-west-2' }
  })
  provider.credential.profile = 'personal'
  await owner.resolve(provider, signal())
  expect(awsChain).toHaveBeenLastCalledWith({
    profile: 'personal',
    clientConfig: { region: 'eu-west-2' }
  })
  provider.credential.region = 'us-east-2'
  await owner.resolve(provider, signal())
  expect(awsChain).toHaveBeenLastCalledWith({
    profile: 'personal',
    clientConfig: { region: 'us-east-2' }
  })
  provider.credential.authMode = 'accessKeys'
  await owner.resolve(provider, signal())
  expect(awsChain).toHaveBeenLastCalledWith({ clientConfig: { region: 'us-east-2' } })
})

it.each([
  { accessKeyId: 'incomplete', secretAccessKey: '' },
  { accessKeyId: '', secretAccessKey: 'incomplete' },
  { authMode: 'profile' as const, profile: '', accessKeyId: '', secretAccessKey: '' }
])('rejects incomplete AWS configuration without another credential source', async (credential) => {
  const awsChain = vi.fn()
  await expect(
    new DimProviderCredentials({ awsChain }).resolve({ ...aws(), credential }, signal())
  ).rejects.toThrow('Provider credential is unavailable')
  expect(awsChain).not.toHaveBeenCalled()
})

it('awaits an AWS credential lookup and refuses its result after cancellation', async () => {
  let finish!: (value: { accessKeyId: string; secretAccessKey: string }) => void
  const lookup = new Promise<{ accessKeyId: string; secretAccessKey: string }>((resolve) => {
    finish = resolve
  })
  const owner = new DimProviderCredentials({ awsChain: () => () => lookup })
  const provider = aws()
  provider.credential = undefined
  const abort = new AbortController()
  const pending = owner.resolve(provider, abort.signal).catch((error: unknown) => error)
  abort.abort(new Error('cancel authentication'))
  finish({ accessKeyId: 'discarded', secretAccessKey: 'discarded-private' })
  expect(await pending).toMatchObject({ message: 'cancel authentication' })
})

it('exchanges GitHub OAuth only for Copilot tokens, refreshes expiry and fences key rotation', async () => {
  let now = 1_000_000
  let version = 0
  const copilotToken = vi.fn(async () => ({
    token: `ephemeral-${++version}`,
    expires_at: (now + 100_000) / 1000
  }))
  const owner = new DimProviderCredentials({ copilotToken, now: () => now })
  const provider: LLM_PROVIDER = {
    id: 'github-copilot',
    name: 'Copilot',
    apiType: 'github-copilot',
    apiKey: 'github-oauth',
    baseUrl: 'https://api.githubcopilot.com',
    enable: true
  }
  const request = signal()
  expect(await owner.resolve(provider, request)).toBe('ephemeral-1')
  expect(copilotToken).toHaveBeenCalledWith('github-oauth', request)
  expect(await owner.resolve(provider, signal())).toBe('ephemeral-1')
  expect(copilotToken).toHaveBeenCalledTimes(1)
  now += 80_000
  expect(await owner.resolve(provider, signal())).toBe('ephemeral-2')
  provider.apiKey = 'rotated-oauth'
  expect(await owner.resolve(provider, signal())).toBe('ephemeral-3')
})

it('never caches cancelled Copilot exchanges or returns credential-bearing errors', async () => {
  let finish!: (value: { token: string; expires_at: number }) => void
  const pending = new Promise<{ token: string; expires_at: number }>((resolve) => {
    finish = resolve
  })
  const copilotToken = vi
    .fn()
    .mockReturnValueOnce(pending)
    .mockRejectedValueOnce(new Error('private-oauth-value'))
    .mockResolvedValue({ token: 'fresh-token', expires_at: Date.now() / 1000 + 100 })
  const owner = new DimProviderCredentials({ copilotToken })
  const provider = {
    ...aws(),
    id: 'github-copilot',
    apiType: 'github-copilot',
    apiKey: 'private-oauth-value'
  }
  const abort = new AbortController()
  const request = owner.resolve(provider, abort.signal).catch((error: unknown) => error)
  abort.abort(new Error('cancel exchange'))
  finish({ token: 'discarded-token', expires_at: Date.now() / 1000 + 100 })
  expect(await request).toMatchObject({ message: 'cancel exchange' })
  await expect(owner.resolve(provider, signal())).rejects.toThrow(
    'Provider credential is unavailable'
  )
  expect(await owner.resolve(provider, signal())).toBe('fresh-token')
  expect(copilotToken).toHaveBeenCalledTimes(3)
})

it('gives AWS profile changes immutable native identities and rejects stale async grants', async () => {
  const db = dimDatabase()
  const provider = aws()
  provider.credential = {
    authMode: 'profile',
    profile: 'work',
    accessKeyId: '',
    secretAccessKey: '',
    region: 'eu-west-2'
  }
  const configured: Array<{ providerId: string; connection: Record<string, unknown> }> = []
  let duringLookup: (() => void) | undefined
  const catalog = new DimModelCatalog({
    settings: {
      getProviderById: () => provider,
      getModelStatus: () => true,
      getModelConfig: () =>
        ({ contextLength: 8192, maxTokens: 1024, functionCall: true }) as ModelConfig,
      getProviderModelRouteMetadata: () => undefined,
      getCapabilitySnapshot: () =>
        ({ supportsReasoning: false, supportsAudioInput: false }) as ReturnType<
          ProviderSettingsPort['getCapabilitySnapshot']
        >
    },
    models: {
      configure: async (configuration) => {
        const providerId = createHash('sha256').update(JSON.stringify(configuration)).digest('hex')
        configured.push({ providerId, connection: configuration.connection })
        return { providerId, modelId: 'claude' }
      }
    },
    grants: db.data.dimProviderGrantsTable,
    credential: async () => {
      duringLookup?.()
      return { accessKeyId: 'private-access', secretAccessKey: 'private-key' }
    }
  })
  try {
    const first = await catalog.admit(provider.id, 'claude')
    const firstReference = (configured[0].connection.credential as { reference: string }).reference
    expect(configured[0].connection).toMatchObject({
      driverKind: 'amazon-bedrock',
      baseUrl: 'https://bedrock-runtime.eu-west-2.amazonaws.com',
      auth: { type: 'aws_bedrock' }
    })
    expect(JSON.stringify(configured)).not.toContain('private-key')
    provider.credential.profile = 'personal'
    await expect(catalog.credential(first.providerId, firstReference, signal())).rejects.toThrow(
      'replaced'
    )
    const second = await catalog.admit(provider.id, 'claude')
    expect(second.providerId).not.toBe(first.providerId)
    await expect(catalog.credential(first.providerId, firstReference, signal())).rejects.toThrow(
      'replaced'
    )
    const secondReference = (configured[1].connection.credential as { reference: string }).reference
    duringLookup = () => {
      provider.credential!.profile = 'work'
    }
    await expect(catalog.credential(second.providerId, secondReference, signal())).rejects.toThrow(
      'changed'
    )
  } finally {
    db.sqlite.close()
  }
})
