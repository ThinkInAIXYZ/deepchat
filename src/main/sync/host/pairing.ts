import { randomBytes, timingSafeEqual } from 'node:crypto'
import { SYNC_HOST_PAIRING_CODE_TTL_MS } from '@shared/contracts/syncHost'

/** Unambiguous alphabet: no 0/O/1/I/L so codes survive being read aloud or retyped. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

export interface SyncHostPairingCode {
  code: string
  hostId: string
  expiresAt: number
}

function createCode(): string {
  // Rejection sampling: 248 is the largest multiple of the alphabet length below 256, so discarding
  // the top eight byte values removes the modulo bias entirely (the bias was ~1.4% and irrelevant
  // against the failure budget, but it is free to avoid).
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length
  let code = ''
  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (byte >= limit) continue
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
      if (code.length === CODE_LENGTH) break
    }
  }
  return code
}

function normalize(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '')
}

function codesEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

/**
 * One-time, short-lived pairing codes. Codes live in memory only: a host restart invalidates
 * every outstanding code, which is the intended failure direction.
 */
export class SyncHostPairingAuthority {
  private code: string | null = null
  private expiresAt = 0

  constructor(private readonly getHostId: () => string) {}

  create(input: { now?: number; ttlMs?: number } = {}): SyncHostPairingCode {
    const now = input.now ?? Date.now()
    const ttl = input.ttlMs ?? SYNC_HOST_PAIRING_CODE_TTL_MS
    this.code = createCode()
    this.expiresAt = now + ttl
    return this.describe()
  }

  current(now: number = Date.now()): SyncHostPairingCode | null {
    if (!this.code || this.expiresAt <= now) return null
    return this.describe()
  }

  /**
   * Consumes a presented code. Success is single-use.
   *
   * Failed attempts never invalidate or block the code. The endpoint is reachable by anyone who
   * learns the tunnel hostname, so any global penalty would hand an anonymous caller a permanent
   * denial of pairing. When a trusted client IP is available, the endpoint applies a per-source
   * budget; otherwise the five-minute code still has roughly 40 bits of entropy.
   */
  consume(presented: string, now: number = Date.now()): 'accepted' | 'invalid' | 'expired' {
    if (!this.code) return 'expired'
    if (this.expiresAt <= now) {
      this.clear()
      return 'expired'
    }

    const candidate = normalize(presented)
    if (!candidate || !codesEqual(candidate, this.code)) return 'invalid'
    this.clear()
    return 'accepted'
  }

  /**
   * Puts a consumed code back when the pairing it authorized could not be completed (device
   * issuance failed). Never clobbers a code the user created in the meantime, and never revives an
   * expired one.
   */
  restore(code: string, expiresAt: number, now: number = Date.now()): void {
    if (this.code || expiresAt <= now) return
    this.code = code
    this.expiresAt = expiresAt
  }

  clear(): void {
    this.code = null
    this.expiresAt = 0
  }

  private describe(): SyncHostPairingCode {
    return {
      code: this.code as string,
      hostId: this.getHostId(),
      expiresAt: this.expiresAt
    }
  }
}
