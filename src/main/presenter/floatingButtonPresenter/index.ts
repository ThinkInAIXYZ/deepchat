import { FloatingButtonWindow } from './FloatingButtonWindow';
import { FloatingButtonConfig, FloatingButtonState, DEFAULT_FLOATING_BUTTON_CONFIG } from './types';
import logger from '../../../shared/logger';

export class FloatingButtonPresenter {
  private floatingWindow: FloatingButtonWindow | null = null;
  private config: FloatingButtonConfig;

  constructor(initialConfig?: Partial<FloatingButtonConfig>) {
    this.config = {
      ...DEFAULT_FLOATING_BUTTON_CONFIG,
      ...initialConfig
    };
  }

  /**
   * 初始化悬浮按钮功能
   */
  public async initialize(): Promise<void> {
    try {
      if (!this.config.enabled) {
        logger.debug('FloatingButton is disabled');
        return;
      }

      await this.createFloatingWindow();
      logger.info('FloatingButtonPresenter initialized');
    } catch (error) {
      logger.error('Failed to initialize FloatingButtonPresenter:', error);
      throw error;
    }
  }

  /**
   * 销毁悬浮按钮功能
   */
  public destroy(): void {
    if (this.floatingWindow) {
      this.floatingWindow.destroy();
      this.floatingWindow = null;
    }
    logger.debug('FloatingButtonPresenter destroyed');
  }

  /**
   * 当主窗口显示状态改变时调用
   */
  public onMainWindowVisibilityChanged(visible: boolean): void {
    if (!this.config.enabled || !this.floatingWindow) {
      return;
    }

    // 悬浮按钮始终显示，不受主窗口状态影响
    // 这样用户可以随时看到悬浮按钮
    this.floatingWindow.show();

    logger.debug(`FloatingButton always visible (main window: ${visible})`);
  }

  /**
   * 更新悬浮按钮配置
   */
  public async updateConfig(newConfig: Partial<FloatingButtonConfig>): Promise<void> {
    const oldEnabled = this.config.enabled;
    this.config = { ...this.config, ...newConfig };

    try {
      // 如果启用状态发生变化
      if (oldEnabled !== this.config.enabled) {
        if (this.config.enabled) {
          // 启用悬浮按钮
          if (!this.floatingWindow) {
            await this.createFloatingWindow();
          }
          // 启用时立即显示
          this.floatingWindow?.show();
        } else {
          // 禁用悬浮按钮
          this.destroyFloatingWindow();
        }
      } else if (this.config.enabled && this.floatingWindow) {
        // 更新现有窗口配置
        this.floatingWindow.updateConfig(newConfig);
      }

      logger.debug('FloatingButton config updated:', this.config);
    } catch (error) {
      logger.error('Failed to update FloatingButton config:', error);
      throw error;
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
   * 检查悬浮按钮是否可用
   */
  public isAvailable(): boolean {
    return this.config.enabled && this.floatingWindow?.exists() || false;
  }

  /**
   * 手动显示悬浮按钮
   */
  public show(): void {
    if (this.config.enabled && this.floatingWindow) {
      this.floatingWindow.show();
    }
  }

  /**
   * 手动隐藏悬浮按钮
   */
  public hide(): void {
    if (this.floatingWindow) {
      this.floatingWindow.hide();
    }
  }

  /**
   * 创建悬浮窗口
   */
  private async createFloatingWindow(): Promise<void> {
    if (this.floatingWindow) {
      return;
    }

    this.floatingWindow = new FloatingButtonWindow(this.config);
    await this.floatingWindow.create();
    
    // 悬浮按钮创建后立即显示
    this.floatingWindow.show();
    logger.debug('FloatingButtonWindow created and shown');
  }

  /**
   * 销毁悬浮窗口
   */
  private destroyFloatingWindow(): void {
    if (this.floatingWindow) {
      this.floatingWindow.destroy();
      this.floatingWindow = null;
    }
  }
}

// 导出单例实例
export const floatingButtonPresenter = new FloatingButtonPresenter();
