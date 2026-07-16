export { FLOATING_BUTTON_EVENTS } from '@shared/floatingButtonChannels'

/**
 * 事件系统常量定义
 *
 * 按功能领域分类事件名，采用统一的命名规范：
 * - 使用冒号分隔域和具体事件
 * - 使用小写并用连字符连接多个单词
 *
 * 看似这里和 renderer/events.ts 重复了，其实不然，这里只包含 main->renderer 事件
 */

// Settings related events
export const SETTINGS_EVENTS = {
  NAVIGATE: 'settings:navigate'
}

export const DEV_EVENTS = {
  START_GUIDED_ONBOARDING: 'dev:start-guided-onboarding'
}

// DeepLink 相关事件
export const DEEPLINK_EVENTS = {
  START: 'deeplink:start',
  MCP_INSTALL: 'deeplink:mcp-install'
}

export const SHORTCUT_EVENTS = {
  CREATE_NEW_WINDOW: 'shortcut:create-new-window',
  CREATE_NEW_CONVERSATION: 'shortcut:create-new-conversation',
  TOGGLE_SPOTLIGHT: 'shortcut:toggle-spotlight',
  TOGGLE_SIDEBAR: 'shortcut:toggle-sidebar',
  TOGGLE_WORKSPACE: 'shortcut:toggle-workspace',
  GO_SETTINGS: 'shortcut:go-settings',
  CLEAN_CHAT_HISTORY: 'shortcut:clean-chat-history',
  DELETE_CONVERSATION: 'shortcut:delete-conversation'
}
