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
