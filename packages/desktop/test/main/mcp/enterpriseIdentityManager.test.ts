import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpEnterpriseIdentityManager } from '@/mcp/enterpriseIdentityManager'
import type {
  McpEnterpriseIdentityCredential,
  McpOAuthCredentialStore
} from '@/mcp/oauthCredentialStore'
import type { McpSettings } from '@/mcp/settings'
import type { McpEnterpriseIdentityProfile } from '@shared/types/mcp'

const profile: McpEnterpriseIdentityProfile = {
  id: 'work',
  label: 'Work',
  issuer: 'https://idp.example',
  clientId: 'deepchat',
  scopes: ['openid'],
  clientAuthentication: 'none'
}

const metadata = {
  issuer: profile.issuer,
  authorization_endpoint: `${profile.issuer}/authorize`,
  token_endpoint: `${profile.issuer}/token`,
  jwks_uri: `${profile.issuer}/jwks`
}

type TestableManager = {
  discoverMetadata: (profile: McpEnterpriseIdentityProfile) => Promise<typeof metadata>
  verifyIdToken: (
    token: string,
    profile: McpEnterpriseIdentityProfile,
    metadata: typeof metadata,
    expectedNonce?: string
  ) => Promise<{ sub?: string; exp?: number }>
  getValidIdentity: (
    profile: McpEnterpriseIdentityProfile
  ) => Promise<McpEnterpriseIdentityCredential>
}

const createManager = (credential: McpEnterpriseIdentityCredential) => {
  const saveEnterpriseIdentity = vi.fn(
    (
      _key: string,
      value: Omit<McpEnterpriseIdentityCredential, 'updatedAt'>
    ): McpEnterpriseIdentityCredential => ({ ...value, updatedAt: Date.now() })
  )
  const store = {
    loadEnterpriseIdentity: vi.fn(() => credential),
    saveEnterpriseIdentity,
    loadEnterpriseIdentityClientSecret: vi.fn(() => null)
  } as unknown as McpOAuthCredentialStore
  const settings = {
    getEnterpriseIdentityProfiles: vi.fn(() => [profile])
  } as unknown as McpSettings
  const manager = new McpEnterpriseIdentityManager(settings, store, vi.fn())
  const testable = manager as unknown as TestableManager
  testable.discoverMetadata = vi.fn().mockResolvedValue(metadata)

  return { saveEnterpriseIdentity, testable }
}

describe('McpEnterpriseIdentityManager refresh', () => {
  const now = Date.parse('2026-07-30T12:00:00Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps a valid stored ID token when the refresh response omits id_token', async () => {
    const credential: McpEnterpriseIdentityCredential = {
      profileId: profile.id,
      issuer: profile.issuer,
      clientId: profile.clientId,
      subject: 'user-1',
      idToken: 'stored-id-token',
      accessToken: 'old-access-token',
      refreshToken: 'refresh-token',
      expiresAt: now + 30_000,
      updatedAt: now
    }
    const { saveEnterpriseIdentity, testable } = createManager(credential)
    testable.verifyIdToken = vi.fn().mockResolvedValue({
      sub: credential.subject,
      exp: Math.floor(now / 1000) + 600
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'new-access-token', expires_in: 300 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    )

    const refreshed = await testable.getValidIdentity(profile)

    expect(testable.verifyIdToken).toHaveBeenCalledWith(credential.idToken, profile, metadata)
    expect(refreshed).toMatchObject({
      idToken: credential.idToken,
      accessToken: 'new-access-token',
      refreshToken: credential.refreshToken,
      subject: credential.subject,
      expiresAt: now + 300_000
    })
    expect(saveEnterpriseIdentity).toHaveBeenCalledOnce()
  })

  it('does not persist refreshed access when the stored ID token is no longer valid', async () => {
    const credential: McpEnterpriseIdentityCredential = {
      profileId: profile.id,
      issuer: profile.issuer,
      clientId: profile.clientId,
      subject: 'user-1',
      idToken: 'expired-id-token',
      refreshToken: 'refresh-token',
      expiresAt: now,
      updatedAt: now
    }
    const { saveEnterpriseIdentity, testable } = createManager(credential)
    testable.verifyIdToken = vi
      .fn()
      .mockRejectedValue(new Error('Enterprise identity ID token claims are invalid'))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'new-access-token', expires_in: 300 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    )

    await expect(testable.getValidIdentity(profile)).rejects.toThrow(
      'Enterprise identity ID token claims are invalid'
    )
    expect(testable.verifyIdToken).toHaveBeenCalledWith(credential.idToken, profile, metadata)
    expect(saveEnterpriseIdentity).not.toHaveBeenCalled()
  })
})
