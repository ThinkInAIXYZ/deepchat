import { z } from 'zod'
import { EntityIdSchema, ProviderModelSummarySchema, defineRouteContract } from '../common'
import {
  ModelCapabilitiesSchema,
  ModelConfigExportEntrySchema,
  ModelConfigSchema,
  ProviderModelCatalogSchema,
  ProviderModelConfigEntrySchema
} from '../domainSchemas'

export const modelsGetProviderCatalogRoute = defineRouteContract({
  name: 'models.getProviderCatalog',
  input: z.object({
    providerId: EntityIdSchema
  }),
  output: z.object({
    catalog: ProviderModelCatalogSchema
  })
})

export const modelsListRuntimeRoute = defineRouteContract({
  name: 'models.listRuntime',
  input: z.object({
    providerId: EntityIdSchema
  }),
  output: z.object({
    models: z.array(ProviderModelSummarySchema)
  })
})

export const modelsSetStatusRoute = defineRouteContract({
  name: 'models.setStatus',
  input: z.object({
    providerId: EntityIdSchema,
    modelId: z.string().min(1),
    enabled: z.boolean()
  }),
  output: z.object({
    providerId: EntityIdSchema,
    modelId: z.string().min(1),
    enabled: z.boolean()
  })
})

export const modelsAddCustomRoute = defineRouteContract({
  name: 'models.addCustom',
  input: z.object({
    providerId: EntityIdSchema,
    model: ProviderModelSummarySchema.omit({
      providerId: true,
      group: true,
      isCustom: true
    }).passthrough()
  }),
  output: z.object({
    model: ProviderModelSummarySchema
  })
})

export const modelsRemoveCustomRoute = defineRouteContract({
  name: 'models.removeCustom',
  input: z.object({
    providerId: EntityIdSchema,
    modelId: z.string().min(1)
  }),
  output: z.object({
    removed: z.boolean()
  })
})

export const modelsUpdateCustomRoute = defineRouteContract({
  name: 'models.updateCustom',
  input: z.object({
    providerId: EntityIdSchema,
    modelId: z.string().min(1),
    updates: ProviderModelSummarySchema.partial()
  }),
  output: z.object({
    updated: z.boolean()
  })
})

export const modelsGetConfigRoute = defineRouteContract({
  name: 'models.getConfig',
  input: z.object({
    modelId: z.string().min(1),
    providerId: z.string().min(1).optional()
  }),
  output: z.object({
    config: ModelConfigSchema
  })
})

export const modelsSetConfigRoute = defineRouteContract({
  name: 'models.setConfig',
  input: z.object({
    modelId: z.string().min(1),
    providerId: EntityIdSchema,
    config: ModelConfigSchema
  }),
  output: z.object({
    config: ModelConfigSchema
  })
})

export const modelsResetConfigRoute = defineRouteContract({
  name: 'models.resetConfig',
  input: z.object({
    modelId: z.string().min(1),
    providerId: EntityIdSchema
  }),
  output: z.object({
    reset: z.boolean()
  })
})

export const modelsGetProviderConfigsRoute = defineRouteContract({
  name: 'models.getProviderConfigs',
  input: z.object({
    providerId: EntityIdSchema
  }),
  output: z.object({
    configs: z.array(ProviderModelConfigEntrySchema)
  })
})

export const modelsHasUserConfigRoute = defineRouteContract({
  name: 'models.hasUserConfig',
  input: z.object({
    modelId: z.string().min(1),
    providerId: EntityIdSchema
  }),
  output: z.object({
    hasConfig: z.boolean()
  })
})

export const modelsExportConfigsRoute = defineRouteContract({
  name: 'models.exportConfigs',
  input: z.object({}).default({}),
  output: z.object({
    configs: z.record(z.string(), ModelConfigExportEntrySchema)
  })
})

export const modelsImportConfigsRoute = defineRouteContract({
  name: 'models.importConfigs',
  input: z.object({
    configs: z.record(z.string(), ModelConfigExportEntrySchema),
    overwrite: z.boolean().default(false)
  }),
  output: z.object({
    imported: z.boolean(),
    overwrite: z.boolean()
  })
})

export const modelsSetBatchStatusRoute = defineRouteContract({
  name: 'models.setBatchStatus',
  input: z.object({
    providerId: EntityIdSchema,
    updates: z.array(
      z.object({
        modelId: z.string().min(1),
        enabled: z.boolean()
      })
    )
  }),
  output: z.object({
    results: z.array(
      z.object({
        modelId: z.string().min(1),
        enabled: z.boolean()
      })
    )
  })
})

export const modelsGetCapabilitiesRoute = defineRouteContract({
  name: 'models.getCapabilities',
  input: z.object({
    providerId: EntityIdSchema,
    modelId: z.string().min(1)
  }),
  output: z.object({
    capabilities: ModelCapabilitiesSchema
  })
})
