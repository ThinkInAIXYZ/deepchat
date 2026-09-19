import crypto from 'crypto'

function base64Url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function createOpenAICodexState(): string {
  return base64Url(crypto.randomBytes(32))
}

export function createOpenAICodexPkcePair(): {
  codeVerifier: string
  codeChallenge: string
} {
  const codeVerifier = base64Url(crypto.randomBytes(32))
  const digest = crypto.createHash('sha256').update(codeVerifier).digest()
  return {
    codeVerifier,
    codeChallenge: base64Url(digest)
  }
}
