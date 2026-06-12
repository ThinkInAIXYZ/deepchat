import { z } from 'zod'
import { defineRouteContract } from '../common'
import { PreparedMessageFileSchema } from '../domainSchemas'

const FileImageActionInputSchema = z.object({
  source: z.string().min(1),
  mimeType: z.string().optional(),
  suggestedName: z.string().optional()
})

export const fileGetMimeTypeRoute = defineRouteContract({
  name: 'file.getMimeType',
  input: z.object({
    path: z.string().min(1)
  }),
  output: z.object({
    mimeType: z.string()
  })
})

export const filePrepareFileRoute = defineRouteContract({
  name: 'file.prepareFile',
  input: z.object({
    path: z.string().min(1),
    mimeType: z.string().optional()
  }),
  output: z.object({
    file: PreparedMessageFileSchema
  })
})

export const filePrepareDirectoryRoute = defineRouteContract({
  name: 'file.prepareDirectory',
  input: z.object({
    path: z.string().min(1)
  }),
  output: z.object({
    file: PreparedMessageFileSchema
  })
})

export const fileReadFileRoute = defineRouteContract({
  name: 'file.readFile',
  input: z.object({
    path: z.string().min(1)
  }),
  output: z.object({
    content: z.string()
  })
})

export const fileIsDirectoryRoute = defineRouteContract({
  name: 'file.isDirectory',
  input: z.object({
    path: z.string().min(1)
  }),
  output: z.object({
    isDirectory: z.boolean()
  })
})

export const fileWriteImageBase64Route = defineRouteContract({
  name: 'file.writeImageBase64',
  input: z.object({
    name: z.string().min(1),
    content: z.string().min(1)
  }),
  output: z.object({
    path: z.string()
  })
})

export const fileSaveImageRoute = defineRouteContract({
  name: 'file.saveImage',
  input: FileImageActionInputSchema,
  output: z.object({
    canceled: z.boolean(),
    path: z.string().optional()
  })
})

export const fileCopyImageRoute = defineRouteContract({
  name: 'file.copyImage',
  input: FileImageActionInputSchema,
  output: z.object({
    copied: z.boolean()
  })
})
