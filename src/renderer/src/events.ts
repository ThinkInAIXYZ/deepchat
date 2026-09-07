export { FLOATING_BUTTON_EVENTS } from '@shared/floatingButtonChannels'

/**
 * 事件系统常量定义
 * 看似这里和 main/events.ts 重复了，其实不然，这里只包含了main上来给renderer的事件
 *
 * 按功能领域分类事件名，采用统一的命名规范：
 * - 使用冒号分隔域和具体事件
 * - 使用小写并用连字符连接多个单词
 */

// 配置相关事件
export const CONFIG_EVENTS = {
  PROVIDER_CHANGED: 'config:provider-changed', // 替代 provider-setting-changed
  PROVIDER_ATOMIC_UPDATE: 'config:provider-atomic-update', // 原子操作单个 provider 更新
  PROVIDER_BATCH_UPDATE: 'config:provider-batch-update', // 批量 provider 更新
  SETTING_CHANGED: 'config:setting-changed' // 替代 setting-changed（ConfigService）
}

// Settings related events
export const SETTINGS_EVENTS = {
  READY: 'settings:ready',
  NAVIGATE: 'settings:navigate',
  CHECK_FOR_UPDATES: 'settings:check-for-updates',
  PROVIDER_INSTALL: 'settings:provider-install'
}

export const DEV_EVENTS = {
  START_GUIDED_ONBOARDING: 'dev:start-guided-onboarding'
}

// DeepLink 相关事件
export const DEEPLINK_EVENTS = {
  PROTOCOL_RECEIVED: 'deeplink:protocol-received',
  START: 'deeplink:start',
  MCP_INSTALL: 'deeplink:mcp-install'
}

export const SHORTCUT_EVENTS = {
  CREATE_NEW_CONVERSATION: 'shortcut:create-new-conversation',
  TOGGLE_SPOTLIGHT: 'shortcut:toggle-spotlight',
  TOGGLE_SIDEBAR: 'shortcut:toggle-sidebar',
  TOGGLE_WORKSPACE: 'shortcut:toggle-workspace',
  GO_SETTINGS: 'shortcut:go-settings',
  CLEAN_CHAT_HISTORY: 'shortcut:clean-chat-history',
  DELETE_CONVERSATION: 'shortcut:delete-conversation'
}

// Thread view related events
export const THREAD_VIEW_EVENTS = {
  TOGGLE: 'thread-view:toggle'
}

// 标签页相关事件
export const TAB_EVENTS = {
  CONTENT_UPDATED: 'tab:content-updated', // 标签页内容更新
  STATE_CHANGED: 'tab:state-changed', // 标签页状态变化
  VISIBILITY_CHANGED: 'tab:visibility-changed' // 标签页可见性变化
}

// Workspace events
export const WORKSPACE_EVENTS = {
  INSERT_REFERENCE_REQUESTED: 'workspace:insert-reference-requested'
}
