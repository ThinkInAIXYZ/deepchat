import { describe, expect, it, vi } from 'vitest'
import { RemoteAuthGuard } from '@/presenter/remoteControlPresenter/services/remoteAuthGuard'

const createMessage = (
  overrides: Partial<Parameters<RemoteAuthGuard['ensureAuthorized']>[0]> = {}
) => ({
  updateId: 1,
  chatId: 100,
  messageThreadId: 0,
  messageId: 10,
  chatType: 'private',
  fromId: 123,
  text: 'hello',
  command: null,
  ...overrides
})

describe('RemoteAuthGuard', () => {
  it('authorizes allowed private users by numeric id', () => {
    const store = {
      isAllowedUser: vi.fn().mockReturnValue(true)
    } as any
    const guard = new RemoteAuthGuard(store)

    expect(guard.ensureAuthorized(createMessage())).toEqual({
      ok: true,
      userId: 123
    })
    expect(store.isAllowedUser).toHaveBeenCalledWith(123)
  })

  it('rejects non-private chats', () => {
    const guard = new RemoteAuthGuard({
      isAllowedUser: vi.fn().mockReturnValue(true)
    } as any)

    const result = guard.ensureAuthorized(createMessage({ chatType: 'group' }))

    expect(result.ok).toBe(false)
    expect(result).toEqual(
      expect.objectContaining({
        message: 'Telegram remote control only supports private chats in v1.'
      })
    )
  })

  it('pairs a user with a valid one-time code', () => {
    const store = {
      getTelegramPairingState: vi.fn().mockReturnValue({
        code: '123456',
        expiresAt: Date.now() + 60_000,
        failedAttempts: 0
      }),
      addAllowedUser: vi.fn(),
      clearPairCode: vi.fn(),
      recordPairCodeFailure: vi.fn()
    } as any
    const guard = new RemoteAuthGuard(store)

    const result = guard.pair(createMessage(), '123456')

    expect(result).toContain('Pairing complete')
    expect(store.addAllowedUser).toHaveBeenCalledWith(123)
    expect(store.clearPairCode).toHaveBeenCalledWith('telegram')
  })

  it('rejects expired pair codes and clears them', () => {
    const store = {
      getTelegramPairingState: vi.fn().mockReturnValue({
        code: '123456',
        expiresAt: Date.now() - 1,
        failedAttempts: 0
      }),
      addAllowedUser: vi.fn(),
      clearPairCode: vi.fn(),
      recordPairCodeFailure: vi.fn()
    } as any
    const guard = new RemoteAuthGuard(store)

    const result = guard.pair(createMessage(), '123456')

    expect(result).toContain('missing or expired')
    expect(store.addAllowedUser).not.toHaveBeenCalled()
    expect(store.clearPairCode).toHaveBeenCalledWith('telegram')
  })

  it('expires the pairing code after too many invalid attempts', () => {
    const store = {
      getTelegramPairingState: vi.fn().mockReturnValue({
        code: '123456',
        expiresAt: Date.now() + 60_000,
        failedAttempts: 4
      }),
      addAllowedUser: vi.fn(),
      clearPairCode: vi.fn(),
      recordPairCodeFailure: vi.fn().mockReturnValue({
        attempts: 5,
        exhausted: true
      })
    } as any
    const guard = new RemoteAuthGuard(store)

    const result = guard.pair(createMessage(), '654321')

    expect(result).toContain('Too many invalid pairing attempts')
    expect(store.recordPairCodeFailure).toHaveBeenCalledWith('telegram', 5)
    expect(store.addAllowedUser).not.toHaveBeenCalled()
  })
})
