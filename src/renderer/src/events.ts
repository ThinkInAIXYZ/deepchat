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
  LANGUAGE_CHANGED: 'config:language-changed', // 新增：语言变更事件
  COPY_WITH_COT_CHANGED: 'config:copy-with-cot-enabled-changed',
  TRACE_DEBUG_CHANGED: 'config:trace-debug-changed', // Trace 调试功能开关变更事件
  FONT_FAMILY_CHANGED: 'config:font-family-changed',
  CODE_FONT_FAMILY_CHANGED: 'config:code-font-family-changed',
  THEME_CHANGED: 'config:theme-changed',
  DEFAULT_SYSTEM_PROMPT_CHANGED: 'config:default-system-prompt-changed',
  CUSTOM_PROMPTS_CHANGED: 'config:custom-prompts-changed',
  DEFAULT_PROJECT_PATH_CHANGED: 'config:default-project-path-changed',
  AGENTS_CHANGED: 'config:agents-changed'
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
  ZOOM_IN: 'shortcut:zoom-in',
  ZOOM_OUT: 'shortcut:zoom-out',
  ZOOM_RESUME: 'shortcut:zoom-resume',
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
  VISIBILITY_CHANGED: 'tab:visibility-changed', // 标签页可见性变化
  RENDERER_TAB_READY: 'tab:renderer-ready', // 渲染进程标签页就绪
  RENDERER_TAB_ACTIVATED: 'tab:renderer-activated' // 渲染进程标签页激活
}

// Workspace events
export const WORKSPACE_EVENTS = {
  INSERT_REFERENCE_REQUESTED: 'workspace:insert-reference-requested'
}
