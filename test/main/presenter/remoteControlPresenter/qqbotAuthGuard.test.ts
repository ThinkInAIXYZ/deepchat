import { describe, expect, it, vi } from 'vitest'
import { QQBotAuthGuard } from '@/presenter/remoteControlPresenter/services/qqbotAuthGuard'

const createMessage = (
  overrides: Partial<Parameters<QQBotAuthGuard['ensureAuthorized']>[0]> = {}
) => ({
  kind: 'message' as const,
  eventId: 'evt-1',
  chatId: 'user_openid_1',
  chatType: 'c2c' as const,
  messageId: 'msg-1',
  messageSeq: 1,
  senderUserId: 'user_openid_1',
  senderUserName: 'user_openid_1',
  text: 'hello',
  command: null,
  mentionedBot: false,
  ...overrides
})

describe('QQBotAuthGuard', () => {
  it('pairs a c2c user with a valid code', () => {
    const store = {
      getQQBotPairingState: vi.fn().mockReturnValue({
        code: '123456',
        expiresAt: Date.now() + 60_000,
        failedAttempts: 0
      }),
      addQQBotPairedUser: vi.fn(),
      addQQBotPairedGroup: vi.fn(),
      clearPairCode: vi.fn(),
      recordPairCodeFailure: vi.fn()
    } as any
    const guard = new QQBotAuthGuard(store)

    const result = guard.pair(createMessage(), '123456')

    expect(result).toContain('Pairing complete')
    expect(store.addQQBotPairedUser).toHaveBeenCalledWith('user_openid_1')
    expect(store.clearPairCode).toHaveBeenCalledWith('qqbot')
  })

  it('authorizes a paired group independently from c2c users', () => {
    const store = {
      isQQBotPairedGroup: vi.fn().mockReturnValue(true)
    } as any
    const guard = new QQBotAuthGuard(store)

    const result = guard.ensureAuthorized(
      createMessage({
        chatId: 'group_openid_1',
        chatType: 'group',
        senderUserId: 'member_openid_1',
        mentionedBot: true
      })
    )

    expect(result).toEqual({
      ok: true,
      principalId: 'group_openid_1'
    })
  })
})
