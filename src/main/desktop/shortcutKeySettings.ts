import type { ShortcutKeySetting } from '@shared/types/desktop'

export const CommandKey = 'CommandOrControl'

const ShiftKey = 'Shift'

export const defaultShortcutKey: ShortcutKeySetting = {
  NewConversation: `${CommandKey}+N`,
  QuickSearch: `${CommandKey}+P`,
  ToggleSidebar: `${CommandKey}+B`,
  ToggleWorkspace: `${CommandKey}+J`,
  // Control on every platform: macOS reserves Command+` for cycling windows.
  ToggleTerminal: 'Control+`',
  NewWindow: `${CommandKey}+${ShiftKey}+N`,
  CloseWindow: `${CommandKey}+W`,
  ZoomIn: `${CommandKey}+=`,
  ZoomOut: `${CommandKey}+-`,
  ZoomResume: `${CommandKey}+0`,
  GoSettings: `${CommandKey}+,`,
  CleanChatHistory: `${CommandKey}+L`,
  DeleteConversation: `${CommandKey}+D`,
  ShowHideWindow: `${CommandKey}+O`,
  Quit: `${CommandKey}+Q`
}
