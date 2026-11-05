import { describe, expect, it } from 'vitest'
import { listRemoteChannelDescriptors } from '@/remote/catalog'

describe('remote channel catalog', () => {
  it('lists every channel the settings surface can configure', () => {
    expect(listRemoteChannelDescriptors().map((channel) => channel.id)).toEqual([
      'telegram',
      'feishu',
      'qqbot',
      'discord',
      'weixin-ilink'
    ])
  })

  it('marks only the delivery-capable channels as cron deliverable', () => {
    const deliverable = listRemoteChannelDescriptors()
      .filter((channel) => channel.supportsCronDelivery)
      .map((channel) => channel.id)

    expect(deliverable).toContain('telegram')
    // The catalog is what the renderer titles each row with, so the keys must
    // point at copy that exists rather than at a channel's display name.
    for (const channel of listRemoteChannelDescriptors()) {
      expect(channel.titleKey).toMatch(/^settings\.remote\./)
      expect(channel.descriptionKey).toMatch(/^settings\.remote\./)
    }
  })
})
