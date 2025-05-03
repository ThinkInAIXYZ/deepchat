import { BrowserWindow, Menu, MenuItemConstructorOptions, WebContents, dialog, net } from 'electron';
import path from 'path';
import sharp from 'sharp'; // 用于图片处理，需要安装 sharp 依赖

// 定义上下文菜单选项的接口
interface ContextMenuOptions {
  /** Electron 窗口实例 */
  window: BrowserWindow;
  /**
   * 可选函数，用于判断是否应该显示上下文菜单。
   * 如果返回 false，则不显示菜单。
   */
  shouldShowMenu?: (event: Electron.Event, params: Electron.ContextMenuParams) => boolean;
  /** 可选的自定义菜单项标签 */
  labels?: {
    copyImage?: string;
    saveImage?: string;
    cut?: string;
    copy?: string;
    paste?: string;
    // 可以根据需要添加更多标签
  };
  /**
   * 可选函数，用于在默认菜单项 *之前* 添加自定义菜单项。
   * 接收默认菜单项、上下文参数和窗口实例作为参数。
   */
  prepend?: (
    defaultActions: MenuItemConstructorOptions[],
    params: Electron.ContextMenuParams,
    browserWindow: BrowserWindow
  ) => MenuItemConstructorOptions[];
  /**
   * 可选函数，用于在默认菜单项 *之后* 添加自定义菜单项。
   * 接收默认菜单项、上下文参数和窗口实例作为参数。
   */
  append?: (
    defaultActions: MenuItemConstructorOptions[],
    params: Electron.ContextMenuParams,
    browserWindow: BrowserWindow
  ) => MenuItemConstructorOptions[];
  /**
   * 可选函数，用于完全自定义菜单。
   * 如果返回 MenuItemConstructorOptions[] 数组，则使用该数组构建菜单。
   * 如果返回 Menu 实例，则直接显示该 Menu 实例。
   * 如果返回 undefined 或 null，则使用默认菜单项（经过 prepend 和 append 处理）。
   */
  menu?: (
    defaultActions: MenuItemConstructorOptions[],
    params: Electron.ContextMenuParams,
    browserWindow: BrowserWindow
  ) => MenuItemConstructorOptions[] | Menu | undefined | null;
}

/**
 * 简化版的 Electron 上下文菜单实现。
 * 提供了基础的图片复制/保存和编辑（剪切/复制/粘贴）功能，
 * 并允许通过选项进行扩展和自定义。
 * 确保正确处理生命周期和监听器注销，防止内存泄漏。
 *
 * @param options 上下文菜单配置选项。
 * @returns 一个清理函数，调用它可以注销所有事件监听器。
 */
export default function contextMenu(options: ContextMenuOptions): () => void {
  const disposables: (() => void)[] = []; // 用于存放清理函数的数组
  let isDisposed = false; // 标记是否已销毁

  console.log(`[ContextMenu] 初始化上下文菜单 for window ID: ${options.window.id}`);

  // 确保 window 参数存在
  if (!options.window) {
    console.error('[ContextMenu] 初始化失败: Window 参数缺失');
    throw new Error('Window is required');
  }

  // 获取 WebContents 实例的辅助函数
  const getWebContents = (win: BrowserWindow): WebContents => win.webContents;

  /**
   * 处理 WebContents 的 'context-menu' 事件。
   */
  const handleContextMenu = async (event: Electron.Event, params: Electron.ContextMenuParams) => {
    console.log(`[ContextMenu] 触发上下文菜单事件 at (${params.x}, ${params.y}), mediaType: ${params.mediaType}`);

    if (isDisposed) {
      console.log('[ContextMenu] 已销毁，忽略上下文菜单事件');
      return;
    }

    // 检查是否应该显示菜单
    if (
      typeof options.shouldShowMenu === 'function' &&
      options.shouldShowMenu(event, params) === false
    ) {
      console.log('[ContextMenu] shouldShowMenu 返回 false，不显示菜单');
      return;
    }

    // 准备默认菜单项
    let menuItems: MenuItemConstructorOptions[] = [];

    // 处理图片右键菜单项
    if (params.mediaType === 'image') {
      // 图片复制选项
      menuItems.push({
        id: 'copyImage',
        label: options.labels?.copyImage || '复制图片',
        click: () => {
          const webContents = getWebContents(options.window);
          webContents.copyImageAt(params.x, params.y);
          console.log(`[ContextMenu] 复制图片: ${params.srcURL}`);
        }
      });

      // 图片另存为选项
      menuItems.push({
        id: 'saveImage',
        label: options.labels?.saveImage || '图片另存为...',
        click: async () => {
          try {
            const url = params.srcURL || '';
            if (!url) {
              console.warn('[ContextMenu] 保存图片失败: 图片 URL 为空');
              return;
            }

            let fileName = 'image'; // 默认文件名基础
            let fileExtension = 'png'; // 默认扩展名

            // 尝试从 URL 或 MIME 类型确定文件名和扩展名
            const isBase64 = url.startsWith('data:image/');
            if (!isBase64) {
              try {
                 // 从 URL 解析文件名和扩展名
                const urlParts = new URL(url);
                const pathname = urlParts.pathname;
                const base = path.basename(pathname);
                const ext = path.extname(base);

                if (base && ext) {
                  fileName = base.substring(0, base.length - ext.length);
                  fileExtension = ext.substring(1).toLowerCase(); // 移除点并转小写
                } else if (base) {
                   fileName = base;
                }
              } catch (e) {
                 console.warn(`[ContextMenu] 无法从 URL 解析文件名: ${url}`, e);
                 // Fallback to default
              }
            } else {
              // 处理 base64 URL
              const mimeMatch = url.match(/^data:image\/([a-zA-Z0-9]+);base64,/);
              if (mimeMatch && mimeMatch[1]) {
                fileExtension = mimeMatch[1].toLowerCase();
              }
            }

            // 确保扩展名有效
            if (!['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fileExtension)) {
                 fileExtension = 'png'; // Fallback to png if unknown
            }

            // 打开保存对话框
            const { canceled, filePath } = await dialog.showSaveDialog({
              window: options.window, // 关联到当前窗口
              defaultPath: `${fileName}.${fileExtension}`, // 提供默认文件名
              filters: [
                { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
                { name: '所有文件', extensions: ['*'] }
              ],
              title: options.labels?.saveImage || '图片另存为...'
            });

            if (canceled || !filePath) {
              console.log('[ContextMenu] 保存图片对话框取消或未选择路径');
              return;
            }

            console.log(`[ContextMenu] 开始保存图片到: ${filePath}`);

            let imageBuffer: Buffer;

            if (isBase64) {
              // 处理 base64 数据
              const base64Data = url.split(',')[1];
              if (!base64Data) {
                throw new Error('无效的 base64 图片数据');
              }
              imageBuffer = Buffer.from(base64Data, 'base64');
            } else {
              // 处理普通 URL
              try {
                const response = await net.fetch(url);
                if (!response.ok) {
                  throw new Error(`下载图片失败: HTTP 状态码 ${response.status}`);
                }
                const arrayBuffer = await response.arrayBuffer();
                imageBuffer = Buffer.from(arrayBuffer);
              } catch (fetchError) {
                 console.error(`[ContextMenu] 下载图片时发生网络错误: ${url}`, fetchError);
                 throw new Error(`下载图片失败: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
              }
            }

            if (!imageBuffer || imageBuffer.length === 0) {
              throw new Error('无法获取图片数据或数据为空');
            }

            // 使用 sharp 处理图片并保存
            const targetFileExt = path.extname(filePath).toLowerCase().substring(1);
            const sharpInstance = sharp(imageBuffer);

            // 根据目标文件扩展名处理图片格式
            switch (targetFileExt) {
              case 'jpg':
              case 'jpeg':
                await sharpInstance.jpeg({ quality: 90 }).toFile(filePath);
                break;
              case 'png':
                await sharpInstance.png().toFile(filePath);
                break;
              case 'webp':
                await sharpInstance.webp().toFile(filePath);
                break;
              case 'gif':
                 // Sharp 对 GIF 的支持有限，这里直接保存原始 buffer
                 // 如果需要更高级的 GIF 处理，可能需要其他库
                 await require('fs').promises.writeFile(filePath, imageBuffer);
                 console.warn('[ContextMenu] GIF 文件直接保存原始数据，未经过 sharp 处理');
                 break;
              default:
                // 默认尝试保存为原始格式，或者根据 sharp 的能力进行转换
                await sharpInstance.toFile(filePath);
                console.warn(`[ContextMenu] 保存为未知扩展名 ${targetFileExt}，尝试直接保存`);
                break;
            }


            console.log(`[ContextMenu] 保存图片成功: ${filePath}`);
          } catch (error) {
            console.error('[ContextMenu] 保存图片失败', error);
            dialog.showErrorBox('保存图片失败', `无法保存图片：${error instanceof Error ? error.message : String(error)}`);
          }
        }
      });

      // 添加分隔符
      menuItems.push({ type: 'separator' });
    }

    // 根据 params 添加基础编辑菜单项
    if (params.isEditable) {
      const editFlags = params.editFlags;
      // 添加基础编辑菜单
      if (editFlags.canCut) { // 剪切不需要 selectionText 检查，因为 Electron 会自动处理
        menuItems.push({
          id: 'cut',
          label: options.labels?.cut || '剪切',
          role: 'cut',
          enabled: editFlags.canCut // 启用状态取决于 canCut 标志
        });
      }

      if (editFlags.canCopy) { // 复制不需要 selectionText 检查，因为 Electron 会自动处理
        menuItems.push({
          id: 'copy',
          label: options.labels?.copy || '复制',
          role: 'copy',
          enabled: editFlags.canCopy // 启用状态取决于 canCopy 标志
        });
      }

      if (editFlags.canPaste) {
        menuItems.push({
          id: 'paste',
          label: options.labels?.paste || '粘贴',
          role: 'paste',
          enabled: editFlags.canPaste // 启用状态取决于 canPaste 标志
        });
      }
       // 添加全选菜单项
       if (editFlags.canSelectAll) {
           menuItems.push({
               id: 'selectAll',
               label: options.labels?.selectAll || '全选',
               role: 'selectAll',
               enabled: editFlags.canSelectAll
           });
       }

    } else if (params.selectionText) {
      // 非输入框内的文本选择，只提供复制
      menuItems.push({
        id: 'copy',
        label: options.labels?.copy || '复制',
        role: 'copy',
        enabled: true // 有选中文本时复制总是可用的
      });
    }

    // 允许用户在菜单前添加项目
    if (typeof options.prepend === 'function') {
      try {
        const prependItems = options.prepend(menuItems, params, options.window);
        if (Array.isArray(prependItems)) {
           menuItems = prependItems.concat(menuItems);
        } else {
           console.warn('[ContextMenu] options.prepend 函数未返回数组');
        }
      } catch (e) {
         console.error('[ContextMenu] 执行 options.prepend 函数时出错', e);
      }
    }

    // 允许用户在菜单后添加项目
    if (typeof options.append === 'function') {
       try {
         const appendItems = options.append(menuItems, params, options.window);
         if (Array.isArray(appendItems)) {
            menuItems = menuItems.concat(appendItems);
         } else {
            console.warn('[ContextMenu] options.append 函数未返回数组');
         }
       } catch (e) {
          console.error('[ContextMenu] 执行 options.append 函数时出错', e);
       }
    }

    // 允许用户完全自定义菜单
    if (typeof options.menu === 'function') {
       try {
         const customMenu = options.menu(menuItems, params, options.window);

         if (customMenu instanceof Menu) {
           // 如果返回 Menu 实例，直接显示
           console.log('[ContextMenu] 使用自定义 Menu 实例显示菜单');
           customMenu.popup({ window: options.window, x: params.x, y: params.y });
           return; // 直接返回，不走后续的构建和清理逻辑
         } else if (Array.isArray(customMenu)) {
           // 如果返回菜单项数组，替换默认菜单项
           console.log('[ContextMenu] 使用自定义菜单项数组构建菜单');
           menuItems = customMenu;
         } else if (customMenu !== undefined && customMenu !== null) {
            console.warn('[ContextMenu] options.menu 函数返回了非 Menu 实例或数组的值');
         }
         // 如果 options.menu 返回 undefined 或 null，则继续使用经过 prepend/append 处理的 menuItems
       } catch (e) {
          console.error('[ContextMenu] 执行 options.menu 函数时出错', e);
          // 如果自定义菜单函数出错，继续使用默认菜单项，避免菜单不显示
       }
    }

    // 清理多余的分隔符（连续的分隔符，开头或结尾的分隔符）
    menuItems = cleanRedundantSeparators(menuItems);

    // 创建并显示菜单
    if (menuItems.length > 0) {
      try {
        const menu = Menu.buildFromTemplate(menuItems);
        console.log(`[ContextMenu] 构建菜单成功，共有 ${menuItems.length} 项`);
        menu.popup({
          window: options.window,
          x: params.x,
          y: params.y
        });
      } catch (error) {
        console.error('[ContextMenu] 创建或显示菜单失败', error);
      }
    } else {
      console.warn('[ContextMenu] 没有可用的菜单项，不显示菜单');
    }
  };

  /**
   * 清理菜单模板中的多余分隔符。
   * 移除连续的分隔符，以及位于开头或结尾的分隔符。
   * @param menuTemplate 原始菜单项数组。
   * @returns 清理后的菜单项数组。
   */
  const cleanRedundantSeparators = (
    menuTemplate: MenuItemConstructorOptions[]
  ): MenuItemConstructorOptions[] => {
    const cleaned: MenuItemConstructorOptions[] = [];
    let lastItemWasSeparator = true; // 初始为 true，用于移除开头的分隔符

    for (const item of menuTemplate) {
      // 过滤掉不可见或无效的菜单项
      if (!item || typeof item !== 'object' || item.visible === false) {
        continue;
      }

      if (item.type === 'separator') {
        // 如果当前是分隔符，并且前一个添加的不是分隔符，则添加
        if (!lastItemWasSeparator) {
          cleaned.push(item);
          lastItemWasSeparator = true;
        }
      } else {
        // 如果不是分隔符，直接添加
        cleaned.push(item);
        lastItemWasSeparator = false;
      }
    }

    // 移除末尾的分隔符（如果存在）
    if (cleaned.length > 0 && cleaned[cleaned.length - 1].type === 'separator') {
      cleaned.pop();
    }

    return cleaned;
  };

  /**
   * 初始化上下文菜单监听器。
   * @param win 要关联的窗口实例。
   */
  const initialize = (win: BrowserWindow) => {
    if (isDisposed) {
      console.log('[ContextMenu] 已销毁，跳过初始化');
      return;
    }

    try {
      const webContents = getWebContents(win);

      // 添加上下文菜单事件监听器
      webContents.on('context-menu', handleContextMenu);

      // 当 WebContents 被销毁时清理监听器
      const cleanupOnDestroy = () => {
        console.log(`[ContextMenu] WebContents for window ID ${win.id} 已销毁，执行清理`);
        // 移除 context-menu 监听器
        webContents.removeListener('context-menu', handleContextMenu);
        // 移除自身监听器，防止重复调用
        webContents.removeListener('destroyed', cleanupOnDestroy);
        // 标记为已销毁，防止后续事件处理
        isDisposed = true;
        // 清空 disposables 数组
        disposables.length = 0;
      };

      // 监听 WebContents 的 destroyed 事件
      webContents.once('destroyed', cleanupOnDestroy);

      // 将清理函数添加到待清理列表
      disposables.push(() => {
        console.log(`[ContextMenu] 执行清理函数 for window ID ${win.id}`);
        webContents.removeListener('context-menu', handleContextMenu);
        webContents.removeListener('destroyed', cleanupOnDestroy);
      });

      console.log(`[ContextMenu] 上下文菜单监听器已为 window ID ${win.id} 初始化`);

    } catch (error) {
      console.error('[ContextMenu] 初始化失败', error);
    }
  };

  // 注册窗口的上下文菜单
  initialize(options.window);

  // 返回清理函数
  return () => {
    if (isDisposed) {
      console.log('[ContextMenu] 已经销毁，跳过重复清理');
      return;
    }

    console.log(`[ContextMenu] 调用清理函数 for window ID ${options.window.id}`);
    // 执行所有清理函数
    for (const dispose of disposables) {
      dispose();
    }

    disposables.length = 0;
    isDisposed = true;
    console.log('[ContextMenu] 清理完成');
  };
}
