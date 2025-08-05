export interface DocumentInput<Metadata extends Record<string, any> = Record<string, any>> {
  /** The content of the page */
  pageContent: string
  /** Arbitrary metadata */
  metadata?: Metadata
  /** Optional document identifier */
  id?: string
}

export interface DocumentInterface<Metadata extends Record<string, any> = Record<string, any>> {
  pageContent: string
  metadata: Metadata
  id?: string
}

export class Document<Metadata extends Record<string, any> = Record<string, any>>
  implements DocumentInput<Metadata>, DocumentInterface<Metadata>
{
  pageContent: string
  metadata: Metadata
  id?: string

  constructor(fields: DocumentInput<Metadata>) {
    this.pageContent = fields.pageContent
    this.metadata = fields.metadata ?? ({} as Metadata)
    this.id = fields.id
  }
}

/**
 * Base class for document transformers.
 * Stubbing - methods should be overridden in subclasses.
 */
export abstract class BaseDocumentTransformer {
  /**
   * Transform an array of documents.
   * Must be implemented by subclasses.
   */
  abstract transformDocuments(documents: Document[], options?: any): Promise<Document[]>

  /**
   * Optional invoke alias for transformDocuments.
   */
  invoke?(input: Document[], options?: any): Promise<Document[]>
}
