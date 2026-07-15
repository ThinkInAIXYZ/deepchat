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
  PROVIDER_BATCH_UPDATE: 'config:provider-batch-update', // 新增：批量 provider 更新
  SETTING_CHANGED: 'config:setting-changed' // 替代 setting-changed（ConfigPresenter）
}

// Provider DB（聚合 JSON）相关事件
export const PROVIDER_DB_EVENTS = {
  LOADED: 'provider-db:loaded', // 首次装载完毕（内置或缓存）
  UPDATED: 'provider-db:updated' // 远端刷新成功
}

// 窗口相关事件
export const WINDOW_EVENTS = {
  READY_TO_SHOW: 'window:ready-to-show', // 替代 main-window-ready-to-show
  WINDOW_MAXIMIZED: 'window:maximized',
  WINDOW_UNMAXIMIZED: 'window:unmaximized',
  WINDOW_RESIZED: 'window:resized',
  WINDOW_RESIZE: 'window:resize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_CREATED: 'window:created',
  WINDOW_FOCUSED: 'window:focused',
  WINDOW_BLURRED: 'window:blurred',
  WINDOW_ENTER_FULL_SCREEN: 'window:enter-full-screen',
  WINDOW_LEAVE_FULL_SCREEN: 'window:leave-full-screen',
  WINDOW_CLOSED: 'window:closed',
  WINDOW_RESTORED: 'window:restored'
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
  ZOOM_IN: 'shortcut:zoom-in',
  ZOOM_OUT: 'shortcut:zoom-out',
  ZOOM_RESUME: 'shortcut:zoom-resume',
  CREATE_NEW_WINDOW: 'shortcut:create-new-window',
  CREATE_NEW_CONVERSATION: 'shortcut:create-new-conversation',
  TOGGLE_SPOTLIGHT: 'shortcut:toggle-spotlight',
  TOGGLE_SIDEBAR: 'shortcut:toggle-sidebar',
  TOGGLE_WORKSPACE: 'shortcut:toggle-workspace',
  GO_SETTINGS: 'shortcut:go-settings',
  CLEAN_CHAT_HISTORY: 'shortcut:clean-chat-history',
  DELETE_CONVERSATION: 'shortcut:delete-conversation'
}

// 标签页相关事件
export const TAB_EVENTS = {
  CONTENT_UPDATED: 'tab:content-updated', // 标签页内容更新
  STATE_CHANGED: 'tab:state-changed', // 标签页状态变化
  VISIBILITY_CHANGED: 'tab:visibility-changed', // 标签页可见性变化
  CLOSED: 'tab:closed' // 标签页被关闭事件
}
