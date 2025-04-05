import { app } from 'electron'
import { presenter } from '@/presenter'
import { IDeeplinkPresenter, MCPServerConfig } from '@shared/presenter'
import path from 'path'
import { DEEPLINK_EVENTS, WINDOW_EVENTS } from '@/events'
import { eventBus } from '@/eventbus'

interface MCPInstallConfig {
  mcpServers: Record<
    string,
    {
      command?: string
      args?: string[]
      env?: Record<string, string>
      descriptions?: string
      icons?: string
      autoApprove?: string[]
      disable?: boolean
      url?: string
      type?: 'sse' | 'stdio' | 'http'
    }
  >
}

/**
 * DeepLink 处理器类
 * 负责处理 deepchat:// 协议的链接
 * deepchat://start 唤起应用，进入到默认的新会话界面
 * deepchat://start?msg=你好 唤起应用，进入新会话界面，并且带上默认消息
 * deepchat://start?msg=你好&model=deepseek-chat 唤起应用，进入新会话界面，并且带上默认消息，model先进行完全匹配，选中第一个命中的。没有命中的就进行模糊匹配，只要包含这个字段的第一个返回，如果都没有就忽略用默认
 * deepchat://mcp/install?json=base64JSONData 通过json数据直接安装mcp
 */
export class DeeplinkPresenter implements IDeeplinkPresenter {
  private startupUrl: string | null = null

  init(): void {
    // 注册协议处理器
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('deepchat', process.execPath, [
          path.resolve(process.argv[1])
        ])
      }
    } else {
      app.setAsDefaultProtocolClient('deepchat')
    }

    // 处理 macOS 上协议被调用的情况
    app.on('open-url', (event, url) => {
      event.preventDefault()
      if (!app.isReady()) {
        console.log('应用程序尚未就绪，保存 URL:', url)
        this.startupUrl = url
      } else {
        console.log('应用程序已就绪，直接处理 URL:', url)
        this.handleDeepLink(url)
      }
    })

    // 监听窗口准备好的事件
    eventBus.on(WINDOW_EVENTS.READY_TO_SHOW, () => {
      console.log('窗口准备就绪，检查是否有待处理的 URL')
      if (this.startupUrl) {
        console.log('处理启动时保存的 URL:', this.startupUrl)
        this.handleDeepLink(this.startupUrl)
        this.startupUrl = null
      }
    })

    // 处理 Windows 上协议被调用的情况
    const gotTheLock = app.requestSingleInstanceLock()
    if (!gotTheLock) {
      app.quit()
    } else {
      app.on('second-instance', (_event, commandLine) => {
        // 用户尝试运行第二个实例，我们应该聚焦到我们的窗口
        if (presenter.windowPresenter.mainWindow) {
          if (presenter.windowPresenter.mainWindow.isMinimized()) {
            presenter.windowPresenter.mainWindow.restore()
          }
          presenter.windowPresenter.mainWindow.show()
          presenter.windowPresenter.mainWindow.focus()
        }
        if (process.platform === 'win32') {
          // 在 Windows 上，命令行参数包含协议 URL
          const deepLinkUrl = commandLine.find((arg) => arg.startsWith('deepchat://'))
          if (deepLinkUrl) {
            if (!app.isReady()) {
              console.log('Windows: 应用程序尚未就绪，保存 URL:', deepLinkUrl)
              this.startupUrl = deepLinkUrl
            } else {
              console.log('Windows: 应用程序已就绪，直接处理 URL:', deepLinkUrl)
              this.handleDeepLink(deepLinkUrl)
            }
          }
        }
      })
    }
  }

  async handleDeepLink(url: string): Promise<void> {
    console.log('收到 DeepLink:', url)

    try {
      const urlObj = new URL(url)

      if (urlObj.protocol !== 'deepchat:') {
        console.error('不支持的协议:', urlObj.protocol)
        return
      }

      // 从 hostname 获取命令
      const command = urlObj.hostname

      // 处理不同的命令
      if (command === 'start') {
        await this.handleStart(urlObj.searchParams)
      } else if (command === 'mcp') {
        // 处理 mcp/install 命令
        const subCommand = urlObj.pathname.slice(1) // 移除开头的斜杠
        if (subCommand === 'install') {
          await this.handleMcpInstall(urlObj.searchParams)
        } else {
          console.warn('未知的 MCP 子命令:', subCommand)
        }
      } else {
        console.warn('未知的 DeepLink 命令:', command)
      }
    } catch (error) {
      console.error('处理 DeepLink 时出错:', error)
    }
  }

  async handleStart(params: URLSearchParams): Promise<void> {
    console.log('处理 start 命令，参数:', Object.fromEntries(params.entries()))

    let msg = params.get('msg')
    if (!msg) {
      return
    }
    msg = decodeURIComponent(msg)
    // 如果有模型参数，尝试设置
    let modelId = params.get('model')
    if (modelId && modelId.trim() !== '') {
      modelId = decodeURIComponent(modelId)
    }
    let systemPrompt = params.get('system')
    if (systemPrompt && systemPrompt.trim() !== '') {
      systemPrompt = decodeURIComponent(systemPrompt)
    } else {
      systemPrompt = ''
    }
    console.log('msg:', msg)
    console.log('modelId:', modelId)
    console.log('systemPrompt:', systemPrompt)
    eventBus.emit(DEEPLINK_EVENTS.START, { msg, modelId, systemPrompt })
  }

  async handleMcpInstall(params: URLSearchParams): Promise<void> {
    console.log('处理 mcp/install 命令，参数:', Object.fromEntries(params.entries()))

    // 获取 JSON 数据
    const jsonBase64 = params.get('code')
    if (!jsonBase64) {
      console.error("缺少 'code' 参数")
      return
    }

    try {
      // 解码 Base64 并解析 JSON
      const jsonString = Buffer.from(jsonBase64, 'base64').toString('utf-8')

      const mcpConfig = JSON.parse(jsonString) as MCPInstallConfig

      // 检查 MCP 配置是否有效
      if (!mcpConfig || !mcpConfig.mcpServers) {
        console.error('无效的 MCP 配置：缺少 mcpServers 字段')
        return
      }

      // 遍历并安装所有 MCP 服务器
      for (const [serverName, serverConfig] of Object.entries(mcpConfig.mcpServers)) {
        let determinedType: 'sse' | 'stdio' | null = null
        const determinedCommand: string | undefined = serverConfig.command
        const determinedUrl: string | undefined = serverConfig.url

        // 1. Check explicit type
        if (serverConfig.type) {
          if (serverConfig.type === 'stdio' || serverConfig.type === 'sse') {
            determinedType = serverConfig.type
            // Validate required fields based on explicit type
            if (determinedType === 'stdio' && !determinedCommand) {
              console.error(`服务器 ${serverName} 类型为 'stdio' 但缺少必需的 'command' 字段`)
              continue
            }
            if (determinedType === 'sse' && !determinedUrl) {
              console.error(`服务器 ${serverName} 类型为 'sse' 但缺少必需的 'url' 字段`)
              continue
            }
          } else {
            console.error(
              `服务器 ${serverName} 提供了无效的 'type' 值: ${serverConfig.type}，应为 'stdio' 或 'sse'`
            )
            continue
          }
        } else {
          // 2. Infer type if not provided
          const hasCommand = !!determinedCommand && determinedCommand.trim() !== ''
          const hasUrl = !!determinedUrl && determinedUrl.trim() !== ''

          if (hasCommand && hasUrl) {
            console.error(
              `服务器 ${serverName} 同时提供了 'command' 和 'url' 字段，但未指定 'type'。请明确指定 'type' 为 'stdio' 或 'sse'。`
            )
            continue
          } else if (hasCommand) {
            determinedType = 'stdio'
          } else if (hasUrl) {
            determinedType = 'sse'
          } else {
            console.error(
              `服务器 ${serverName} 必须提供 'command' (用于 stdio) 或 'url' (用于 sse) 字段之一`
            )
            continue
          }
        }

        // Safeguard check (should not be reached if logic is correct)
        if (!determinedType) {
          console.error(`无法确定服务器 ${serverName} 的类型 ('stdio' 或 'sse')`)
          continue
        }

        // Set default values based on determined type
        const defaultConfig: Partial<MCPServerConfig> = {
          env: {},
          descriptions: `${serverName} MCP 服务`,
          icons: determinedType === 'stdio' ? '🔌' : '🌐', // Different default icons
          autoApprove: ['all'],
          disable: false,
          args: [],
          baseUrl: '',
          command: '',
          type: determinedType
        }

        // Merge configuration
        const finalConfig: MCPServerConfig = {
          env: { ...defaultConfig.env, ...serverConfig.env },
          descriptions: serverConfig.descriptions || defaultConfig.descriptions!,
          icons: serverConfig.icons || defaultConfig.icons!,
          autoApprove: serverConfig.autoApprove || defaultConfig.autoApprove!,
          disable: serverConfig.disable ?? defaultConfig.disable!,
          args: serverConfig.args || defaultConfig.args!,
          type: determinedType, // Use the determined type
          // Set command or baseUrl based on type, prioritizing provided values
          command: determinedType === 'stdio' ? determinedCommand! : defaultConfig.command!,
          baseUrl: determinedType === 'sse' ? determinedUrl! : defaultConfig.baseUrl!
        }

        // 安装 MCP 服务器
        console.log(`准备安装 MCP 服务器: ${serverName} (类型: ${determinedType})`, finalConfig)
        const resultServerConfig = {
          mcpServers: {
            [serverName]: finalConfig
          }
        }
        // 如果配置中指定了该服务器为默认服务器，则添加到默认服务器列表
        eventBus.emit(DEEPLINK_EVENTS.MCP_INSTALL, {
          mcpConfig: JSON.stringify(resultServerConfig)
        })
      }
      console.log('所有 MCP 服务器处理完成')
    } catch (error) {
      console.error('解析或处理 MCP 配置时出错:', error)
    }
  }
}
