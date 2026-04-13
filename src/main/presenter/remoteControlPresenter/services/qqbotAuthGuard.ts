import { REMOTE_PAIR_CODE_MAX_FAILURES, type QQBotInboundMessage } from '../types'
import { RemoteBindingStore } from './remoteBindingStore'

export type QQBotAuthResult =
  | {
      ok: true
      principalId: string
    }
  | {
      ok: false
      message: string
      silent?: boolean
    }

export class QQBotAuthGuard {
  constructor(private readonly bindingStore: RemoteBindingStore) {}

  ensureAuthorized(message: QQBotInboundMessage): QQBotAuthResult {
    if (message.chatType === 'group' && !message.mentionedBot) {
      return {
        ok: false,
        message: '',
        silent: true
      }
    }

    if (message.chatType === 'c2c') {
      if (!message.senderUserId) {
        return {
          ok: false,
          message: 'Unable to verify your QQ account.'
        }
      }

      if (this.bindingStore.isQQBotPairedUser(message.senderUserId)) {
        return {
          ok: true,
          principalId: message.senderUserId
        }
      }

      return {
        ok: false,
        message:
          'This QQ account is not paired. Open Remote settings and use the current /pair code.'
      }
    }

    if (this.bindingStore.isQQBotPairedGroup(message.chatId)) {
      return {
        ok: true,
        principalId: message.chatId
      }
    }

    return {
      ok: false,
      message:
        'This QQ group is not authorized. Generate a /pair code in DeepChat Remote settings, then send /pair <code> in this group.'
    }
  }

  pair(message: QQBotInboundMessage, rawCode: string): string {
    const normalizedCode = rawCode.trim()
    if (!/^\d{6}$/.test(normalizedCode)) {
      return 'Usage: /pair <6-digit-code>'
    }

    const pairing = this.bindingStore.getQQBotPairingState()
    if (!pairing.code || !pairing.expiresAt || pairing.expiresAt <= Date.now()) {
      this.bindingStore.clearPairCode('qqbot')
      return 'Pairing code is missing or expired. Generate a new code from DeepChat Remote settings.'
    }

    if (pairing.code !== normalizedCode) {
      const result = this.bindingStore.recordPairCodeFailure('qqbot', REMOTE_PAIR_CODE_MAX_FAILURES)
      if (result.exhausted) {
        return 'Too many invalid pairing attempts. The current pairing code has expired. Generate a new code from DeepChat Remote settings.'
      }
      return 'Pairing code is invalid.'
    }

    if (message.chatType === 'c2c') {
      if (!message.senderUserId) {
        return 'Unable to verify your QQ account for pairing.'
      }

      this.bindingStore.addQQBotPairedUser(message.senderUserId)
      this.bindingStore.clearPairCode('qqbot')
      return `Pairing complete. QQ user ${message.senderUserId} is now authorized.`
    }

    this.bindingStore.addQQBotPairedGroup(message.chatId)
    this.bindingStore.clearPairCode('qqbot')
    return `Pairing complete. QQ group ${message.chatId} is now authorized.`
  }
}
