import type { CronJob, CronJobDeliveryTarget, CronJobRun } from '@shared/cronJobs'
import type { RemoteBindingSummary, RemoteChannel } from '@shared/types/remote'
import { parseDiscordEndpointKey, parseWeixinIlinkEndpointKey } from '../types'
import type { ChannelManager } from '../runtime/manager'

const DEFAULT_CHANNEL_ID = 'default'
const DEFAULT_MESSAGE_LIMIT = 4000
const DISCORD_MESSAGE_LIMIT = 1900

export const REMOTE_DELIVERY_CHANNELS: readonly RemoteChannel[] = [
  'telegram',
  'feishu',
  'discord',
  'weixin-ilink'
]

export type RemoteDeliveryInput = {
  job: CronJob
  run: CronJobRun
  target: Extract<CronJobDeliveryTarget, { type: 'remote' }>
}

export class RemoteDelivery {
  constructor(
    private readonly channelManager: ChannelManager,
    private readonly listBindings: (channel: RemoteChannel) => Promise<RemoteBindingSummary[]>
  ) {}

  async deliver(input: RemoteDeliveryInput): Promise<{ remoteMessageId?: string | null }> {
    const channel = this.parseChannel(input.target.remoteId)
    const binding = (await this.listBindings(channel)).find(
      (entry) => entry.endpointKey === input.target.channelId
    )
    if (!binding) {
      throw new Error(`Remote binding is not available: ${input.target.channelId}`)
    }

    const adapter = this.getAdapter(channel, input.target.channelId)
    if (!adapter?.connected) {
      throw new Error(`Remote channel is not running: ${channel}`)
    }

    await adapter.sendMessage(
      this.getChatId(channel, input.target.channelId, binding),
      this.buildText(input, channel)
    )

    return { remoteMessageId: null }
  }

  private parseChannel(remoteId: string): RemoteChannel {
    if (REMOTE_DELIVERY_CHANNELS.includes(remoteId as RemoteChannel)) {
      return remoteId as RemoteChannel
    }

    throw new Error(`Unsupported remote delivery channel: ${remoteId}`)
  }

  private getAdapter(channel: RemoteChannel, endpointKey: string) {
    if (channel === 'weixin-ilink') {
      const endpoint = parseWeixinIlinkEndpointKey(endpointKey)
      if (!endpoint) {
        throw new Error(`Invalid Weixin iLink binding: ${endpointKey}`)
      }
      return this.channelManager.getAdapter(channel, endpoint.accountId)
    }

    return this.channelManager.getAdapter(channel, DEFAULT_CHANNEL_ID)
  }

  private getChatId(
    channel: RemoteChannel,
    endpointKey: string,
    binding: RemoteBindingSummary
  ): string {
    if (channel === 'telegram' || channel === 'feishu') {
      return binding.threadId ? `${binding.chatId}:${binding.threadId}` : binding.chatId
    }

    if (channel === 'discord') {
      const endpoint = parseDiscordEndpointKey(endpointKey)
      if (!endpoint) {
        throw new Error(`Invalid Discord binding: ${endpointKey}`)
      }
      return `${endpoint.chatType}:${endpoint.chatId}`
    }

    const endpoint = parseWeixinIlinkEndpointKey(endpointKey)
    if (!endpoint) {
      throw new Error(`Invalid Weixin iLink binding: ${endpointKey}`)
    }
    return endpoint.userId
  }

  private buildText(input: RemoteDeliveryInput, channel: RemoteChannel): string {
    const body = (input.run.error || input.run.outputPreview || '').trim()
    const lines = [`Scheduled task "${input.job.name}" ${input.run.status}.`]

    if (body) {
      lines.push('', body)
    }

    if (input.target.mode === 'full') {
      lines.push(
        '',
        `Run ID: ${input.run.id}`,
        `Scheduled at: ${new Date(input.run.scheduledAt).toISOString()}`
      )
      if (input.run.sessionId) {
        lines.push(`Session ID: ${input.run.sessionId}`)
      }
    }

    const text = lines.join('\n')
    const limit = this.getMessageLimit(channel)
    return limit === null ? text : text.slice(0, limit)
  }

  private getMessageLimit(channel: RemoteChannel): number | null {
    if (channel === 'feishu') {
      return null
    }
    if (channel === 'discord') {
      return DISCORD_MESSAGE_LIMIT
    }
    return DEFAULT_MESSAGE_LIMIT
  }
}
