export const CommandKey = 'CommandOrControl'

const ShiftKey = 'Shift'

// Register tab number shortcut keys (1-8) -> Fixed CommandKey+1 ~ CommandKey+8 to switch tabs
// Below are regular shortcut key definitions
export const rendererShortcutKey = {
  NewConversation: `${CommandKey}+N`,
  NewWindow: `${CommandKey}+${ShiftKey}+N`,
  NewTab: `${CommandKey}+T`,
  CloseTab: `${CommandKey}+W`,
  ZoomIn: `${CommandKey}+=`,
  ZoomOut: `${CommandKey}+-`,
  ZoomResume: `${CommandKey}+0`,
  GoSettings: `${CommandKey}+,`,
  CleanChatHistory: `${CommandKey}+L`,
  DeleteConversation: `${CommandKey}+D`,
  SwitchNextTab: `${CommandKey}+Tab`,
  SwitchPrevTab: `${CommandKey}+${ShiftKey}+Tab`,
  SwtichToLastTab: `${CommandKey}+9`
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
