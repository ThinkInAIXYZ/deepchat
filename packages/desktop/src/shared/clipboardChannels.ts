export const CLIPBOARD_IPC_CHANNELS = {
  WRITE_TEXT: 'clipboard:write-text',
  WRITE_IMAGE: 'clipboard:write-image',
  READ_TEXT: 'clipboard:read-text'
} as const

export type ClipboardIpcChannelName =
  (typeof CLIPBOARD_IPC_CHANNELS)[keyof typeof CLIPBOARD_IPC_CHANNELS]
