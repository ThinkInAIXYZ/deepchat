import { RemoteBindingStore } from './remoteBindingStore'
import type { WeixinIlinkInboundMessage } from '../types'

export type WeixinIlinkAuthResult =
  | {
      ok: true
    }
  | {
      ok: false
      message: string
    }

export class WeixinIlinkAuthGuard {
  constructor(private readonly bindingStore: RemoteBindingStore) {}

  ensureAuthorized(message: WeixinIlinkInboundMessage): WeixinIlinkAuthResult {
    const account = this.bindingStore.getWeixinIlinkAccount(message.accountId)
    if (!account) {
      return {
        ok: false,
        message: 'This Weixin iLink account is no longer available in DeepChat.'
      }
    }

    if (!account.enabled) {
      return {
        ok: false,
        message: 'This Weixin iLink account is disabled in DeepChat.'
      }
    }

    if (account.ownerUserId === message.userId) {
      return {
        ok: true
      }
    }

    return {
      ok: false,
      message: 'Only the Weixin account owner who completed QR login can control this bot.'
    }
  }
}
