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
    discoveredMetadata: typeof metadata,
    expectedNonce?: string
  ) => Promise<{ sub?: string; exp?: number }>
  getValidIdentity: (
    profile: McpEnterpriseIdentityProfile
  ) => Promise<McpEnterpriseIdentityCredential>
}

const createManager = (credential: McpEnterpriseIdentityCredential) => {
  const saveEnterpriseIdentity = vi.fn(
    async (_key: string, value: Omit<McpEnterpriseIdentityCredential, 'updatedAt'>) => ({
      ...value,
      updatedAt: Date.now()
    })
  )
  const store = {
    loadEnterpriseIdentity: vi.fn(async () => credential),
    saveEnterpriseIdentity,
    loadEnterpriseIdentityClientSecret: vi.fn(async () => null)
  } as unknown as McpOAuthCredentialStore
  const settings = {
    getEnterpriseIdentityProfiles: vi.fn(() => [profile])
  } as unknown as McpSettings
  const manager = new McpEnterpriseIdentityManager(
    settings,
    store,
    vi.fn(),
    vi.fn(async () => undefined)
  )
  const testable = manager as unknown as TestableManager
  testable.discoverMetadata = vi.fn().mockResolvedValue(metadata)

  return { saveEnterpriseIdentity, testable, manager, store, settings }
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

  it.each(['stop', 'replace'] as const)(
    'rejects a pending identity read after %s',
    async (action) => {
      const credential: McpEnterpriseIdentityCredential = {
        profileId: profile.id,
        issuer: profile.issuer,
        clientId: profile.clientId,
        subject: 'user-1',
        idToken: 'stored-token',
        expiresAt: now + 600_000,
        updatedAt: now
      }
      const { manager, store, settings, saveEnterpriseIdentity } = createManager(credential)
      let finish!: (value: McpEnterpriseIdentityCredential) => void
      let entered!: () => void
      const reading = new Promise<void>((resolve) => {
        entered = resolve
      })
      vi.mocked(store.loadEnterpriseIdentity).mockImplementationOnce(() => {
        entered()
        return new Promise((resolve) => {
          finish = resolve
        })
      })
      const pending = manager.getStatus(profile.id)
      const rejected = expect(pending).rejects.toThrow(
        action === 'stop' ? 'interrupted' : 'profile changed'
      )
      await reading
      if (action === 'stop') manager.stop()
      else
        vi.mocked(settings.getEnterpriseIdentityProfiles).mockReturnValue([
          { ...profile, clientId: 'replacement' }
        ])
      finish(credential)
      await rejected
      expect(saveEnterpriseIdentity).not.toHaveBeenCalled()
    }
  )
  it.each(['another profile', 'same profile'] as const)(
    'retains edits to %s while clearing an old binding',
    async (change) => {
      let profiles = [profile]
      let finish!: () => void
      let entered!: () => void
      const clearing = new Promise<void>((resolve) => {
        entered = resolve
      })
      const store = {
        clearEnterpriseProfileCredentials: vi.fn(() => {
          entered()
          return new Promise<void>((resolve) => {
            finish = resolve
          })
        })
      } as unknown as McpOAuthCredentialStore
      const settings = {
        getEnterpriseIdentityProfiles: () => profiles,
        setEnterpriseIdentityProfiles: (next: McpEnterpriseIdentityProfile[]) => {
          profiles = next
        }
      } as unknown as McpSettings
      const manager = new McpEnterpriseIdentityManager(
        settings,
        store,
        vi.fn(),
        vi.fn(async () => undefined)
      )
      const pending = manager.saveProfile({ ...profile, clientId: 'replacement' })
      const result =
        change === 'same profile'
          ? expect(pending).rejects.toThrow('profile changed')
          : expect(pending).resolves.toMatchObject({ clientId: 'replacement' })
      await clearing
      await manager.saveProfile({
        ...profile,
        id: change === 'same profile' ? profile.id : 'second',
        label: 'Latest edit'
      })
      finish()
      await result
      expect(manager.listProfiles()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: change === 'same profile' ? profile.id : 'second',
            label: 'Latest edit',
            clientId: profile.clientId
          })
        ])
      )
      manager.stop()
    }
  )
})
