import type { FeishuInboundMessage } from '../types'
import { RemoteBindingStore } from './remoteBindingStore'

export type FeishuAuthResult =
  | {
      ok: true
      userOpenId: string
    }
  | {
      ok: false
      message: string
      silent?: boolean
    }

export class FeishuAuthGuard {
  constructor(private readonly bindingStore: RemoteBindingStore) {}

  ensureAuthorized(message: FeishuInboundMessage): FeishuAuthResult {
    if (message.chatType !== 'p2p' && !message.mentionedBot) {
      return {
        ok: false,
        message: '',
        silent: true
      }
    }

    if (!message.senderOpenId) {
      return {
        ok: false,
        message: 'Unable to verify your Feishu account.'
      }
    }

    if (this.bindingStore.isFeishuPairedUser(message.senderOpenId)) {
      return {
        ok: true,
        userOpenId: message.senderOpenId
      }
    }

    return {
      ok: false,
      message:
        'This Feishu account is not paired. Open Remote settings and use the current /pair code.'
    }
  }

  pair(message: FeishuInboundMessage, rawCode: string): string {
    if (message.chatType !== 'p2p') {
      return 'Pairing is only available in a private chat with the Feishu bot.'
    }

    if (!message.senderOpenId) {
      return 'Unable to verify your Feishu account for pairing.'
    }

    const normalizedCode = rawCode.trim()
    if (!/^\d{6}$/.test(normalizedCode)) {
      return 'Usage: /pair <6-digit-code>'
    }

    const pairing = this.bindingStore.getFeishuPairingState()
    if (!pairing.code || !pairing.expiresAt || pairing.expiresAt <= Date.now()) {
      this.bindingStore.clearPairCode('feishu')
      return 'Pairing code is missing or expired. Generate a new code from DeepChat Remote settings.'
    }

    if (pairing.code !== normalizedCode) {
      return 'Pairing code is invalid.'
    }

    this.bindingStore.addFeishuPairedUser(message.senderOpenId)
    this.bindingStore.clearPairCode('feishu')
    return `Pairing complete. Feishu user ${message.senderOpenId} is now authorized.`
  }
}
