import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  SYNC_HOST_PAIRING_CODE_TTL_MS,
  SYNC_HOST_PAIRING_MAX_ATTEMPTS
} from '@shared/contracts/syncHost'

/** Unambiguous alphabet: no 0/O/1/I/L so codes survive being read aloud or retyped. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

export interface SyncHostPairingCode {
  code: string
  hostId: string
  expiresAt: number
  attemptsRemaining: number
}

function createCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let code = ''
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length]
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
  private failures = 0

  constructor(private readonly getHostId: () => string) {}

  create(input: { now?: number; ttlMs?: number } = {}): SyncHostPairingCode {
    const now = input.now ?? Date.now()
    const ttl = input.ttlMs ?? SYNC_HOST_PAIRING_CODE_TTL_MS
    this.code = createCode()
    this.expiresAt = now + ttl
    this.failures = 0
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
   * denial of pairing; brute force is instead bounded per source by the endpoint's failure budget,
   * against roughly 40 bits of code entropy.
   */
  consume(presented: string, now: number = Date.now()): 'accepted' | 'invalid' | 'expired' {
    if (!this.code) return 'expired'
    if (this.expiresAt <= now) {
      this.clear()
      return 'expired'
    }

    const candidate = normalize(presented)
    if (!candidate || !codesEqual(candidate, this.code)) {
      this.failures = Math.min(this.failures + 1, SYNC_HOST_PAIRING_MAX_ATTEMPTS)
      return 'invalid'
    }
    this.clear()
    return 'accepted'
  }

  clear(): void {
    this.code = null
    this.expiresAt = 0
    this.failures = 0
  }

  private describe(): SyncHostPairingCode {
    return {
      code: this.code as string,
      hostId: this.getHostId(),
      expiresAt: this.expiresAt,
      attemptsRemaining: Math.max(0, SYNC_HOST_PAIRING_MAX_ATTEMPTS - this.failures)
    }
  }
}
