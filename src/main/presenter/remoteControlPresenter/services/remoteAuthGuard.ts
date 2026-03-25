import {
  REMOTE_PAIR_CODE_MAX_FAILURES,
  type TelegramInboundEvent,
  type TelegramInboundMessage
} from '../types'
import { RemoteBindingStore } from './remoteBindingStore'

export type RemoteAuthResult =
  | {
      ok: true
      userId: number
    }
  | {
      ok: false
      message: string
    }

export class RemoteAuthGuard {
  constructor(private readonly bindingStore: RemoteBindingStore) {}

  ensureAuthorized(event: TelegramInboundEvent): RemoteAuthResult {
    if (event.chatType !== 'private') {
      return {
        ok: false,
        message: 'Telegram remote control only supports private chats in v1.'
      }
    }

    if (!event.fromId || !Number.isInteger(event.fromId) || event.fromId <= 0) {
      return {
        ok: false,
        message: 'Unable to verify your Telegram user ID.'
      }
    }

    if (this.bindingStore.isAllowedUser(event.fromId)) {
      return {
        ok: true,
        userId: event.fromId
      }
    }

    return {
      ok: false,
      message:
        'This Telegram account is not paired. Use /pair <code> from DeepChat Remote settings.'
    }
  }

  pair(message: TelegramInboundMessage, rawCode: string): string {
    const authorization = this.ensurePrivatePairingContext(message)
    if (authorization) {
      return authorization
    }

    const normalizedCode = rawCode.trim()
    if (!/^\d{6}$/.test(normalizedCode)) {
      return 'Usage: /pair <6-digit-code>'
    }

    const pairing = this.bindingStore.getTelegramPairingState()
    if (!pairing.code || !pairing.expiresAt || pairing.expiresAt <= Date.now()) {
      this.bindingStore.clearPairCode('telegram')
      return 'Pairing code is missing or expired. Generate a new code from DeepChat Remote settings.'
    }

    if (pairing.code !== normalizedCode) {
      const result = this.bindingStore.recordPairCodeFailure(
        'telegram',
        REMOTE_PAIR_CODE_MAX_FAILURES
      )
      if (result.exhausted) {
        return 'Too many invalid pairing attempts. The current pairing code has expired. Generate a new code from DeepChat Remote settings.'
      }
      return 'Pairing code is invalid.'
    }

    const userId = message.fromId as number
    this.bindingStore.addAllowedUser(userId)
    this.bindingStore.clearPairCode('telegram')
    return `Pairing complete. Telegram user ${userId} is now authorized.`
  }

  private ensurePrivatePairingContext(message: TelegramInboundMessage): string | null {
    if (message.chatType !== 'private') {
      return 'Pairing is only available in a private chat with the bot.'
    }

    if (!message.fromId || !Number.isInteger(message.fromId) || message.fromId <= 0) {
      return 'Unable to verify your Telegram user ID for pairing.'
    }

    return null
  }
}
