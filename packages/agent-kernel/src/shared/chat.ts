import type {
  AttachmentRepresentationPreference,
  AttachmentResolvedRepresentation,
  PdfEmbeddedTextCoverage
} from './types/attachment.js'
import type { FileMetaData } from './types/file.js'

/**
 * Kernel-local copy of the legacy `@shared/chat` surface, trimmed to the member the kernel
 * closure actually imports. The original barrel is a `.d.ts` whose remaining declarations
 * reference names that are declared nowhere (`MESSAGE_ROLE`, `ResourceListEntryWithClient`,
 * `PromptWithClient`); those unresolved references stay invisible to the host build because
 * `skipLibCheck` skips `.d.ts` checking, but they would fail compilation once copied as checked
 * `.ts` source. Desktop keeps using the original `@shared/chat`; nothing else in this package
 * imports this module.
 */
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
