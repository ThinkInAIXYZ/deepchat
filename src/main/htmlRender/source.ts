export interface HtmlRenderSourceRef {
  conversationId: string
  messageId: string
  blockId: string
}

/** Content is read asynchronously; protocol requests recheck the captured source identity. */
export interface HtmlRenderSource {
  title: string
  html: string
  panelId?: string
  isCurrent?(): boolean
}
