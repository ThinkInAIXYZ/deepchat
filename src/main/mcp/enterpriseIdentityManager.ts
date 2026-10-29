import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto'
import {
  CrossAppAccessProvider,
  discoverAndRequestJwtAuthGrant,
  validateAuthorizationResponseIssuer,
  type FetchLike,
  type OAuthClientProvider
} from '@modelcontextprotocol/client'
import type {
  MCPServerConfig,
  McpEnterpriseIdentityProfile,
  McpEnterpriseIdentityStatus
} from '@shared/types/mcp'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import {
  startOAuthLoopbackCallbackSession,
  type OAuthLoopbackCallbackSession
} from '../provider/auth/oauthLoopbackCallback'
import { MCP_OAUTH_CALLBACK_TIMEOUT_MS, MCP_OAUTH_REDIRECT_PORT } from './oauthConstants'
import type { McpSettings } from './settings'
import {
  type McpOAuthCredentialStore,
  type McpEnterpriseIdentityCredential
} from './oauthCredentialStore'

type OpenIdMetadata = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  grant_types_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
  authorization_response_iss_parameter_supported?: boolean
}

type PendingEnterpriseFlow = {
  profile: McpEnterpriseIdentityProfile
  state: string
  nonce: string
  codeVerifier: string
  redirectUri: string
  metadata: OpenIdMetadata
  callbackSession: OAuthLoopbackCallbackSession
  flowPromise?: Promise<void>
  assertActive(): void
}

type JwtHeader = {
  alg?: string
  kid?: string
}

type JwtPayload = {
  iss?: string
  sub?: string
  aud?: string | string[]
  azp?: string
  exp?: number
  iat?: number
  nbf?: number
  nonce?: string
  email?: string
  preferred_username?: string
  name?: string
}

const MAX_OIDC_DOCUMENT_BYTES = 4 * 1024 * 1024
const MAX_ID_TOKEN_BYTES = 64 * 1024
const MAX_OAUTH_TOKEN_BYTES = 256 * 1024
const MAX_OAUTH_SCOPE_BYTES = 8 * 1024
const MAX_JWKS_KEYS = 256
const OIDC_REQUEST_TIMEOUT_MS = 30_000

const encodeBase64Url = (value: Buffer): string =>
  value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const createPkcePair = (): { verifier: string; challenge: string } => {
  const verifier = encodeBase64Url(randomBytes(48))
  return {
    verifier,
    challenge: encodeBase64Url(createHash('sha256').update(verifier).digest())
  }
}

const normalizeScopes = (scopes: string[]): string[] =>
  Array.from(
    new Set([
      'openid',
      ...(Array.isArray(scopes) ? scopes : [])
        .filter((scope): scope is string => typeof scope === 'string')
        .map((scope) => scope.trim())
        .filter(Boolean)
    ])
  )

const resolveExpiresInSeconds = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, 30 * 24 * 60 * 60)
    : 3600

const encodeFormComponent = (value: string): string =>
  new URLSearchParams([['value', value]]).toString().slice('value='.length)

const readBoundedJson = async <T>(response: Response, label: string): Promise<T> => {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OIDC_DOCUMENT_BYTES) {
    throw new Error(`${label} exceeds the response size limit`)
  }
  if (!response.body) {
    throw new Error(`${label} returned an empty response`)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    total += value.byteLength
    if (total > MAX_OIDC_DOCUMENT_BYTES) {
      await reader.cancel()
      throw new Error(`${label} exceeds the response size limit`)
    }
    chunks.push(value)
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const parseJwtPart = <T extends Record<string, unknown>>(part: string): T => {
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part)) {
    throw new Error('Enterprise identity ID token is malformed')
  }
  const decoded = Buffer.from(part, 'base64url')
  if (encodeBase64Url(decoded) !== part) {
    throw new Error('Enterprise identity ID token is malformed')
  }
  const value: unknown = JSON.parse(decoded.toString('utf-8'))
  if (!isRecord(value)) {
    throw new Error('Enterprise identity ID token is malformed')
  }
  return value as T
}

const optionalBoundedString = (
  value: unknown,
  maxBytes: number,
  label: string
): string | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

const readIdentityTokenResponse = async (response: Response, label: string) => {
  const tokens = await readBoundedJson<{
    id_token?: string
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }>(response, label)
  return {
    idToken: optionalBoundedString(
      tokens.id_token,
      MAX_ID_TOKEN_BYTES,
      'Enterprise identity ID token'
    ),
    accessToken: optionalBoundedString(
      tokens.access_token,
      MAX_OAUTH_TOKEN_BYTES,
      'Enterprise identity access token'
    ),
    refreshToken: optionalBoundedString(
      tokens.refresh_token,
      MAX_OAUTH_TOKEN_BYTES,
      'Enterprise identity refresh token'
    ),
    scope: optionalBoundedString(tokens.scope, MAX_OAUTH_SCOPE_BYTES, 'Enterprise identity scope'),
    expiresInSeconds: resolveExpiresInSeconds(tokens.expires_in)
  }
}

const sameProfileBinding = (
  left: McpEnterpriseIdentityProfile,
  right: McpEnterpriseIdentityProfile
): boolean =>
  left.id === right.id &&
  left.issuer === right.issuer &&
  left.clientId === right.clientId &&
  left.clientAuthentication === right.clientAuthentication &&
  left.scopes.join('\n') === right.scopes.join('\n')

const profileKey = (
  credentialClass: 'enterprise_identity' | 'enterprise_identity_client_secret',
  profile: Pick<McpEnterpriseIdentityProfile, 'id' | 'issuer' | 'clientId'>
): string =>
  createHash('sha256')
    .update([credentialClass, profile.id, profile.issuer, profile.clientId].join('\n'))
    .digest('hex')

const isSecureIssuer = (value: string): boolean => {
  try {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          (url.hostname === '127.0.0.1' ||
            url.hostname === 'localhost' ||
            url.hostname === '[::1]')))
    )
  } catch {
    return false
  }
}

const statusError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/eyJ[A-Za-z0-9._~-]+/g, '[redacted-jwt]')
    .replace(/(?:access|refresh|id)_token["\s:=]+[^"'\s,}]+/gi, '[redacted-token]')
    .slice(0, 2048)
}

export class McpEnterpriseIdentityManager {
  private readonly pendingFlows = new Map<string, PendingEnterpriseFlow>()
  private readonly statuses = new Map<string, McpEnterpriseIdentityStatus>()
  private stopped = false
  private readonly generations = new Map<string, number>()

  private invalidate(id?: string): void {
    if (id) {
      this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
      this.cancelPendingFlow(id)
      this.statuses.delete(id)
    }
  }

  private captureOperation(id?: string): () => void {
    const generation = id ? (this.generations.get(id) ?? 0) : 0
    const check = () => {
      if (this.stopped || (id && generation !== (this.generations.get(id) ?? 0)))
        throw new Error('MCP enterprise identity operation interrupted')
    }
    check()
    return check
  }

  private captureProfile(profile: McpEnterpriseIdentityProfile): () => void {
    const check = this.captureOperation(profile.id)
    const assertCurrent = () => {
      check()
      if (!sameProfileBinding(this.requireProfile(profile.id), profile))
        throw new Error('MCP enterprise identity profile changed')
    }
    assertCurrent()
    return assertCurrent
  }

  stop(): void {
    this.stopped = true
    for (const id of this.pendingFlows.keys()) this.cancelPendingFlow(id)
    this.statuses.clear()
    this.generations.clear()
  }

  constructor(
    private readonly settings: McpSettings,
    private readonly store: McpOAuthCredentialStore,
    private readonly publishEvent: DeepchatEventPublisher,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly onProfileInvalidated?: (
      profileId: string,
      assertCurrent: () => void
    ) => Promise<void>
  ) {}
  listProfiles(): McpEnterpriseIdentityProfile[] {
    return this.settings.getEnterpriseIdentityProfiles().flatMap((profile) => {
      try {
        return [this.normalizeProfile(profile)]
      } catch {
        return []
      }
    })
  }
  async saveProfile(input: McpEnterpriseIdentityProfile): Promise<McpEnterpriseIdentityProfile> {
    const profile = this.normalizeProfile(input)
    const existing = this.listProfiles().find((item) => item.id === profile.id)
    const bindingChanged = Boolean(existing && !sameProfileBinding(existing, profile))
    if (bindingChanged) {
      this.invalidate(profile.id)
      this.cancelPendingFlow(profile.id)
    }
    const assertCurrent = this.captureOperation(profile.id)
    try {
      if (bindingChanged) {
        assertCurrent()
        await this.store.clearEnterpriseProfileCredentials(profile.id)
      }
      assertCurrent()
      const profiles = this.listProfiles()
      const current = profiles.find((item) => item.id === profile.id)
      if (
        bindingChanged &&
        (!current || !sameProfileBinding(existing!, current) || existing!.label !== current.label)
      )
        throw new Error('MCP enterprise identity profile changed')
      const next = [...profiles.filter((item) => item.id !== profile.id), profile].sort(
        (left, right) => left.label.localeCompare(right.label)
      )
      assertCurrent()
      this.settings.setEnterpriseIdentityProfiles(next)
      if (bindingChanged) {
        this.statuses.delete(profile.id)
        await this.onProfileInvalidated?.(profile.id, assertCurrent)
      }
      return profile
    } finally {
      assertCurrent()
    }
  }

  async removeProfile(profileId: string): Promise<void> {
    this.invalidate(profileId)
    const assertCurrent = this.captureOperation(profileId)
    try {
      this.cancelPendingFlow(profileId)
      assertCurrent()
      await this.store.clearEnterpriseProfileCredentials(profileId)
      assertCurrent()
      assertCurrent()
      this.settings.setEnterpriseIdentityProfiles(
        this.listProfiles().filter((profile) => profile.id !== profileId)
      )
      this.statuses.delete(profileId)
      await this.onProfileInvalidated?.(profileId, assertCurrent)
    } finally {
      assertCurrent()
    }
  }
  async setClientSecret(profileId: string, secret: string): Promise<McpEnterpriseIdentityStatus> {
    this.invalidate(profileId)
    const assertCurrent = this.captureProfile(this.requireProfile(profileId))
    try {
      const profile = this.requireProfile(profileId)
      if (profile.clientAuthentication !== 'client_secret') {
        throw new Error('Enterprise profile is not configured for client secret authentication')
      }
      if (!secret || secret.length > 8192) {
        throw new Error('Enterprise identity client secret is invalid')
      }
      assertCurrent()
      await this.store.saveEnterpriseIdentityClientSecret(
        profileKey('enterprise_identity_client_secret', profile),
        {
          profileId: profile.id,
          issuer: profile.issuer,
          clientId: profile.clientId,
          secret
        }
      )
      assertCurrent()
      return await this.getStatus(profileId)
    } finally {
      assertCurrent()
    }
  }
  async getStatus(profileId: string): Promise<McpEnterpriseIdentityStatus> {
    const assertCurrent = this.captureProfile(this.requireProfile(profileId))
    try {
      const profile = this.requireProfile(profileId)
      const clientSecretConfigured = await this.hasClientSecret(profile)
      assertCurrent()
      const pending = this.pendingFlows.get(profileId)
      if (pending) {
        return {
          profileId,
          state: 'authenticating',
          authenticated: false,
          persistent: await this.store.isPersistent(),
          clientSecretConfigured
        }
      }
      const credential = await this.loadIdentity(profile)
      assertCurrent()
      if (credential && (credential.expiresAt > Date.now() || Boolean(credential.refreshToken))) {
        return {
          profileId,
          state: 'authenticated',
          authenticated: true,
          persistent: await this.store.isPersistent(),
          clientSecretConfigured,
          subjectLabel: credential.subjectLabel,
          updatedAt: credential.updatedAt
        }
      }
      const existing = this.statuses.get(profileId)
      if (existing?.state === 'error') {
        return existing
      }
      return {
        profileId,
        state: 'signed_out',
        authenticated: false,
        persistent: await this.store.isPersistent(),
        clientSecretConfigured
      }
    } finally {
      assertCurrent()
    }
  }
  async startAuth(profileId: string): Promise<McpEnterpriseIdentityStatus> {
    this.invalidate(profileId)
    const assertCurrent = this.captureProfile(this.requireProfile(profileId))
    try {
      const profile = this.requireProfile(profileId)
      this.cancelPendingFlow(profileId)
      let flow: PendingEnterpriseFlow | null = null
      let callbackSession: OAuthLoopbackCallbackSession | null = null
      try {
        const metadata = await this.discoverMetadata(profile)
        assertCurrent()
        const state = encodeBase64Url(randomBytes(24))
        const nonce = encodeBase64Url(randomBytes(24))
        const pkce = createPkcePair()
        const callbackPath = `/mcp/enterprise/callback/${encodeBase64Url(randomBytes(12))}`
        callbackSession = await startOAuthLoopbackCallbackSession({
          expectedState: state,
          path: callbackPath,
          preferredPort: MCP_OAUTH_REDIRECT_PORT,
          redirectHost: 'localhost',
          timeoutMs: MCP_OAUTH_CALLBACK_TIMEOUT_MS,
          invalidCallbackMessage: 'Invalid enterprise identity callback',
          validateParameters: (parameters) => {
            validateAuthorizationResponseIssuer({
              iss: parameters.get('iss') || undefined,
              expectedIssuer: metadata.issuer,
              issParameterSupported:
                metadata.authorization_response_iss_parameter_supported === true
            })
          }
        })
        assertCurrent()
        const authorizationUrl = new URL(metadata.authorization_endpoint)
        authorizationUrl.searchParams.set('client_id', profile.clientId)
        authorizationUrl.searchParams.set('response_type', 'code')
        authorizationUrl.searchParams.set('redirect_uri', callbackSession.redirectUri)
        authorizationUrl.searchParams.set('scope', normalizeScopes(profile.scopes).join(' '))
        authorizationUrl.searchParams.set('state', state)
        authorizationUrl.searchParams.set('nonce', nonce)
        authorizationUrl.searchParams.set('code_challenge', pkce.challenge)
        authorizationUrl.searchParams.set('code_challenge_method', 'S256')
        flow = {
          profile,
          state,
          nonce,
          codeVerifier: pkce.verifier,
          redirectUri: callbackSession.redirectUri,
          metadata,
          callbackSession,
          assertActive: assertCurrent
        }
        assertCurrent()
        this.pendingFlows.set(profileId, flow)
        await this.setStatus(
          {
            profileId,
            state: 'authenticating',
            authenticated: false,
            persistent: await this.store.isPersistent()
          },
          assertCurrent
        )
        assertCurrent()
        flow.flowPromise = callbackSession
          .waitForCallback()
          .then(async (callback) => await this.finishAuth(flow!, callback.code))
          .catch(async (error) => await this.failAuth(flow!, error))
        assertCurrent()
        await this.openExternal(authorizationUrl.toString())
        assertCurrent()
        return await this.getStatus(profileId)
      } catch (error) {
        callbackSession?.close()
        assertCurrent()
        if (flow && this.pendingFlows.get(flow.profile.id) === flow)
          this.cancelPendingFlow(flow.profile.id)
        await this.setStatus(
          {
            profileId,
            state: 'error',
            authenticated: false,
            persistent: await this.store.isPersistent(),
            error: statusError(error)
          },
          assertCurrent
        )
        assertCurrent()
        return await this.getStatus(profileId)
      }
    } finally {
      assertCurrent()
    }
  }
  async completeAuthFromCallbackUrl(
    profileId: string,
    callbackUrl: string
  ): Promise<McpEnterpriseIdentityStatus> {
    const assertCurrent = this.captureProfile(this.requireProfile(profileId))
    try {
      const flow = this.pendingFlows.get(profileId)
      if (!flow) {
        return await this.getStatus(profileId)
      }
      const resolution = flow.callbackSession.resolveCallbackUrl(callbackUrl)
      if (resolution.kind === 'not-found') {
        await this.failAuth(flow, new Error('Enterprise identity callback URL is invalid'))
        assertCurrent()
        return await this.getStatus(profileId)
      }
      await flow.flowPromise
      assertCurrent()
      return await this.getStatus(profileId)
    } finally {
      assertCurrent()
    }
  }
  async logout(profileId: string): Promise<McpEnterpriseIdentityStatus> {
    this.invalidate(profileId)
    const assertCurrent = this.captureProfile(this.requireProfile(profileId))
    try {
      const profile = this.requireProfile(profileId)
      this.cancelPendingFlow(profileId)
      assertCurrent()
      await this.store.clearEntry(profileKey('enterprise_identity', profile))
      assertCurrent()
      await this.setStatus(
        {
          profileId,
          state: 'signed_out',
          authenticated: false,
          persistent: await this.store.isPersistent()
        },
        assertCurrent
      )
      assertCurrent()
      await this.onProfileInvalidated?.(profileId, assertCurrent)
      return await this.getStatus(profileId)
    } finally {
      assertCurrent()
    }
  }
  async createCrossAppProvider(
    config: MCPServerConfig,
    targetClientSecret: string,
    expectedIssuer: string
  ): Promise<OAuthClientProvider> {
    const profileId = config.authorization?.identityProfileId
    const targetClientId = config.authorization?.clientId
    if (!profileId || !targetClientId) {
      throw new Error('Enterprise authorization profile and target client ID are required')
    }
    const profile = this.requireProfile(profileId)
    this.captureProfile(profile)
    return new CrossAppAccessProvider({
      clientId: targetClientId,
      clientSecret: targetClientSecret,
      clientName: 'DeepChat',
      expectedIssuer,
      assertion: async (context) => {
        const assertProfileCurrent = this.captureProfile(profile)
        assertProfileCurrent()
        const identity = await this.getValidIdentity(profile)
        assertProfileCurrent()
        const idpClientSecret =
          profile.clientAuthentication === 'client_secret'
            ? (await this.store.loadEnterpriseIdentityClientSecret(
                profileKey('enterprise_identity_client_secret', profile)
              )) || undefined
            : undefined
        assertProfileCurrent()
        if (profile.clientAuthentication === 'client_secret' && !idpClientSecret) {
          throw new Error('Enterprise identity client secret is not configured')
        }
        const fetchFn: FetchLike = (input, init) =>
          context.fetchFn(input, { ...init, redirect: 'error' })
        assertProfileCurrent()
        const grant = await discoverAndRequestJwtAuthGrant({
          idpUrl: profile.issuer,
          audience: context.authorizationServerUrl,
          resource: context.resourceUrl,
          idToken: identity.idToken,
          clientId: profile.clientId,
          clientSecret: idpClientSecret,
          scope: context.scope,
          fetchFn
        })
        assertProfileCurrent()
        return grant.jwtAuthGrant
      }
    })
  }
  private async finishAuth(flow: PendingEnterpriseFlow, code: string): Promise<void> {
    if (this.stopped || this.pendingFlows.get(flow.profile.id) !== flow) return
    const assertCurrent = flow.assertActive
    try {
      const credential = await this.exchangeAuthorizationCode(flow, code)
      assertCurrent()
      if (
        this.pendingFlows.get(flow.profile.id) !== flow ||
        !sameProfileBinding(this.requireProfile(flow.profile.id), flow.profile)
      )
        return
      const existing = await this.loadIdentity(flow.profile)
      assertCurrent()
      if (existing && existing.subject !== credential.subject)
        throw new Error('A different enterprise subject is already signed in; sign out first')
      assertCurrent()
      await this.store.saveEnterpriseIdentity(
        profileKey('enterprise_identity', flow.profile),
        credential
      )
      assertCurrent()
      const persistent = await this.store.isPersistent()
      assertCurrent()
      if (this.pendingFlows.get(flow.profile.id) !== flow) return
      this.pendingFlows.delete(flow.profile.id)
      flow.callbackSession.close()
      await this.setStatus(
        {
          profileId: flow.profile.id,
          state: 'authenticated',
          authenticated: true,
          persistent,
          subjectLabel: credential.subjectLabel,
          updatedAt: Date.now()
        },
        assertCurrent
      )
      assertCurrent()
    } catch (error) {
      await this.failAuth(flow, error)
      assertCurrent()
    }
  }

  private async failAuth(flow: PendingEnterpriseFlow, error: unknown): Promise<void> {
    if (this.stopped || this.pendingFlows.get(flow.profile.id) !== flow) return
    const assertCurrent = flow.assertActive
    try {
      const persistent = await this.store.isPersistent()
      assertCurrent()
      if (this.pendingFlows.get(flow.profile.id) !== flow) return
      this.pendingFlows.delete(flow.profile.id)
      flow.callbackSession.close()
      await this.setStatus(
        {
          profileId: flow.profile.id,
          state: 'error',
          authenticated: false,
          persistent,
          error: statusError(error)
        },
        assertCurrent
      )
      assertCurrent()
    } catch (failure) {
      if (this.stopped || this.pendingFlows.get(flow.profile.id) !== flow) return
      throw failure
    }
  }

  private cancelPendingFlow(profileId: string): void {
    const flow = this.pendingFlows.get(profileId)
    if (!flow) {
      return
    }
    this.pendingFlows.delete(profileId)
    flow.callbackSession.close()
  }
  private async setStatus(
    status: Omit<McpEnterpriseIdentityStatus, 'clientSecretConfigured'> & {
      clientSecretConfigured?: boolean
    },
    assertCurrent: () => void
  ): Promise<void> {
    const profile = this.listProfiles().find((item) => item.id === status.profileId)
    const next = {
      ...status,
      clientSecretConfigured: profile ? await this.hasClientSecret(profile) : false,
      updatedAt: status.updatedAt || Date.now()
    }
    assertCurrent()
    this.statuses.set(status.profileId, next)
    this.publishEvent('mcp.enterprise.auth.changed', {
      status: next,
      version: Date.now()
    })
  }
  private requireProfile(profileId: string): McpEnterpriseIdentityProfile {
    const profile = this.listProfiles().find((item) => item.id === profileId)
    if (!profile) {
      throw new Error(`Enterprise identity profile ${profileId} not found`)
    }
    return profile
  }
  private normalizeProfile(input: McpEnterpriseIdentityProfile): McpEnterpriseIdentityProfile {
    const profile = {
      id: input.id.trim(),
      label: input.label.trim(),
      issuer: input.issuer.trim(),
      clientId: input.clientId.trim(),
      scopes: normalizeScopes(input.scopes),
      clientAuthentication: input.clientAuthentication
    }
    if (
      !profile.id ||
      !profile.label ||
      !profile.clientId ||
      !isSecureIssuer(profile.issuer) ||
      !['none', 'client_secret'].includes(profile.clientAuthentication)
    ) {
      throw new Error('Enterprise identity profile is invalid')
    }
    return profile
  }
  private async hasClientSecret(profile: McpEnterpriseIdentityProfile): Promise<boolean> {
    if (profile.clientAuthentication !== 'client_secret') {
      return false
    }
    return Boolean(
      await this.store.loadEnterpriseIdentityClientSecret(
        profileKey('enterprise_identity_client_secret', profile)
      )
    )
  }
  private async discoverMetadata(profile: McpEnterpriseIdentityProfile): Promise<OpenIdMetadata> {
    const issuer = new URL(profile.issuer)
    const issuerPath = issuer.pathname === '/' ? '' : issuer.pathname.replace(/\/$/, '')
    const metadataUrl = new URL(`${issuerPath}/.well-known/openid-configuration`, issuer.origin)
    const response = await fetch(metadataUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(OIDC_REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) {
      throw new Error(`Enterprise identity discovery failed (${response.status})`)
    }
    const metadata = await readBoundedJson<Partial<OpenIdMetadata>>(
      response,
      'Enterprise identity discovery'
    )
    if (
      metadata.issuer !== profile.issuer ||
      !metadata.authorization_endpoint ||
      !metadata.token_endpoint ||
      !metadata.jwks_uri
    ) {
      throw new Error('Enterprise identity metadata is invalid')
    }
    for (const endpoint of [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.jwks_uri
    ]) {
      if (!isSecureIssuer(endpoint)) {
        throw new Error('Enterprise identity metadata contains an insecure endpoint')
      }
    }
    if (
      metadata.grant_types_supported &&
      !metadata.grant_types_supported.includes('authorization_code')
    ) {
      throw new Error('Enterprise identity provider does not support authorization code')
    }
    return metadata as OpenIdMetadata
  }
  private async exchangeAuthorizationCode(
    flow: PendingEnterpriseFlow,
    code: string
  ): Promise<Omit<McpEnterpriseIdentityCredential, 'updatedAt'>> {
    const assertCurrent = flow.assertActive
    assertCurrent()

    const parameters = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: flow.profile.clientId,
      redirect_uri: flow.redirectUri,
      code_verifier: flow.codeVerifier
    })
    const headers = new Headers({
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    })
    await this.applyIdpClientAuthentication(flow.profile, flow.metadata, parameters, headers)
    assertCurrent()
    const response = await fetch(flow.metadata.token_endpoint, {
      method: 'POST',
      headers,
      body: parameters,
      redirect: 'error',
      signal: AbortSignal.timeout(OIDC_REQUEST_TIMEOUT_MS)
    })
    assertCurrent()
    if (!response.ok) {
      throw new Error(`Enterprise identity token exchange failed (${response.status})`)
    }
    const tokens = await readIdentityTokenResponse(response, 'Enterprise identity token response')
    assertCurrent()
    if (!tokens.idToken) {
      throw new Error('Enterprise identity response did not include an ID token')
    }
    const payload = await this.verifyIdToken(
      tokens.idToken,
      flow.profile,
      flow.metadata,
      flow.nonce
    )
    assertCurrent()
    return {
      profileId: flow.profile.id,
      issuer: flow.profile.issuer,
      clientId: flow.profile.clientId,
      subject: payload.sub!,
      subjectLabel: payload.email || payload.preferred_username || payload.name || payload.sub,
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Math.min(
        (payload.exp || Math.floor(Date.now() / 1000) + 300) * 1000,
        Date.now() + tokens.expiresInSeconds * 1000
      ),
      scope: tokens.scope
    }
  }
  private async applyIdpClientAuthentication(
    profile: McpEnterpriseIdentityProfile,
    metadata: OpenIdMetadata,
    parameters: URLSearchParams,
    headers: Headers
  ): Promise<void> {
    const assertCurrent = this.captureProfile(profile)
    try {
      if (profile.clientAuthentication === 'none') {
        return
      }
      const secret = await this.store.loadEnterpriseIdentityClientSecret(
        profileKey('enterprise_identity_client_secret', profile)
      )
      assertCurrent()
      if (!secret) {
        throw new Error('Enterprise identity client secret is not configured')
      }
      const methods = metadata.token_endpoint_auth_methods_supported || ['client_secret_basic']
      if (methods.includes('client_secret_basic')) {
        headers.set(
          'Authorization',
          `Basic ${Buffer.from(`${encodeFormComponent(profile.clientId)}:${encodeFormComponent(secret)}`).toString('base64')}`
        )
        return
      }
      if (methods.includes('client_secret_post')) {
        parameters.set('client_secret', secret)
        return
      }
      throw new Error('Enterprise identity provider does not support the configured client auth')
    } finally {
      assertCurrent()
    }
  }
  private async getValidIdentity(
    profile: McpEnterpriseIdentityProfile
  ): Promise<McpEnterpriseIdentityCredential> {
    const assertCurrent = this.captureProfile(profile)
    try {
      const current = await this.loadIdentity(profile)
      assertCurrent()
      if (!current) {
        throw new Error('Enterprise identity sign-in is required')
      }
      if (current.expiresAt > Date.now() + 60000) {
        return current
      }
      if (!current.refreshToken) {
        throw new Error('Enterprise identity sign-in has expired')
      }
      const metadata = await this.discoverMetadata(profile)
      assertCurrent()
      const parameters = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
        client_id: profile.clientId
      })
      const headers = new Headers({
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      })
      await this.applyIdpClientAuthentication(profile, metadata, parameters, headers)
      assertCurrent()
      const response = await fetch(metadata.token_endpoint, {
        method: 'POST',
        headers,
        body: parameters,
        redirect: 'error',
        signal: AbortSignal.timeout(OIDC_REQUEST_TIMEOUT_MS)
      })
      assertCurrent()
      if (!response.ok) {
        throw new Error(`Enterprise identity refresh failed (${response.status})`)
      }
      const tokens = await readIdentityTokenResponse(
        response,
        'Enterprise identity refresh response'
      )
      assertCurrent()
      const idToken = tokens.idToken || current.idToken
      const payload = await this.verifyIdToken(idToken, profile, metadata)
      assertCurrent()
      if (payload.sub !== current.subject) {
        throw new Error('Enterprise identity subject changed during refresh')
      }
      assertCurrent()
      return await this.store.saveEnterpriseIdentity(profileKey('enterprise_identity', profile), {
        ...current,
        idToken,
        accessToken: tokens.accessToken || current.accessToken,
        refreshToken: tokens.refreshToken || current.refreshToken,
        expiresAt: Math.min(
          (payload.exp || Math.floor(Date.now() / 1000) + 300) * 1000,
          Date.now() + tokens.expiresInSeconds * 1000
        ),
        scope: tokens.scope || current.scope
      })
    } finally {
      assertCurrent()
    }
  }
  private async loadIdentity(
    profile: McpEnterpriseIdentityProfile
  ): Promise<McpEnterpriseIdentityCredential | null> {
    return await this.store.loadEnterpriseIdentity(profileKey('enterprise_identity', profile))
  }
  private async verifyIdToken(
    token: string,
    profile: McpEnterpriseIdentityProfile,
    metadata: OpenIdMetadata,
    expectedNonce?: string
  ): Promise<JwtPayload> {
    if (Buffer.byteLength(token, 'utf8') > MAX_ID_TOKEN_BYTES) {
      throw new Error('Enterprise identity ID token is oversized')
    }
    const parts = token.split('.')
    if (parts.length !== 3) {
      throw new Error('Enterprise identity ID token is malformed')
    }
    const header = parseJwtPart<JwtHeader & Record<string, unknown>>(parts[0])
    const payload = parseJwtPart<JwtPayload & Record<string, unknown>>(parts[1])
    const now = Date.now()
    if (
      typeof header.kid !== 'string' ||
      !header.kid ||
      header.kid.length > 512 ||
      !['RS256', 'ES256'].includes(header.alg || '')
    ) {
      throw new Error('Enterprise identity ID token algorithm is unsupported')
    }
    const audiences =
      typeof payload.aud === 'string'
        ? [payload.aud]
        : Array.isArray(payload.aud) &&
            payload.aud.length > 0 &&
            payload.aud.length <= 32 &&
            payload.aud.every((audience) => typeof audience === 'string' && audience.length <= 2048)
          ? payload.aud
          : []
    if (
      payload.iss !== profile.issuer ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      payload.sub.length > 2048 ||
      typeof payload.exp !== 'number' ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp * 1000 <= now ||
      (payload.iat != null &&
        (typeof payload.iat !== 'number' ||
          !Number.isSafeInteger(payload.iat) ||
          payload.iat * 1000 > now + 60000)) ||
      (payload.nbf != null &&
        (typeof payload.nbf !== 'number' ||
          !Number.isSafeInteger(payload.nbf) ||
          payload.nbf * 1000 > now + 60000)) ||
      (expectedNonce != null && payload.nonce !== expectedNonce)
    ) {
      throw new Error('Enterprise identity ID token claims are invalid')
    }
    if (!audiences.includes(profile.clientId)) {
      throw new Error('Enterprise identity ID token audience is invalid')
    }
    if (
      (payload.azp !== undefined && payload.azp !== profile.clientId) ||
      (audiences.length > 1 && payload.azp !== profile.clientId)
    ) {
      throw new Error('Enterprise identity ID token authorized party is invalid')
    }
    const jwksResponse = await fetch(metadata.jwks_uri, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(OIDC_REQUEST_TIMEOUT_MS)
    })
    if (!jwksResponse.ok) {
      throw new Error(`Enterprise identity JWKS request failed (${jwksResponse.status})`)
    }
    const jwks = await readBoundedJson<{
      keys?: Array<Record<string, unknown>>
    }>(jwksResponse, 'Enterprise identity JWKS')
    if (!Array.isArray(jwks.keys) || jwks.keys.length > MAX_JWKS_KEYS) {
      throw new Error('Enterprise identity JWKS is invalid')
    }
    const jwk = jwks.keys?.find((key) => {
      const keyOps = Array.isArray(key.key_ops) ? key.key_ops : undefined
      return (
        key.kid === header.kid &&
        (key.alg === undefined || key.alg === header.alg) &&
        (key.use === undefined || key.use === 'sig') &&
        (!keyOps || keyOps.includes('verify')) &&
        (header.alg === 'RS256' ? key.kty === 'RSA' : key.kty === 'EC' && key.crv === 'P-256')
      )
    })
    if (!jwk) {
      throw new Error('Enterprise identity signing key is unavailable')
    }
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' })
    if (!parts[2] || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
      throw new Error('Enterprise identity ID token signature is invalid')
    }
    const signature = Buffer.from(parts[2], 'base64url')
    if (encodeBase64Url(signature) !== parts[2]) {
      throw new Error('Enterprise identity ID token signature is invalid')
    }
    const verified = verifySignature(
      'sha256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      header.alg === 'ES256' ? { key: publicKey, dsaEncoding: 'ieee-p1363' } : publicKey,
      signature
    )
    if (!verified) {
      throw new Error('Enterprise identity ID token signature is invalid')
    }
    return payload
  }
}
