import { z } from 'zod'
import type {
  PairableRemoteChannel,
  RemoteBindingSummary,
  RemoteChannel,
  RemoteChannelDescriptor,
  RemoteChannelSettings,
  RemoteChannelStatus,
  FeishuAuthResult,
  FeishuAuthSession,
  FeishuInstallResult,
  FeishuInstallSession,
  RemotePairingSnapshot,
  TelegramRemoteStatus,
  WeixinIlinkLoginResult,
  WeixinIlinkLoginSession,
  WeixinIlinkRemoteStatus
} from '@shared/presenter'
import { defineRouteContract } from '../common'

export const RemoteChannelSchema = z.enum([
  'telegram',
  'feishu',
  'qqbot',
  'discord',
  'weixin-ilink'
])

export const PairableRemoteChannelSchema = z.enum(['telegram', 'feishu', 'qqbot', 'discord'])

const RemoteChannelDescriptorSchema = z.custom<RemoteChannelDescriptor>()
const RemoteChannelSettingsSchema = z.custom<RemoteChannelSettings>()
const RemoteChannelStatusSchema = z.custom<RemoteChannelStatus>()
const RemoteBindingSummarySchema = z.custom<RemoteBindingSummary>()
const RemotePairingSnapshotSchema = z.custom<RemotePairingSnapshot>()
const TelegramRemoteStatusSchema = z.custom<TelegramRemoteStatus>()
const FeishuAuthSessionSchema = z.object({
  sessionKey: z.string().min(1),
  authUrl: z.string().url().nullable(),
  redirectUri: z.string().url(),
  expiresAt: z.number().int().nonnegative(),
  message: z.string().optional(),
  messageKey: z.string().optional()
}) satisfies z.ZodType<FeishuAuthSession>
const FeishuAuthResultSchema = z.object({
  authorized: z.boolean(),
  openId: z.string().nullable(),
  unionId: z.string().optional(),
  name: z.string().optional(),
  message: z.string().optional(),
  messageKey: z.string().optional()
}) satisfies z.ZodType<FeishuAuthResult>
const FeishuInstallSessionSchema = z.object({
  sessionKey: z.string().min(1),
  installUrl: z.string().url(),
  userCode: z.string(),
  expiresAt: z.number().int().nonnegative(),
  intervalMs: z.number().int().positive(),
  message: z.string().optional(),
  messageKey: z.string().optional()
}) satisfies z.ZodType<FeishuInstallSession>
const FeishuInstallResultSchema = z.object({
  installed: z.boolean(),
  brand: z.enum(['feishu', 'lark']).nullable(),
  appId: z.string().nullable(),
  openId: z.string().optional(),
  message: z.string().optional(),
  messageKey: z.string().optional()
}) satisfies z.ZodType<FeishuInstallResult>
const WeixinIlinkRemoteStatusSchema = z.custom<WeixinIlinkRemoteStatus>()
const WeixinIlinkLoginSessionSchema = z.custom<WeixinIlinkLoginSession>()
const WeixinIlinkLoginResultSchema = z.custom<WeixinIlinkLoginResult>()

export const remoteControlListChannelsRoute = defineRouteContract({
  name: 'remoteControl.listChannels',
  input: z.object({}),
  output: z.object({
    channels: z.array(RemoteChannelDescriptorSchema)
  })
})

export const remoteControlGetChannelSettingsRoute = defineRouteContract({
  name: 'remoteControl.getChannelSettings',
  input: z.object({
    channel: RemoteChannelSchema
  }),
  output: z.object({
    settings: RemoteChannelSettingsSchema
  })
})

export const remoteControlSaveChannelSettingsRoute = defineRouteContract({
  name: 'remoteControl.saveChannelSettings',
  input: z.object({
    channel: RemoteChannelSchema,
    settings: RemoteChannelSettingsSchema
  }),
  output: z.object({
    settings: RemoteChannelSettingsSchema
  })
})

export const remoteControlGetChannelStatusRoute = defineRouteContract({
  name: 'remoteControl.getChannelStatus',
  input: z.object({
    channel: RemoteChannelSchema
  }),
  output: z.object({
    status: RemoteChannelStatusSchema
  })
})

export const remoteControlGetChannelBindingsRoute = defineRouteContract({
  name: 'remoteControl.getChannelBindings',
  input: z.object({
    channel: RemoteChannelSchema
  }),
  output: z.object({
    bindings: z.array(RemoteBindingSummarySchema)
  })
})

export const remoteControlRemoveChannelBindingRoute = defineRouteContract({
  name: 'remoteControl.removeChannelBinding',
  input: z.object({
    channel: RemoteChannelSchema,
    endpointKey: z.string().min(1)
  }),
  output: z.object({
    removed: z.literal(true)
  })
})

export const remoteControlRemoveChannelPrincipalRoute = defineRouteContract({
  name: 'remoteControl.removeChannelPrincipal',
  input: z.object({
    channel: PairableRemoteChannelSchema,
    principalId: z.string().min(1)
  }),
  output: z.object({
    removed: z.literal(true)
  })
})

export const remoteControlGetChannelPairingSnapshotRoute = defineRouteContract({
  name: 'remoteControl.getChannelPairingSnapshot',
  input: z.object({
    channel: PairableRemoteChannelSchema
  }),
  output: z.object({
    snapshot: RemotePairingSnapshotSchema
  })
})

export const remoteControlCreateChannelPairCodeRoute = defineRouteContract({
  name: 'remoteControl.createChannelPairCode',
  input: z.object({
    channel: PairableRemoteChannelSchema
  }),
  output: z.object({
    code: z.string(),
    expiresAt: z.number().int()
  })
})

export const remoteControlClearChannelPairCodeRoute = defineRouteContract({
  name: 'remoteControl.clearChannelPairCode',
  input: z.object({
    channel: PairableRemoteChannelSchema
  }),
  output: z.object({
    cleared: z.literal(true)
  })
})

export const remoteControlGetTelegramStatusRoute = defineRouteContract({
  name: 'remoteControl.getTelegramStatus',
  input: z.object({}),
  output: z.object({
    status: TelegramRemoteStatusSchema
  })
})

export const remoteControlStartFeishuAuthRoute = defineRouteContract({
  name: 'remoteControl.startFeishuAuth',
  input: z
    .object({
      brand: z.enum(['feishu', 'lark']).optional(),
      appId: z.string().optional(),
      appSecret: z.string().optional(),
      redirectUri: z.string().url().optional()
    })
    .optional()
    .default({}),
  output: z.object({
    session: FeishuAuthSessionSchema
  })
})

export const remoteControlWaitForFeishuAuthRoute = defineRouteContract({
  name: 'remoteControl.waitForFeishuAuth',
  input: z.object({
    sessionKey: z.string().min(1),
    timeoutMs: z.number().int().positive().optional()
  }),
  output: z.object({
    result: FeishuAuthResultSchema
  })
})

export const remoteControlCancelFeishuAuthRoute = defineRouteContract({
  name: 'remoteControl.cancelFeishuAuth',
  input: z.object({
    sessionKey: z.string().min(1)
  }),
  output: z.object({
    cancelled: z.literal(true)
  })
})

export const remoteControlStartFeishuInstallRoute = defineRouteContract({
  name: 'remoteControl.startFeishuInstall',
  input: z
    .object({
      brand: z.enum(['feishu', 'lark']).optional()
    })
    .optional()
    .default({}),
  output: z.object({
    session: FeishuInstallSessionSchema
  })
})

export const remoteControlWaitForFeishuInstallRoute = defineRouteContract({
  name: 'remoteControl.waitForFeishuInstall',
  input: z.object({
    sessionKey: z.string().min(1),
    timeoutMs: z.number().int().positive().optional()
  }),
  output: z.object({
    result: FeishuInstallResultSchema
  })
})

export const remoteControlCancelFeishuInstallRoute = defineRouteContract({
  name: 'remoteControl.cancelFeishuInstall',
  input: z.object({
    sessionKey: z.string().min(1)
  }),
  output: z.object({
    cancelled: z.literal(true)
  })
})

export const remoteControlGetWeixinIlinkStatusRoute = defineRouteContract({
  name: 'remoteControl.getWeixinIlinkStatus',
  input: z.object({}),
  output: z.object({
    status: WeixinIlinkRemoteStatusSchema
  })
})

export const remoteControlStartWeixinIlinkLoginRoute = defineRouteContract({
  name: 'remoteControl.startWeixinIlinkLogin',
  input: z
    .object({
      force: z.boolean().optional()
    })
    .optional()
    .default({}),
  output: z.object({
    session: WeixinIlinkLoginSessionSchema
  })
})

export const remoteControlWaitForWeixinIlinkLoginRoute = defineRouteContract({
  name: 'remoteControl.waitForWeixinIlinkLogin',
  input: z.object({
    sessionKey: z.string().min(1),
    timeoutMs: z.number().int().positive().optional()
  }),
  output: z.object({
    result: WeixinIlinkLoginResultSchema
  })
})

export const remoteControlRemoveWeixinIlinkAccountRoute = defineRouteContract({
  name: 'remoteControl.removeWeixinIlinkAccount',
  input: z.object({
    accountId: z.string().min(1)
  }),
  output: z.object({
    removed: z.literal(true)
  })
})

export const remoteControlRestartWeixinIlinkAccountRoute = defineRouteContract({
  name: 'remoteControl.restartWeixinIlinkAccount',
  input: z.object({
    accountId: z.string().min(1)
  }),
  output: z.object({
    restarted: z.literal(true)
  })
})

export type RemoteControlRouteChannel = z.infer<typeof RemoteChannelSchema>
export type RemoteControlRoutePairableChannel = z.infer<typeof PairableRemoteChannelSchema>

const _channelTypeCheck: RemoteControlRouteChannel extends RemoteChannel ? true : never = true
const _pairableChannelTypeCheck: RemoteControlRoutePairableChannel extends PairableRemoteChannel
  ? true
  : never = true

void _channelTypeCheck
void _pairableChannelTypeCheck
