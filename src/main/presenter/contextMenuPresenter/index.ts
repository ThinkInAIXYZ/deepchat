/**
 * 上下文菜单管理器
 * 负责创建和管理应用程序中的右键菜单
 */
import { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import contextMenu from 'electron-context-menu'
import { eventBus } from '@/eventbus'
import { WindowPresenter } from '../windowPresenter'
import {IContextMenuPresenter} from "@shared/presenter";



/**
 * 上下文菜单管理器类
 * 实现了IContextMenuPresenter接口，提供右键菜单的注册、移除和管理功能
 */
export class ContextMenuPresenter implements IContextMenuPresenter {
  private windowPresenter: WindowPresenter

  /**
   * 存储所有已注册菜单的清理函数
   * 键为选择器，值为清理函数
   */
  private disposeFunctions: Map<string, () => void> = new Map()

  /**
   * 构造函数
   * 初始化时注册默认的上下文菜单
   */
  constructor(windowPresenter: WindowPresenter) {
    // 注册默认的上下文菜单
    // this.registerDefaultContextMenu()
    this.windowPresenter = windowPresenter
  }

  /**
   * 为特定选择器注册上下文菜单
   * @param selector - CSS选择器，用于定位应用菜单的元素
   * @param menuItems - 菜单项配置数组，每项包含标签和动作
   * @param customLabels - 可选的自定义标签，用于国际化支持
   */
  registerContextMenu(
    selector: string,
    menuItems: { label: string; action: string }[],
    customLabels?: Partial<Record<string, string>>
  ): void {
    // 加入定时器
    // 如果已存在相同选择器的菜单，先移除并等待一小段时间
    if (this.disposeFunctions.has(selector)) {
      // 调用清理函数
      // 打印清理函数对象
      this.disposeFunctions.get(selector)?.()
      // 从Map中删除
      this.disposeFunctions.delete(selector)
    }

    // 确保 customLabels 是有效的对象，增加默认值防止空值
    const menuLabels = customLabels || {}
    console.log('注册菜单 ', menuLabels)
    const dispose = contextMenu({
      window: this.windowPresenter.mainWindow,
      labels: menuLabels,
      // 确保菜单项直接使用标签值
      menu: (actions, props, browserWindow, dictionarySuggestions) => {
        const menu: MenuItemConstructorOptions[] = []

        // 添加自定义复制选项
        // const hasCopyItem = menuItems.some((item) => item.action === 'copy')
        // 只有在有选中文本时才添加复制选项
        if (props.selectionText.trim().length > 0) {
          menu.push({
            label: '复制',
            click: () => {
              console.log('执行复制操作 ', props.selectionText)
              // 执行复制操作
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.copy()
              } else if ('copy' in browserWindow) {
                browserWindow.copy()
              }

              // 如果是自定义复制项，则触发相关事件
              // if (hasCopyItem) {
              //   // 触发事件总线事件
              //   eventBus.emit('context-menu-action', {
              //     action: 'copy',
              //     data: props.selectionText,
              //     selector
              //   })

              //   // 发送到渲染进程
              //   if (browserWindow instanceof BrowserWindow) {
              //     browserWindow.webContents.send('context-menu-action', {
              //       action: 'copy',
              //       data: props.selectionText,
              //       selector
              //     })
              //   }
              // }
            }
          })
        }

        // 添加自定义粘贴选项
        const hasPasteItem = menuItems.some((item) => item.action === 'paste')
        if (hasPasteItem && props.isEditable) {
          menu.push({
            label: '粘贴',
            click: () => {
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.paste()
              } else if ('paste' in browserWindow) {
                browserWindow.paste()
              }

              // // 触发事件
              // eventBus.emit('context-menu-action', {
              //   action: 'paste',
              //   data: '',
              //   selector
              // })

              // // 同时发送到渲染进程
              // if (browserWindow instanceof BrowserWindow) {
              //   browserWindow.webContents.send('context-menu-action', {
              //     action: 'paste',
              //     data: '',
              //     selector
              //   })
              // }
            }
          })
        } else if (props.isEditable) {
          // 如果没有自定义粘贴项但在可编辑区域，添加默认粘贴
          menu.push({
            label: '粘贴',
            click: () => {
              if (browserWindow instanceof BrowserWindow) {
                browserWindow.webContents.paste()
              } else if ('paste' in browserWindow) {
                browserWindow.paste()
              }
            }
          })
        }

        return menu
      }
    })

    // 保存清理函数
    this.disposeFunctions.set(selector, dispose)
  }

  /**
   * 移除特定选择器的上下文菜单
   * @param selector - 要移除菜单的CSS选择器
   */
  removeContextMenu(selector: string): void {
    if (this.disposeFunctions.has(selector)) {
      // 调用清理函数
      this.disposeFunctions.get(selector)?.()
      // 从Map中删除
      this.disposeFunctions.delete(selector)
    }
  }

  /**
   * 清理所有注册的上下文菜单
   * 通常在应用关闭时调用
   */
  dispose(): void {
    // 调用所有清理函数
    this.disposeFunctions.forEach((dispose) => dispose())
    // 清空Map
    this.disposeFunctions.clear()
  }
}
