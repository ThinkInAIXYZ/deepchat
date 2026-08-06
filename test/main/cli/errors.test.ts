import { describe, expect, it } from 'vitest'
import { LocalControlErrorSchema, type LocalControlErrorCode } from '@shared/contracts/localControl'
import { CLI_EXIT_CODES, exitCodeForRemoteError } from '../../../src/cli/errors'

const error = (code: LocalControlErrorCode) =>
  LocalControlErrorSchema.parse({
    code,
    message: code,
    retriable: false
  })

describe('CLI exit codes', () => {
  it('keeps the public numeric contract stable', () => {
    expect(CLI_EXIT_CODES).toEqual({
      success: 0,
      usage: 2,
      unavailable: 3,
      authorization: 4,
      approval: 5,
      domain: 6,
      cancelled: 7,
      internal: 8
    })
  })

  it.each([
    ['invalid_request', 2],
    ['unsupported_version', 3],
    ['unavailable', 3],
    ['authentication_failed', 4],
    ['permission_denied', 4],
    ['approval_denied', 5],
    ['approval_timeout', 5],
    ['not_found', 6],
    ['conflict', 6],
    ['rate_limited', 6],
    ['cancelled', 7],
    ['timeout', 7],
    ['internal_error', 8]
  ] as const)('maps %s to exit %i', (code, expected) => {
    expect(exitCodeForRemoteError(error(code))).toBe(expected)
  })
})
