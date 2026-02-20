export const CommandKey = 'CommandOrControl'

const ShiftKey = 'Shift'

export const rendererShortcutKey = {
  NewConversation: `${CommandKey}+N`,
  NewWindow: `${CommandKey}+${ShiftKey}+N`,
  CloseTab: `${CommandKey}+W`,
  ZoomIn: `${CommandKey}+=`,
  ZoomOut: `${CommandKey}+-`,
  ZoomResume: `${CommandKey}+0`,
  GoSettings: `${CommandKey}+,`,
  CleanChatHistory: `${CommandKey}+L`,
  DeleteConversation: `${CommandKey}+D`
}

// System-level shortcut keys
export const systemShortcutKey = {
  ShowHideWindow: `${CommandKey}+O`,
  Quit: `${CommandKey}+Q`
}

export const defaultShortcutKey = {
  ...rendererShortcutKey,
  ...systemShortcutKey
}

export type ShortcutKey = keyof typeof defaultShortcutKey

export type ShortcutKeySetting = Record<ShortcutKey, string>
