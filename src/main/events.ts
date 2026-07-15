export { FLOATING_BUTTON_EVENTS } from '@shared/floatingButtonChannels'

/**
 * 事件系统常量定义
 *
 * 按功能领域分类事件名，采用统一的命名规范：
 * - 使用冒号分隔域和具体事件
 * - 使用小写并用连字符连接多个单词
 *
 * 看似这里和 renderer/events.ts 重复了，其实不然，这里只包含了main->renderer 和 main->main 的事件
 */

// 配置相关事件
export const CONFIG_EVENTS = {
  PROVIDER_CHANGED: 'config:provider-changed', // 替代 provider-setting-changed
  PROVIDER_ATOMIC_UPDATE: 'config:provider-atomic-update', // 新增：原子操作单个 provider 更新
  PROVIDER_BATCH_UPDATE: 'config:provider-batch-update' // 新增：批量 provider 更新
}

// Provider DB（聚合 JSON）相关事件
export const PROVIDER_DB_EVENTS = {
  LOADED: 'provider-db:loaded', // 首次装载完毕（内置或缓存）
  UPDATED: 'provider-db:updated' // 远端刷新成功
}

// Settings related events
export const SETTINGS_EVENTS = {
  NAVIGATE: 'settings:navigate'
}

export const DEV_EVENTS = {
  START_GUIDED_ONBOARDING: 'dev:start-guided-onboarding'
}

// MCP 相关事件
export const MCP_EVENTS = {
  SERVER_STARTED: 'mcp:server-started',
  SERVER_STOPPED: 'mcp:server-stopped',
  CONFIG_CHANGED: 'mcp:config-changed',
  SERVER_STATUS_CHANGED: 'mcp:server-status-changed',
  CLIENT_LIST_UPDATED: 'mcp:client-list-updated'
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
