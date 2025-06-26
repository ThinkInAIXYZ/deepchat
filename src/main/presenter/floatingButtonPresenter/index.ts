import { FloatingButtonWindow } from './FloatingButtonWindow';
import { FloatingButtonConfig, FloatingButtonState, DEFAULT_FLOATING_BUTTON_CONFIG } from './types';
import { ConfigPresenter } from '../configPresenter';
import { ipcMain } from 'electron';
import { FLOATING_BUTTON_EVENTS } from '@/events';
import { handleShowHiddenWindow } from '@/utils';

export class FloatingButtonPresenter {
  private floatingWindow: FloatingButtonWindow | null = null;
  private config: FloatingButtonConfig;
  private configPresenter: ConfigPresenter

  constructor(configPresenter: ConfigPresenter) {
    this.configPresenter = configPresenter
    this.config = {
      ...DEFAULT_FLOATING_BUTTON_CONFIG,
    };
  }

  /**
   * 初始化悬浮按钮功能
   */
  public async initialize(config?: Partial<FloatingButtonConfig>): Promise<void> {
    const floatingButtonEnabled = this.configPresenter.getFloatingButtonEnabled()
    try {
      this.config = {
        ...this.config,
        ...config,
        enabled: floatingButtonEnabled
      };

      if (!this.config.enabled) {
        console.log('FloatingButton is disabled, skipping window creation');
        return;
      }

      await this.createFloatingWindow();
    } catch (error) {
      console.error('Failed to initialize FloatingButtonPresenter:', error);
      throw error;
    }
  }

  /**
   * 销毁悬浮按钮功能
   */
  public destroy(): void {
    this.config.enabled = false;

    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.CLICKED);
    if (this.floatingWindow) {
      this.floatingWindow.destroy();
      this.floatingWindow = null;
    }
  }

  /**
   * 启用悬浮按钮
   */
  public async enable(): Promise<void> {
    console.log('FloatingButtonPresenter.enable called, current enabled:', this.config.enabled, 'has window:', !!this.floatingWindow)
    
    this.config.enabled = true;

    if (this.floatingWindow) {
      console.log('FloatingButton window already exists, showing it')
      this.floatingWindow.show();
      return; // 已经存在窗口，只需显示
    }

    console.log('Creating new floating button window')
    await this.createFloatingWindow();
  }

  /**
   * 设置悬浮按钮启用状态
   */
  public async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.enable();
    } else {
      this.destroy();
    }
  }

  /**
   * 获取当前配置
   */
  public getConfig(): FloatingButtonConfig {
    return { ...this.config };
  }

  /**
   * 获取当前状态
   */
  public getState(): FloatingButtonState | null {
    return this.floatingWindow?.getState() || null;
  }

  /**
   * 创建悬浮窗口
   */
  private async createFloatingWindow(): Promise<void> {
    ipcMain.removeAllListeners(FLOATING_BUTTON_EVENTS.CLICKED);

    ipcMain.on(FLOATING_BUTTON_EVENTS.CLICKED, () => {
      try {
        // 触发内置事件处理器
        handleShowHiddenWindow(true)
      } catch {
      }
    })

    if (!this.floatingWindow) {
      this.floatingWindow = new FloatingButtonWindow(this.config);
      await this.floatingWindow.create();
    }

    // 悬浮按钮创建后立即显示
    this.floatingWindow.show();
  }
}
