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
