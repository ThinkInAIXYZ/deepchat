import { describe, expect, it, vi } from 'vitest'
import { DiscordAuthGuard } from '@/presenter/remoteControlPresenter/services/discordAuthGuard'

const createMessage = (
  overrides: Partial<Parameters<DiscordAuthGuard['ensureAuthorized']>[0]> = {}
) => ({
  kind: 'message' as const,
  eventId: 'evt-1',
  chatId: 'channel-1',
  chatType: 'channel' as const,
  messageId: 'msg-1',
  senderUserId: 'user-1',
  senderUserName: 'alice',
  text: 'hello',
  command: null,
  mentionedBot: true,
  attachments: [],
  ...overrides
})

describe('DiscordAuthGuard', () => {
  it('pairs the current discord endpoint with a valid code', () => {
    const store = {
      getDiscordPairingState: vi.fn().mockReturnValue({
        code: '123456',
        expiresAt: Date.now() + 60_000,
        failedAttempts: 0
      }),
      addDiscordPairedChannel: vi.fn(),
      clearPairCode: vi.fn(),
      recordPairCodeFailure: vi.fn()
    } as any
    const guard = new DiscordAuthGuard(store)

    const result = guard.pair(createMessage(), '123456')

    expect(result).toContain('Pairing complete')
    expect(store.addDiscordPairedChannel).toHaveBeenCalledWith('channel-1')
    expect(store.clearPairCode).toHaveBeenCalledWith('discord')
  })

  it('silences unmentioned guild messages before authorization', () => {
    const store = {
      isDiscordPairedChannel: vi.fn().mockReturnValue(false)
    } as any
    const guard = new DiscordAuthGuard(store)

    const result = guard.ensureAuthorized(
      createMessage({
        mentionedBot: false
      })
    )

    expect(result).toEqual({
      ok: false,
      message: '',
      silent: true
    })
  })
})
