import { BrowserWindow, Menu, MenuItemConstructorOptions, WebContents, dialog, net, ipcMain, clipboard } from 'electron'
import fs from 'fs/promises'
import path from 'path' // path is already here, fs and clipboard are new
import sharp from 'sharp'

interface ContextMenuOptions {
  webContents: WebContents
  shouldShowMenu?: (event: Electron.Event, params: Electron.ContextMenuParams) => boolean
  labels?: Record<string, string>
  prepend?: (
    defaultActions: MenuItemConstructorOptions[],
    params: Electron.ContextMenuParams,
    webContents: WebContents
  ) => MenuItemConstructorOptions[]
  append?: (
    defaultActions: MenuItemConstructorOptions[],
    params: Electron.ContextMenuParams,
    webContents: WebContents
  ) => MenuItemConstructorOptions[]
  menu?: (
    defaultActions: MenuItemConstructorOptions[],
    params: Electron.ContextMenuParams,
    webContents: WebContents
  ) => MenuItemConstructorOptions[] | Menu
}

let activeFileContextMenuData: { fileName: string; mimeType: string; filePath?: string; isArtifact: boolean; content?: string; } | null = null;

ipcMain.on('show-file-context-menu', (event, fileDetails: { fileName: string; mimeType: string; filePath?: string; content?: string; isArtifact: boolean }) => {
  // event.sender can be used to associate this with a specific WebContents if needed
  activeFileContextMenuData = fileDetails;
});

/**
 * 简化版的上下文菜单实现
 * 只包含基础功能，确保正确处理生命周期和监听器注销
 */
export default function contextMenu(options: ContextMenuOptions): () => void {
  const disposables: (() => void)[] = []
  let isDisposed = false

  console.log('contextMenu: initializing context menu', options.webContents.id)

  // 确保 webContents 参数存在
  if (!options.webContents) {
    console.error('contextMenu: WebContents parameter is missing')
    throw new Error('WebContents is required')
  }

  // 处理上下文菜单事件
  const handleContextMenu = (event: Electron.Event, params: Electron.ContextMenuParams) => {
    // console.log('contextMenu: trigger', params.x, params.y, params.mediaType)

    if (isDisposed) {
      return
    }

    // 检查是否应该显示菜单
    if (
      typeof options.shouldShowMenu === 'function' &&
      options.shouldShowMenu(event, params) === false
    ) {
      return
    }

    // 准备默认菜单项 - 提供一些基础菜单项
    let menuItems: MenuItemConstructorOptions[] = []

    // 处理图片右键菜单
    if (params.mediaType === 'image') {
      // 图片复制选项
      menuItems.push({
        id: 'copyImage',
        label: options.labels?.copyImage || '复制图片',
        click: () => {
          options.webContents.copyImageAt(params.x, params.y)
          console.log('contextMenu: copying image', params.srcURL)
        }
      })

      // 图片另存为选项
      menuItems.push({
        id: 'saveImage',
        label: options.labels?.saveImage || '图片另存为...',
        click: async () => {
          try {
            // 获取文件名和URL
            const url = params.srcURL || ''
            let fileName = 'image.png'
            let imageBuffer: Buffer | null = null

            // 检查是否为base64格式
            const isBase64 = url.startsWith('data:image/')
            if (!isBase64) {
              // 普通URL使用路径中的文件名
              fileName = path.basename(url || 'image.png')
            } else {
              // base64URL使用默认文件名
              // 尝试从MIME类型识别扩展名
              const mimeMatch = url.match(/^data:image\/([a-zA-Z0-9]+);base64,/)
              if (mimeMatch && mimeMatch[1]) {
                const ext = mimeMatch[1].toLowerCase()
                fileName = `image.${ext === 'jpeg' ? 'jpg' : ext}`
              }
            }

            // 打开保存对话框
            const { canceled, filePath } = await dialog.showSaveDialog({
              defaultPath: fileName,
              filters: [
                { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
                { name: '所有文件', extensions: ['*'] }
              ]
            })

            if (canceled || !filePath) {
              return
            }

            console.log('contextMenu: start saving pic', filePath)

            // 获取图片数据
            if (isBase64) {
              // 处理base64数据
              const base64Data = url.split(',')[1]
              if (!base64Data) {
                throw new Error('无效的base64图片数据')
              }
              imageBuffer = Buffer.from(base64Data, 'base64')
            } else {
              // 处理普通URL
              const response = await net.fetch(url)
              if (!response.ok) {
                throw new Error(`下载图片失败: ${response.status}`)
              }
              imageBuffer = Buffer.from(await response.arrayBuffer())
            }

            if (!imageBuffer) {
              throw new Error('无法获取图片数据')
            }

            // 使用sharp处理图片并保存
            const fileExt = path.extname(filePath).toLowerCase().substring(1)

            // 根据目标文件扩展名处理图片格式
            const sharpInstance = sharp(imageBuffer)

            if (fileExt === 'jpg' || fileExt === 'jpeg') {
              await sharpInstance.jpeg({ quality: 90 }).toFile(filePath)
            } else if (fileExt === 'png') {
              await sharpInstance.png().toFile(filePath)
            } else if (fileExt === 'webp') {
              await sharpInstance.webp().toFile(filePath)
            } else if (fileExt === 'gif') {
              await sharpInstance.gif().toFile(filePath)
            } else {
              // 默认保存为原始格式
              await sharpInstance.toFile(filePath)
            }

            console.log('contextMenu: pic saved ', filePath)
          } catch (error) {
            console.error('contextMenu: pic save failed', error)
          }
        }
      })

      // 添加分隔符
      menuItems.push({ type: 'separator' })
    }

    const currentFileDetails = activeFileContextMenuData; // Capture current value
    if (currentFileDetails) {
      // It's a file context menu triggered via IPC
      menuItems.push({
        id: 'copyFile',
        label: options.labels?.copyFile || 'Copy File', // Add 'copyFile' to labels later
        click: async () => {
          if (!currentFileDetails) {
            console.warn('CopyFile: No currentFileDetails available.');
            return;
          }

          try {
            if (currentFileDetails.isArtifact && currentFileDetails.content) {
              // Handle artifacts with direct content (e.g., markdown text from ArtifactPreview)
              clipboard.writeText(currentFileDetails.content);
              console.log('Copied artifact content to clipboard:', currentFileDetails.fileName);
              // Optionally, show a success notification
              // dialog.showMessageBox({ type: 'info', message: 'Artifact content copied to clipboard.' });
            } else if (currentFileDetails.filePath) {
              const filePath = currentFileDetails.filePath;
              const mimeType = currentFileDetails.mimeType || ''; // Ensure mimeType is a string

              if (mimeType.startsWith('text/')) {
                const textContent = await fs.readFile(filePath, 'utf-8');
                clipboard.writeText(textContent);
                console.log('Copied text file content to clipboard:', filePath);
              } else {
                // For non-text files (PDF, images if not handled by 'Copy Image', etc.)
                // Use clipboard.writeFiles to copy the file reference(s).
                // This allows pasting the file into the OS file explorer.
                clipboard.writeFiles([filePath]);
                console.log('Copied file reference to clipboard:', filePath);
                // Optionally, notify user that the file path/reference was copied.
                // dialog.showMessageBox({ type: 'info', message: `File '${path.basename(filePath)}' reference copied to clipboard.` });
              }
            } else {
              console.warn('CopyFile: No content or file path available for:', currentFileDetails.fileName);
              dialog.showErrorBox('Copy Error', `No content or file path found for ${currentFileDetails.fileName}.`);
            }
          } catch (error: any) {
            console.error('Failed to copy file:', error);
            dialog.showErrorBox('Copy Error', `Failed to copy the file to the clipboard: ${error.message}`);
          }
        }
      });

      menuItems.push({
        id: 'saveFileAs',
        label: options.labels?.saveFileAs || 'Save File As...', // Add 'saveFileAs' to labels later
        click: async () => {
          if (!currentFileDetails) {
            console.warn('SaveFileAs: No currentFileDetails available.');
            return;
          }

          try {
            const suggestedFileName = currentFileDetails.fileName;
            // TODO: We could try to create more specific filters based on currentFileDetails.mimeType
            // For example: { name: 'PDF Document', extensions: ['pdf'] }
            // For now, a generic approach.
            const filters = [{ name: 'All Files', extensions: ['*'] }];
            if (currentFileDetails.mimeType) {
                // Add a filter based on the known MIME type if available
                // This is a simple example; a more robust solution would map MIME to extensions
                const ext = currentFileDetails.fileName.includes('.') ? currentFileDetails.fileName.split('.').pop() : undefined;
                if (ext) {
                    filters.unshift({ name: currentFileDetails.mimeType, extensions: [ext] });
                }
            }


            const { canceled, filePath: chosenPath } = await dialog.showSaveDialog({
              defaultPath: suggestedFileName,
              filters: filters
            });

            if (canceled || !chosenPath) {
              console.log('SaveFileAs: Dialog was canceled or no path chosen.');
              return;
            }

            if (currentFileDetails.isArtifact && currentFileDetails.content) {
              // Handle artifacts with direct content (e.g., markdown text)
              await fs.writeFile(chosenPath, currentFileDetails.content, 'utf-8');
              console.log('Saved artifact content to:', chosenPath);
            } else if (currentFileDetails.filePath) {
              // Handle files with an existing filePath by copying the file
              await fs.copyFile(currentFileDetails.filePath, chosenPath);
              console.log('Copied file from', currentFileDetails.filePath, 'to:', chosenPath);
            } else {
              console.warn('SaveFileAs: No content or file path available for saving:', currentFileDetails.fileName);
              dialog.showErrorBox('Save Error', `No content or file path found for ${currentFileDetails.fileName} to save.`);
              return; // Important to return here
            }

            // Optionally, notify user of success
            // dialog.showMessageBox({ type: 'info', message: `File saved successfully to ${chosenPath}` });

          } catch (error: any) {
            console.error('Failed to save file:', error);
            dialog.showErrorBox('Save Error', `Failed to save the file: ${error.message}`);
          }
        }
      });

      menuItems.push({ type: 'separator' });
      activeFileContextMenuData = null; // Reset after use
    }

    // 根据 labels 设置添加基础菜单项
    if (params.isEditable) {
      const editFlags = params.editFlags
      // 添加基础编辑菜单
      if (editFlags.canCut && params.selectionText) {
        menuItems.push({
          id: 'cut',
          label: options.labels?.cut || '剪切',
          role: 'cut',
          enabled: true
        })
      }

      if (editFlags.canCopy && params.selectionText) {
        menuItems.push({
          id: 'copy',
          label: options.labels?.copy || '复制',
          role: 'copy',
          enabled: true
        })
      }

      if (editFlags.canPaste) {
        menuItems.push({
          id: 'paste',
          label: options.labels?.paste || '粘贴',
          role: 'paste',
          enabled: true
        })
      }
    } else if (params.selectionText) {
      // 非输入框内的文本选择
      menuItems.push({
        id: 'copy',
        label: options.labels?.copy || '复制',
        role: 'copy',
        enabled: true
      })

      // 添加分隔符
      menuItems.push({ type: 'separator' })

      // 添加翻译选项
      menuItems.push({
        id: 'translate',
        label: options.labels?.translate || '翻译',
        click: () => {
          options.webContents.send(
            'context-menu-translate',
            params.selectionText,
            params.x,
            params.y
          )
        }
      })

      // 添加AI询问选项
      menuItems.push({
        id: 'askAI',
        label: options.labels?.askAI || '询问AI',
        click: () => {
          options.webContents.send('context-menu-ask-ai', params.selectionText)
        }
      })
    }

    // 允许用户在菜单前添加项目
    if (typeof options.prepend === 'function') {
      const prependItems = options.prepend(menuItems, params, options.webContents)
      menuItems = prependItems.concat(menuItems)
    }

    // 允许用户在菜单后添加项目
    if (typeof options.append === 'function') {
      const appendItems = options.append(menuItems, params, options.webContents)
      menuItems = menuItems.concat(appendItems)
    }

    // 允许用户完全自定义菜单
    if (typeof options.menu === 'function') {
      const customMenu = options.menu(menuItems, params, options.webContents)

      if (Array.isArray(customMenu)) {
        menuItems = customMenu
      } else {
        // 如果是一个 Menu 实例，直接显示
        const window = BrowserWindow.fromWebContents(options.webContents)
        if (window) {
          customMenu.popup({ window })
        }
        return
      }
    }

    // 清理分隔符（避免连续的分隔符或开头/结尾的分隔符）
    menuItems = removeUnusedMenuItems(menuItems)

    // 创建并显示菜单
    if (menuItems.length > 0) {
      try {
        const menu = Menu.buildFromTemplate(menuItems)
        console.log('contextMenu: displaying menu')
        const window = BrowserWindow.fromWebContents(options.webContents)
        if (window) {
          menu.popup({
            window,
            x: params.x,
            y: params.y
          })
        }
      } catch (error) {
        console.error('contextMenu: create error', error)
      }
    } else {
      console.warn('contextMenu: The menu will not be displayed')
      // If no menu is shown, but we had file data, reset it.
      if (activeFileContextMenuData) {
        activeFileContextMenuData = null;
      }
    }
  }

  // 清理连续分隔符
  const removeUnusedMenuItems = (
    menuTemplate: MenuItemConstructorOptions[]
  ): MenuItemConstructorOptions[] => {
    let notDeletedPreviousElement: MenuItemConstructorOptions | undefined

    return (
      menuTemplate
        // 过滤掉不可见或未定义的菜单项
        .filter((menuItem): menuItem is MenuItemConstructorOptions => {
          return (
            menuItem !== undefined && typeof menuItem === 'object' && menuItem.visible !== false
          )
        })
        // 过滤掉不必要的分隔符
        .filter((menuItem, index, array) => {
          const toDelete =
            menuItem.type === 'separator' &&
            (!notDeletedPreviousElement ||
              index === array.length - 1 ||
              array[index + 1].type === 'separator')

          notDeletedPreviousElement = toDelete ? notDeletedPreviousElement : menuItem
          return !toDelete
        })
    )
  }

  // 初始化上下文菜单
  const initialize = (webContents: WebContents) => {
    if (isDisposed) {
      return
    }

    try {
      // 添加上下文菜单事件监听器
      webContents.on('context-menu', handleContextMenu)

      // 当 WebContents 被销毁时清理
      const cleanup = () => {
        webContents.removeListener('context-menu', handleContextMenu)
      }

      webContents.once('destroyed', cleanup)

      // 添加到待清理列表
      disposables.push(() => {
        webContents.removeListener('context-menu', handleContextMenu)
        webContents.removeListener('destroyed', cleanup)
      })
    } catch (error) {
      console.error('contextMenu: init error', error)
    }
  }

  // 注册 WebContents
  initialize(options.webContents)

  // 返回清理函数
  return () => {
    if (isDisposed) {
      console.log('contextMenu: already disposed, skipping cleanup')
      return
    }

    console.log('contextMenu: starting cleanup')
    // 清理所有监听器
    for (const dispose of disposables) {
      dispose()
    }

    disposables.length = 0
    isDisposed = true
    console.log('contextMenu: cleanup completed')
  }
}
