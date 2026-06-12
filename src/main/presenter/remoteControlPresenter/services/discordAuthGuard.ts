import { REMOTE_PAIR_CODE_MAX_FAILURES, type DiscordInboundMessage } from '../types'
import { RemoteBindingStore } from './remoteBindingStore'

export type DiscordAuthResult =
  | {
      ok: true
      principalId: string
    }
  | {
      ok: false
      message: string
      silent?: boolean
    }

export class DiscordAuthGuard {
  constructor(private readonly bindingStore: RemoteBindingStore) {}

  ensureAuthorized(message: DiscordInboundMessage): DiscordAuthResult {
    if (message.chatType === 'channel' && message.kind === 'message' && !message.mentionedBot) {
      return {
        ok: false,
        message: '',
        silent: true
      }
    }

    if (this.bindingStore.isDiscordPairedChannel(message.chatId)) {
      return {
        ok: true,
        principalId: message.chatId
      }
    }

    return {
      ok: false,
      message:
        message.chatType === 'dm'
          ? 'This Discord DM is not paired. Generate a pair code in DeepChat Remote settings, then use /pair <code>.'
          : 'This Discord channel is not authorized. Generate a pair code in DeepChat Remote settings, then use /pair <code> in this channel.'
    }
  }

  pair(message: DiscordInboundMessage, rawCode: string): string {
    const normalizedCode = rawCode.trim()
    if (!/^\d{6}$/.test(normalizedCode)) {
      return 'Usage: /pair <6-digit-code>'
    }

    const pairing = this.bindingStore.getDiscordPairingState()
    if (!pairing.code || !pairing.expiresAt || pairing.expiresAt <= Date.now()) {
      this.bindingStore.clearPairCode('discord')
      return 'Pairing code is missing or expired. Generate a new code from DeepChat Remote settings.'
    }

    if (pairing.code !== normalizedCode) {
      const result = this.bindingStore.recordPairCodeFailure(
        'discord',
        REMOTE_PAIR_CODE_MAX_FAILURES
      )
      if (result.exhausted) {
        return 'Too many invalid pairing attempts. The current pairing code has expired. Generate a new code from DeepChat Remote settings.'
      }
      return 'Pairing code is invalid.'
    }

    this.bindingStore.addDiscordPairedChannel(message.chatId)
    this.bindingStore.clearPairCode('discord')
    return `Pairing complete. Discord ${message.chatType === 'dm' ? 'DM' : 'channel'} ${message.chatId} is now authorized.`
  }
}
