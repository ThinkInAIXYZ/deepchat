import { z } from 'zod'
import { defineRouteContract } from '../common'
import { RectangleSchema, YoBrowserStatusSchema } from '../domainSchemas'

export const browserGetStatusRoute = defineRouteContract({
  name: 'browser.getStatus',
  input: z.object({
    sessionId: z.string().min(1)
  }),
  output: z.object({
    status: YoBrowserStatusSchema
  })
})

export const browserLoadUrlRoute = defineRouteContract({
  name: 'browser.loadUrl',
  input: z.object({
    sessionId: z.string().min(1),
    url: z.string().min(1),
    timeoutMs: z.number().int().positive().optional()
  }),
  output: z.object({
    status: YoBrowserStatusSchema
  })
})

export const browserAttachCurrentWindowRoute = defineRouteContract({
  name: 'browser.attachCurrentWindow',
  input: z.object({
    sessionId: z.string().min(1)
  }),
  output: z.object({
    attached: z.boolean()
  })
})

export const browserUpdateCurrentWindowBoundsRoute = defineRouteContract({
  name: 'browser.updateCurrentWindowBounds',
  input: z.object({
    sessionId: z.string().min(1),
    bounds: RectangleSchema,
    visible: z.boolean()
  }),
  output: z.object({
    updated: z.boolean()
  })
})

export const browserDetachRoute = defineRouteContract({
  name: 'browser.detach',
  input: z.object({
    sessionId: z.string().min(1)
  }),
  output: z.object({
    detached: z.boolean()
  })
})

export const browserSetPreviewModeRoute = defineRouteContract({
  name: 'browser.setPreviewMode',
  input: z.object({
    sessionId: z.string().min(1),
    mode: z.enum(['capturing', 'rendering', 'stopped']),
    runId: z.string().min(1).optional()
  }),
  output: z.object({
    updated: z.boolean(),
    surface: z.enum(['native-overlay', 'renderer-canvas', 'none'])
  })
})

export const browserDestroyRoute = defineRouteContract({
  name: 'browser.destroy',
  input: z.object({
    sessionId: z.string().min(1)
  }),
  output: z.object({
    destroyed: z.boolean()
  })
})

export const browserGoBackRoute = defineRouteContract({
  name: 'browser.goBack',
  input: z.object({
    sessionId: z.string().min(1)
  }),
  output: z.object({
    status: YoBrowserStatusSchema
  })
})

export const browserGoForwardRoute = defineRouteContract({
  name: 'browser.goForward',
  input: z.object({
    sessionId: z.string().min(1)
  }),
  output: z.object({
    status: YoBrowserStatusSchema
  })
})

export const browserReloadRoute = defineRouteContract({
  name: 'browser.reload',
  input: z.object({
    sessionId: z.string().min(1)
  }),
  output: z.object({
    status: YoBrowserStatusSchema
  })
})

export const browserClearSandboxDataRoute = defineRouteContract({
  name: 'browser.clearSandboxData',
  input: z.object({}).default({}),
  output: z.object({
    cleared: z.boolean()
  })
})

const BrowserImportCapabilityReasonSchema = z.enum([
  'platform_unsupported',
  'browser_not_found',
  'profile_data_missing'
])

const BrowserImportProfileSchema = z.object({
  id: z.string().min(1),
  browser: z.enum(['chrome', 'arc']),
  browserName: z.string().min(1),
  profileName: z.string().min(1),
  supported: z.boolean(),
  reason: BrowserImportCapabilityReasonSchema.optional()
})

export const browserScanImportSourcesRoute = defineRouteContract({
  name: 'browser.import.scan',
  input: z.object({}).default({}),
  output: z.object({
    platformSupported: z.boolean(),
    profiles: z.array(BrowserImportProfileSchema),
    reason: BrowserImportCapabilityReasonSchema.optional()
  })
})

export const browserPreviewImportRoute = defineRouteContract({
  name: 'browser.import.preview',
  input: z.object({
    profileId: z.string().min(1)
  }),
  output: z.object({
    token: z.string().min(1),
    profile: BrowserImportProfileSchema,
    cookieCount: z.number().int().nonnegative(),
    skippedExpired: z.number().int().nonnegative(),
    skippedPartitioned: z.number().int().nonnegative()
  })
})

export const browserApplyImportRoute = defineRouteContract({
  name: 'browser.import.apply',
  input: z.object({
    token: z.string().min(1)
  }),
  output: z.object({
    importedCookies: z.number().int().nonnegative(),
    skippedExpired: z.number().int().nonnegative(),
    skippedPartitioned: z.number().int().nonnegative(),
    syncedAt: z.number().int().nonnegative()
  })
})
