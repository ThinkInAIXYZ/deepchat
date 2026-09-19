import { z } from 'zod'
import { defineRouteContract } from '../common'
import {
  KnowledgeFileMessageSchema,
  KnowledgeFileResultSchema,
  KnowledgeFileValidationResultSchema,
  KnowledgeQueryResultSchema
} from '../domainSchemas'

const KnowledgeBaseIdSchema = z.string().min(1)
const FileIdSchema = z.string().min(1)

export const knowledgeIsSupportedRoute = defineRouteContract({
  name: 'knowledge.isSupported',
  input: z.object({}).default({}),
  output: z.object({
    supported: z.boolean()
  })
})

export const knowledgeGetSupportedLanguagesRoute = defineRouteContract({
  name: 'knowledge.getSupportedLanguages',
  input: z.object({}).default({}),
  output: z.object({
    languages: z.array(z.string())
  })
})

export const knowledgeGetSeparatorsForLanguageRoute = defineRouteContract({
  name: 'knowledge.getSeparatorsForLanguage',
  input: z.object({
    language: z.string().min(1)
  }),
  output: z.object({
    separators: z.array(z.string())
  })
})

export const knowledgeGetSupportedFileExtensionsRoute = defineRouteContract({
  name: 'knowledge.getSupportedFileExtensions',
  input: z.object({}).default({}),
  output: z.object({
    extensions: z.array(z.string())
  })
})

export const knowledgeListFilesRoute = defineRouteContract({
  name: 'knowledge.listFiles',
  input: z.object({
    knowledgeBaseId: KnowledgeBaseIdSchema
  }),
  output: z.object({
    files: z.array(KnowledgeFileMessageSchema)
  })
})

export const knowledgeSimilarityQueryRoute = defineRouteContract({
  name: 'knowledge.similarityQuery',
  input: z.object({
    knowledgeBaseId: KnowledgeBaseIdSchema,
    query: z.string().min(1)
  }),
  output: z.object({
    results: z.array(KnowledgeQueryResultSchema)
  })
})

export const knowledgeValidateFileRoute = defineRouteContract({
  name: 'knowledge.validateFile',
  input: z.object({
    filePath: z.string().min(1)
  }),
  output: z.object({
    result: KnowledgeFileValidationResultSchema
  })
})

export const knowledgeAddFileRoute = defineRouteContract({
  name: 'knowledge.addFile',
  input: z.object({
    knowledgeBaseId: KnowledgeBaseIdSchema,
    filePath: z.string().min(1)
  }),
  output: z.object({
    result: KnowledgeFileResultSchema
  })
})

export const knowledgeDeleteFileRoute = defineRouteContract({
  name: 'knowledge.deleteFile',
  input: z.object({
    knowledgeBaseId: KnowledgeBaseIdSchema,
    fileId: FileIdSchema
  }),
  output: z.object({
    deleted: z.boolean()
  })
})

export const knowledgeReAddFileRoute = defineRouteContract({
  name: 'knowledge.reAddFile',
  input: z.object({
    knowledgeBaseId: KnowledgeBaseIdSchema,
    fileId: FileIdSchema
  }),
  output: z.object({
    result: KnowledgeFileResultSchema
  })
})

export const knowledgePauseAllRunningTasksRoute = defineRouteContract({
  name: 'knowledge.pauseAllRunningTasks',
  input: z.object({
    knowledgeBaseId: KnowledgeBaseIdSchema
  }),
  output: z.object({
    paused: z.boolean()
  })
})

export const knowledgeResumeAllPausedTasksRoute = defineRouteContract({
  name: 'knowledge.resumeAllPausedTasks',
  input: z.object({
    knowledgeBaseId: KnowledgeBaseIdSchema
  }),
  output: z.object({
    resumed: z.boolean()
  })
})
