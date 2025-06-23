import { contextBridge, ipcRenderer } from 'electron';

// 定义悬浮按钮的 API
const floatingButtonAPI = {
  // 通知主进程悬浮按钮被点击
  onClick: () => {
    ipcRenderer.send('floating-button-click');
  },

  // 监听来自主进程的事件
  onConfigUpdate: (callback: (config: any) => void) => {
    ipcRenderer.on('floating-button-config-update', (_event, config) => {
      callback(config);
    });
  },

  // 移除事件监听器
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('floating-button-config-update');
  }
};

// 将 API 暴露给渲染进程
contextBridge.exposeInMainWorld('floatingButtonAPI', floatingButtonAPI);
