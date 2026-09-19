import type {
  AttachmentRepresentationPreference,
  AttachmentResolvedRepresentation,
  PdfEmbeddedTextCoverage
} from './types/attachment.js'
import type { FileMetaData } from './types/file.js'

/** Legacy chat attachment contract, shared by the host barrel and portable consumers. */
export type MessageFile = {
  name: string
  content: string
  mimeType: string
  metadata: FileMetaData
  token: number
  path: string
  thumbnail?: string
  requestedRepresentation?: AttachmentRepresentationPreference
  resolvedRepresentation?: AttachmentResolvedRepresentation
  pdfTextCoverage?: PdfEmbeddedTextCoverage
}
