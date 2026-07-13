import { z } from 'zod'
import { defineRouteContract } from '../common'
import { WindowStateSchema } from '../domainSchemas'

const ProviderInstallPreviewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('builtin'),
    id: z.string().min(1),
    baseUrl: z.string(),
    apiKey: z.string(),
    maskedApiKey: z.string(),
    iconModelId: z.string(),
    willOverwrite: z.boolean()
  }),
  z.object({
    kind: z.literal('custom'),
    name: z.string().min(1),
    type: z.string().min(1),
    baseUrl: z.string(),
    apiKey: z.string(),
    maskedApiKey: z.string(),
    iconModelId: z.string()
  })
])

export const windowGetCurrentStateRoute = defineRouteContract({
  name: 'window.getCurrentState',
  input: z.object({}).default({}),
  output: z.object({
    state: WindowStateSchema
  })
})

export const windowGetRuntimeIdentityRoute = defineRouteContract({
  name: 'window.getRuntimeIdentity',
  input: z.object({}).default({}),
  output: z.object({
    windowId: z.number().int().nullable(),
    webContentsId: z.number().int()
  })
})

export const windowMinimizeCurrentRoute = defineRouteContract({
  name: 'window.minimizeCurrent',
  input: z.object({}).default({}),
  output: z.object({
    state: WindowStateSchema
  })
})

export const windowToggleMaximizeCurrentRoute = defineRouteContract({
  name: 'window.toggleMaximizeCurrent',
  input: z.object({}).default({}),
  output: z.object({
    state: WindowStateSchema
  })
})

export const windowCloseCurrentRoute = defineRouteContract({
  name: 'window.closeCurrent',
  input: z.object({}).default({}),
  output: z.object({
    closed: z.boolean()
  })
})

export const windowCloseFloatingCurrentRoute = defineRouteContract({
  name: 'window.closeFloatingCurrent',
  input: z.object({}).default({}),
  output: z.object({
    closed: z.boolean()
  })
})

export const windowPreviewFileRoute = defineRouteContract({
  name: 'window.previewFile',
  input: z.object({
    filePath: z.string().min(1)
  }),
  output: z.object({
    previewed: z.boolean()
  })
})

export const windowCloseSettingsRoute = defineRouteContract({
  name: 'window.closeSettings',
  input: z.object({}).default({}),
  output: z.object({
    closed: z.boolean()
  })
})

export const windowFocusMainRoute = defineRouteContract({
  name: 'window.focusMain',
  input: z.object({}).default({}),
  output: z.object({
    focused: z.boolean()
  })
})

export const windowNotifySettingsReadyRoute = defineRouteContract({
  name: 'window.notifySettingsReady',
  input: z.object({}).default({}),
  output: z.object({
    notified: z.literal(true)
  })
})

export const windowConsumePendingSettingsProviderInstallRoute = defineRouteContract({
  name: 'window.consumePendingSettingsProviderInstall',
  input: z.object({}).default({}),
  output: z.object({
    preview: ProviderInstallPreviewSchema.nullable()
  })
})

export const windowRequeuePendingSettingsProviderInstallRoute = defineRouteContract({
  name: 'window.requeuePendingSettingsProviderInstall',
  input: z.object({
    preview: ProviderInstallPreviewSchema
  }),
  output: z.object({
    queued: z.boolean()
  })
})

export const windowStartGuidedOnboardingRoute = defineRouteContract({
  name: 'window.startGuidedOnboarding',
  input: z.object({}).default({}),
  output: z.object({
    started: z.boolean(),
    focused: z.boolean()
  })
})
