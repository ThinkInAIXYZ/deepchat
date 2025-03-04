/**
 * 事件系统常量定义
 *
 * 按功能领域分类事件名，采用统一的命名规范：
 * - 使用冒号分隔域和具体事件
 * - 使用小写并用连字符连接多个单词
 */

// 配置相关事件
export const CONFIG_EVENTS = {
  PROVIDER_CHANGED: 'config:provider-changed', // 替代 provider-setting-changed
  SYSTEM_CHANGED: 'config:system-changed',
  MODEL_LIST_CHANGED: 'config:model-list-changed', // 替代 provider-models-updated（ConfigPresenter）
  MODEL_STATUS_CHANGED: 'config:model-status-changed' // 替代 model-status-changed（ConfigPresenter）
}

// 会话相关事件
export const CONVERSATION_EVENTS = {
  CREATED: 'conversation:created',
  ACTIVATED: 'conversation:activated', // 替代 conversation-activated
  DEACTIVATED: 'conversation:deactivated', // 替代 active-conversation-cleared
  MESSAGE_EDITED: 'conversation:message-edited' // 替代 message-edited
}

// 通信相关事件
export const STREAM_EVENTS = {
  RESPONSE: 'stream:response', // 替代 stream-response
  END: 'stream:end', // 替代 stream-end
  ERROR: 'stream:error' // 替代 stream-error
}

// 应用更新相关事件
export const UPDATE_EVENTS = {
  STATUS_CHANGED: 'update:status-changed', // 替代 update-status-changed
  PROGRESS: 'update:progress', // 替代 update-progress
  ERROR: 'update:error', // 替代 update-error
  WILL_RESTART: 'update:will-restart' // 替代 update-will-restart
}

// 窗口相关事件
export const WINDOW_EVENTS = {
  READY_TO_SHOW: 'window:ready-to-show', // 替代 main-window-ready-to-show
  FORCE_QUIT_APP: 'window:force-quit-app' // 替代 force-quit-app
}

// ollama 相关事件
export const OLLAMA_EVENTS = {
  PULL_MODEL_PROGRESS: 'ollama:pull-model-progress'
}
