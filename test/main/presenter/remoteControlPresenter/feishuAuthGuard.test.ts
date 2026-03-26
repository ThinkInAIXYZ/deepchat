import { describe, expect, it, vi } from 'vitest'
import { FeishuAuthGuard } from '@/presenter/remoteControlPresenter/services/feishuAuthGuard'

const createMessage = (
  overrides: Partial<Parameters<FeishuAuthGuard['ensureAuthorized']>[0]> = {}
) => ({
  kind: 'message' as const,
  eventId: 'evt-1',
  chatId: 'oc_1',
  threadId: null,
  messageId: 'om_1',
  chatType: 'p2p' as const,
  senderOpenId: 'ou_user',
  text: 'hello',
  command: null,
  mentionedBot: false,
  mentions: [],
  ...overrides
})

describe('FeishuAuthGuard', () => {
  it('pairs a user with a valid one-time code', () => {
    const store = {
      getFeishuPairingState: vi.fn().mockReturnValue({
        code: '123456',
        expiresAt: Date.now() + 60_000,
        failedAttempts: 0
      }),
      addFeishuPairedUser: vi.fn(),
      clearPairCode: vi.fn(),
      recordPairCodeFailure: vi.fn()
    } as any
    const guard = new FeishuAuthGuard(store)

    const result = guard.pair(createMessage(), '123456')

    expect(result).toContain('Pairing complete')
    expect(store.addFeishuPairedUser).toHaveBeenCalledWith('ou_user')
    expect(store.clearPairCode).toHaveBeenCalledWith('feishu')
  })

  it('expires the pairing code after too many invalid attempts', () => {
    const store = {
      getFeishuPairingState: vi.fn().mockReturnValue({
        code: '123456',
        expiresAt: Date.now() + 60_000,
        failedAttempts: 4
      }),
      addFeishuPairedUser: vi.fn(),
      clearPairCode: vi.fn(),
      recordPairCodeFailure: vi.fn().mockReturnValue({
        attempts: 5,
        exhausted: true
      })
    } as any
    const guard = new FeishuAuthGuard(store)

    const result = guard.pair(createMessage(), '654321')

    expect(result).toContain('Too many invalid pairing attempts')
    expect(store.recordPairCodeFailure).toHaveBeenCalledWith('feishu', 5)
    expect(store.addFeishuPairedUser).not.toHaveBeenCalled()
  })
})
