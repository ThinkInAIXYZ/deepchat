import { createPublicKey, verify, type JsonWebKey } from 'node:crypto'

export class ChatGPTIdentityError extends Error {
  constructor(message = 'ChatGPT identity could not be verified') {
    super(message)
    this.name = 'ChatGPTIdentityError'
  }
}

export interface ChatGPTIdentity {
  subject: string
  email?: string
}

type Jwk = JsonWebKey & { kid?: string }

function decodePart<T>(part: string): T {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf-8')) as T
  } catch {
    throw new ChatGPTIdentityError()
  }
}

/**
 * Verifies an RS256 ID token against the issuer's JWKS: signature, issuer, audience (the issued
 * client), authorized party, expiry and the attempt's nonce.
 */
export async function verifyChatGPTIdToken(options: {
  idToken: string
  issuer: string
  clientId: string
  nonce: string
  getKeys: (refresh: boolean) => Promise<Jwk[]>
  now?: number
}): Promise<ChatGPTIdentity> {
  const parts = options.idToken.split('.')
  if (parts.length !== 3) throw new ChatGPTIdentityError()
  const [encodedHeader, encodedClaims, encodedSignature] = parts
  const header = decodePart<{ alg?: unknown; kid?: unknown }>(encodedHeader)
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new ChatGPTIdentityError()
  }

  let key = (await options.getKeys(false)).find(
    (entry) => entry.kid === header.kid && entry.kty === 'RSA'
  )
  // Keys rotate; one refetch covers a token signed by a newly published key.
  key ??= (await options.getKeys(true)).find(
    (entry) => entry.kid === header.kid && entry.kty === 'RSA'
  )
  if (!key?.n || !key.e) throw new ChatGPTIdentityError()

  let valid = false
  try {
    valid = verify(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      createPublicKey({ key: { kty: 'RSA', n: key.n, e: key.e }, format: 'jwk' }),
      Buffer.from(encodedSignature, 'base64url')
    )
  } catch {
    valid = false
  }
  if (!valid) throw new ChatGPTIdentityError()

  const claims = decodePart<Record<string, unknown>>(encodedClaims)
  const audience = claims.aud
  const audienceValid = Array.isArray(audience)
    ? audience.includes(options.clientId) &&
      (audience.length === 1 || claims.azp === options.clientId)
    : audience === options.clientId
  const now = Math.floor((options.now ?? Date.now()) / 1000)
  if (
    claims.iss !== options.issuer ||
    !audienceValid ||
    (claims.azp !== undefined && claims.azp !== options.clientId) ||
    typeof claims.exp !== 'number' ||
    claims.exp <= now ||
    claims.nonce !== options.nonce ||
    typeof claims.sub !== 'string' ||
    !claims.sub.trim()
  ) {
    throw new ChatGPTIdentityError()
  }
  return {
    subject: claims.sub,
    ...(typeof claims.email === 'string' && claims.email ? { email: claims.email } : {})
  }
}
