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
  MODEL_LIST_CHANGED: 'config:model-list-changed', // 替代 provider-models-updated（ConfigPresenter）
  MODEL_STATUS_CHANGED: 'config:model-status-changed', // 替代 model-status-changed（ConfigPresenter）
  MODEL_BATCH_STATUS_CHANGED: 'config:model-batch-status-changed', // 批量模型状态变更事件
  SETTING_CHANGED: 'config:setting-changed', // 替代 setting-changed（ConfigPresenter）
  PROXY_MODE_CHANGED: 'config:proxy-mode-changed',
  CUSTOM_PROXY_URL_CHANGED: 'config:custom-proxy-url-changed',
  SYNC_SETTINGS_CHANGED: 'config:sync-settings-changed',
  SEARCH_ENGINES_UPDATED: 'config:search-engines-updated',
  SEARCH_PREVIEW_CHANGED: 'config:search-preview-changed',
  AUTO_SCROLL_CHANGED: 'config:auto-scroll-changed',
  NOTIFICATIONS_CHANGED: 'config:notifications-changed',
  CONTENT_PROTECTION_CHANGED: 'config:content-protection-changed',
  COPY_WITH_COT_CHANGED: 'config:copy-with-cot-enabled-changed',
  TRACE_DEBUG_CHANGED: 'config:trace-debug-changed', // Trace 调试功能开关变更事件
  PROXY_RESOLVED: 'config:proxy-resolved',
  LANGUAGE_CHANGED: 'config:language-changed', // 新增：语言变更事件
  // 模型配置相关事件
  MODEL_CONFIG_CHANGED: 'config:model-config-changed', // 模型配置变更事件
  MODEL_CONFIG_RESET: 'config:model-config-reset', // 模型配置重置事件
  MODEL_CONFIGS_IMPORTED: 'config:model-configs-imported', // 模型配置批量导入事件
  FONT_FAMILY_CHANGED: 'config:font-family-changed',
  CODE_FONT_FAMILY_CHANGED: 'config:code-font-family-changed',
  // OAuth相关事件
  OAUTH_LOGIN_START: 'config:oauth-login-start', // OAuth登录开始
  OAUTH_LOGIN_SUCCESS: 'config:oauth-login-success', // OAuth登录成功
  OAUTH_LOGIN_ERROR: 'config:oauth-login-error', // OAuth登录失败
  THEME_CHANGED: 'config:theme-changed', // 主题变更事件
  DEFAULT_SYSTEM_PROMPT_CHANGED: 'config:default-system-prompt-changed', // Default system prompt changed event
  CUSTOM_PROMPTS_CHANGED: 'config:custom-prompts-changed', // 自定义提示词变更事件
  DEFAULT_PROJECT_PATH_CHANGED: 'config:default-project-path-changed',
  AGENTS_CHANGED: 'config:agents-changed'
}

// Provider DB（聚合 JSON）相关事件
export const PROVIDER_DB_EVENTS = {
  LOADED: 'provider-db:loaded', // 首次装载完毕（内置或缓存）
  UPDATED: 'provider-db:updated' // 远端刷新成功
}

// 系统相关事件
export const SYSTEM_EVENTS = {
  SYSTEM_THEME_UPDATED: 'system:theme-updated'
}

// 应用更新相关事件
export const UPDATE_EVENTS = {
  STATE_CHANGED: 'update:state-changed' // 更新状态变化（用于生命周期管理通信）
}

// 窗口相关事件
export const WINDOW_EVENTS = {
  READY_TO_SHOW: 'window:ready-to-show', // 替代 main-window-ready-to-show
  FORCE_QUIT_APP: 'window:force-quit-app', // 替代 force-quit-app
  SET_APPLICATION_QUITTING: 'window:set-application-quitting', // 设置应用退出状态
  APP_FOCUS: 'app:focus',
  APP_BLUR: 'app:blur',
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
  FIRST_CONTENT_LOADED: 'window:first-content-loaded', // 新增：首次内容加载完成事件
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
  CLIENT_LIST_UPDATED: 'mcp:client-list-updated',
  INITIALIZED: 'mcp:initialized' // 新增：MCP初始化完成事件
}

// 同步相关事件
export const SYNC_EVENTS = {
  DATA_CHANGED: 'sync:data-changed'
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
  RENDERER_TAB_READY: 'tab:renderer-ready', // 渲染进程标签页就绪
  RENDERER_TAB_ACTIVATED: 'tab:renderer-activated', // 渲染进程标签页激活
  CLOSED: 'tab:closed' // 标签页被关闭事件
}

// 托盘相关事件
export const TRAY_EVENTS = {
  SHOW_HIDDEN_WINDOW: 'tray:show-hidden-window', // 从托盘显示/隐藏窗口
  CHECK_FOR_UPDATES: 'tray:check-for-updates' // 托盘检查更新
}

// Lifecycle management events
export const LIFECYCLE_EVENTS = {
  PHASE_STARTED: 'lifecycle:phase-started', // Lifecycle phase started
  PHASE_COMPLETED: 'lifecycle:phase-completed', // Lifecycle phase completed
  HOOK_EXECUTED: 'lifecycle:hook-executed', // Lifecycle hook executed start
  HOOK_COMPLETED: 'lifecycle:hook-completed', // Lifecycle hook executed completed
  HOOK_FAILED: 'lifecycle:hook-failed', // Lifecycle hook executed failed
  ERROR_OCCURRED: 'lifecycle:error-occurred', // Lifecycle error occurred
  PROGRESS_UPDATED: 'lifecycle:progress-updated', // Lifecycle progress updated
  SHUTDOWN_REQUESTED: 'lifecycle:shutdown-requested' // Application shutdown requested
}
