// Windows MCP Server - Desktop automation and interaction tools for Windows
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'
import { exec } from 'child_process'
import { promisify } from 'util'
import { clipboard, screen } from 'electron'
import axios from 'axios'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'

const execAsync = promisify(exec)

// Windows 系统检查
function isWindows(): boolean {
  return process.platform === 'win32'
}

// 工具参数的 Zod 模式定义
const LaunchToolArgsSchema = z.object({
  name: z.string().describe('Application name to launch (e.g., "notepad", "calculator", "chrome")')
})

const PowershellToolArgsSchema = z.object({
  command: z.string().describe('PowerShell command to execute')
})

const StateToolArgsSchema = z.object({
  use_vision: z.boolean().optional().default(false).describe('Include visual screenshot in output')
})

const ClipboardToolArgsSchema = z.object({
  mode: z
    .enum(['copy', 'paste'])
    .describe('Copy text to clipboard or retrieve current clipboard content'),
  text: z.string().optional().describe('Text to copy (required for copy mode)')
})

const ClickToolArgsSchema = z.object({
  loc: z.tuple([z.number(), z.number()]).describe('Coordinates [x, y] to click'),
  button: z
    .enum(['left', 'right', 'middle'])
    .optional()
    .default('left')
    .describe('Mouse button to use'),
  clicks: z
    .number()
    .optional()
    .default(1)
    .describe('Number of clicks (1=single, 2=double, 3=triple)')
})

const TypeToolArgsSchema = z.object({
  loc: z.tuple([z.number(), z.number()]).describe('Coordinates [x, y] to click before typing'),
  text: z.string().describe('Text to type'),
  clear: z.boolean().optional().default(false).describe('Clear existing text before typing')
})

const SwitchToolArgsSchema = z.object({
  name: z
    .string()
    .describe('Application name to switch to (e.g., "notepad", "calculator", "chrome")')
})

const ScrollToolArgsSchema = z.object({
  loc: z
    .tuple([z.number(), z.number()])
    .optional()
    .describe('Coordinates [x, y] to scroll at (optional)'),
  type: z
    .enum(['horizontal', 'vertical'])
    .optional()
    .default('vertical')
    .describe('Scroll direction type'),
  direction: z
    .enum(['up', 'down', 'left', 'right'])
    .optional()
    .default('down')
    .describe('Scroll direction'),
  wheel_times: z.number().optional().default(1).describe('Number of wheel scroll units')
})

const DragToolArgsSchema = z.object({
  from_loc: z.tuple([z.number(), z.number()]).describe('Source coordinates [x, y]'),
  to_loc: z.tuple([z.number(), z.number()]).describe('Destination coordinates [x, y]')
})

const MoveToolArgsSchema = z.object({
  to_loc: z.tuple([z.number(), z.number()]).describe('Target coordinates [x, y] to move cursor to')
})

const ShortcutToolArgsSchema = z.object({
  shortcut: z.array(z.string()).describe('Key combination (e.g., ["ctrl", "c"] for copy)')
})

const KeyToolArgsSchema = z.object({
  key: z.string().describe('Key to press (e.g., "enter", "escape", "tab", "space", "f1")')
})

const WaitToolArgsSchema = z.object({
  duration: z.number().describe('Duration to wait in seconds')
})

const ScrapeToolArgsSchema = z.object({
  url: z.string().describe('Full URL including protocol (http/https) to scrape')
})

export class WindowsServer {
  private server: Server

  constructor() {
    // 只在 Windows 上初始化
    if (!isWindows()) {
      throw new Error('Windows Server is only supported on Windows')
    }

    // 创建服务器实例
    this.server = new Server(
      {
        name: 'deepchat/windows-server',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    // 设置请求处理器
    this.setupRequestHandlers()
  }

  public startServer(transport: Transport): void {
    this.server.connect(transport)
  }

  public getServer(): Server {
    return this.server
  }

  private setupRequestHandlers(): void {
    // 注册工具列表处理器
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'launch_tool',
          description:
            'Launch an application from the Windows Start Menu by name (e.g., "notepad", "calculator", "chrome")',
          inputSchema: zodToJsonSchema(LaunchToolArgsSchema)
        },
        {
          name: 'powershell_tool',
          description: 'Execute PowerShell commands and return the output with status code',
          inputSchema: zodToJsonSchema(PowershellToolArgsSchema)
        },
        {
          name: 'state_tool',
          description:
            'Capture comprehensive desktop state including focused/opened applications, interactive UI elements (buttons, text fields, menus), informative content (text, labels, status), and scrollable areas. Optionally includes visual screenshot when use_vision=True. Essential for understanding current desktop context and available UI interactions.',
          inputSchema: zodToJsonSchema(StateToolArgsSchema)
        },
        {
          name: 'clipboard_tool',
          description:
            'Copy text to clipboard or retrieve current clipboard content. Use "copy" mode with text parameter to copy, "paste" mode to retrieve.',
          inputSchema: zodToJsonSchema(ClipboardToolArgsSchema)
        },
        {
          name: 'click_tool',
          description:
            'Click on UI elements at specific coordinates. Supports left/right/middle mouse buttons and single/double/triple clicks. Use coordinates from State-Tool output.',
          inputSchema: zodToJsonSchema(ClickToolArgsSchema)
        },
        {
          name: 'type_tool',
          description:
            'Type text into input fields, text areas, or focused elements. Set clear=True to replace existing text, False to append. Click on target element coordinates first.',
          inputSchema: zodToJsonSchema(TypeToolArgsSchema)
        },
        {
          name: 'switch_tool',
          description:
            'Switch to a specific application window (e.g., "notepad", "calculator", "chrome", etc.) and bring to foreground.',
          inputSchema: zodToJsonSchema(SwitchToolArgsSchema)
        },
        {
          name: 'scroll_tool',
          description:
            'Scroll at specific coordinates or current mouse position. Use wheel_times to control scroll amount (1 wheel = ~3-5 lines). Essential for navigating lists, web pages, and long content.',
          inputSchema: zodToJsonSchema(ScrollToolArgsSchema)
        },
        {
          name: 'drag_tool',
          description:
            'Drag and drop operation from source coordinates to destination coordinates. Useful for moving files, resizing windows, or drag-and-drop interactions.',
          inputSchema: zodToJsonSchema(DragToolArgsSchema)
        },
        {
          name: 'move_tool',
          description:
            'Move mouse cursor to specific coordinates without clicking. Useful for hovering over elements or positioning cursor before other actions.',
          inputSchema: zodToJsonSchema(MoveToolArgsSchema)
        },
        {
          name: 'shortcut_tool',
          description:
            'Execute keyboard shortcuts using key combinations. Pass keys as list (e.g., ["ctrl", "c"] for copy, ["alt", "tab"] for app switching, ["win", "r"] for Run dialog).',
          inputSchema: zodToJsonSchema(ShortcutToolArgsSchema)
        },
        {
          name: 'key_tool',
          description:
            'Press individual keyboard keys. Supports special keys like "enter", "escape", "tab", "space", "backspace", "delete", arrow keys ("up", "down", "left", "right"), function keys ("f1"-"f12").',
          inputSchema: zodToJsonSchema(KeyToolArgsSchema)
        },
        {
          name: 'wait_tool',
          description:
            'Pause execution for specified duration in seconds. Useful for waiting for applications to load, animations to complete, or adding delays between actions.',
          inputSchema: zodToJsonSchema(WaitToolArgsSchema)
        },
        {
          name: 'scrape_tool',
          description:
            'Fetch and convert webpage content to markdown format. Provide full URL including protocol (http/https). Returns structured text content suitable for analysis.',
          inputSchema: zodToJsonSchema(ScrapeToolArgsSchema)
        }
      ]
    }))

    // 注册工具调用处理器
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      try {
        switch (name) {
          case 'launch_tool':
            return await this.handleLaunchTool(args)
          case 'powershell_tool':
            return await this.handlePowershellTool(args)
          case 'state_tool':
            return await this.handleStateTool(args)
          case 'clipboard_tool':
            return await this.handleClipboardTool(args)
          case 'click_tool':
            return await this.handleClickTool(args)
          case 'type_tool':
            return await this.handleTypeTool(args)
          case 'switch_tool':
            return await this.handleSwitchTool(args)
          case 'scroll_tool':
            return await this.handleScrollTool(args)
          case 'drag_tool':
            return await this.handleDragTool(args)
          case 'move_tool':
            return await this.handleMoveTool(args)
          case 'shortcut_tool':
            return await this.handleShortcutTool(args)
          case 'key_tool':
            return await this.handleKeyTool(args)
          case 'wait_tool':
            return await this.handleWaitTool(args)
          case 'scrape_tool':
            return await this.handleScrapeTool(args)
          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        }
      }
    })
  }

  private async handleLaunchTool(args: unknown) {
    const parsedArgs = LaunchToolArgsSchema.parse(args)

    try {
      // Execute PowerShell command to launch application
      const command = `Start-Process "shell:AppsFolder\$(Get-StartApps | Where-Object {$_.Name -like '*${parsedArgs.name}*'} | Select-Object -First 1 -ExpandProperty AppID)"`

      await execAsync(`powershell.exe -Command "${command}"`, { timeout: 10000 })

      return {
        content: [
          {
            type: 'text' as const,
            text: `Launched ${parsedArgs.name}.`
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to launch ${parsedArgs.name}: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }

  private async handlePowershellTool(args: unknown) {
    const parsedArgs = PowershellToolArgsSchema.parse(args)

    try {
      const { stdout, stderr } = await execAsync(
        `powershell.exe -Command "${parsedArgs.command}"`,
        {
          timeout: 30000,
          encoding: 'utf8'
        }
      )

      const output = stdout || stderr || 'Command executed successfully'

      return {
        content: [
          {
            type: 'text' as const,
            text: `Status Code: 0\nResponse: ${output}`
          }
        ]
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Status Code: ${error.code || 1}\nResponse: ${error.message || 'Command failed'}`
          }
        ]
      }
    }
  }

  private async handleStateTool(args: unknown) {
    const parsedArgs = StateToolArgsSchema.parse(args)

    try {
      // Get list of windows
      const windowsCommand = `Get-Process | Where-Object {$_.MainWindowTitle -ne ""} | Select-Object ProcessName, MainWindowTitle, Id | ConvertTo-Json`
      const { stdout: windowsData } = await execAsync(
        `powershell.exe -Command "${windowsCommand}"`,
        { timeout: 10000 }
      )

      // Get default browser
      const browserCommand = `(Get-ItemProperty HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice).ProgId`
      const { stdout: browserData } = await execAsync(
        `powershell.exe -Command "${browserCommand}"`,
        { timeout: 5000 }
      )

      // Get system language
      const langCommand = `Get-Culture | Select-Object Name | ConvertTo-Json`
      const { stdout: langData } = await execAsync(`powershell.exe -Command "${langCommand}"`, {
        timeout: 5000
      })

      let windows
      try {
        windows = JSON.parse(windowsData || '[]')
      } catch {
        windows = []
      }

      const browserMapping: Record<string, string> = {
        ChromeHTML: 'Google Chrome',
        FirefoxURL: 'Mozilla Firefox',
        MSEdgeHTM: 'Microsoft Edge',
        'IE.HTTP': 'Internet Explorer',
        OperaStable: 'Opera',
        BraveHTML: 'Brave',
        SafariHTML: 'Safari'
      }

      const defaultBrowser = browserMapping[browserData?.trim()] || 'Unknown'
      let defaultLanguage = 'Unknown'

      try {
        const langObj = JSON.parse(langData || '{}')
        defaultLanguage = langObj.Name || 'Unknown'
      } catch {
        // ignore
      }

      const activeApps = Array.isArray(windows)
        ? windows
            .map((w: any) => `Name: ${w.ProcessName} Title: ${w.MainWindowTitle} PID: ${w.Id}`)
            .join('\n')
        : 'No active windows found'

      const response = [
        `Default Browser: ${defaultBrowser}`,
        `Default Language: ${defaultLanguage}`,
        `Focused App: ${windows[0]?.ProcessName || 'None'}`,
        `Opened Apps:\n${activeApps}`,
        'List of Interactive Elements: Use UI automation tools to get detailed element information',
        'List of Informative Elements: Use UI automation tools to get detailed element information',
        'List of Scrollable Elements: Use UI automation tools to get detailed element information'
      ].join('\n\n')

      const content = [
        {
          type: 'text' as const,
          text: response
        }
      ]

      // Add screenshot if requested
      if (parsedArgs.use_vision) {
        try {
          const primaryDisplay = screen.getPrimaryDisplay()
          const { width, height } = primaryDisplay.bounds

          // Create a screenshot using Electron's desktopCapturer would require renderer process
          // For now, we'll provide a message about screenshot capability
          content.push({
            type: 'text' as const,
            text: `Screenshot capture requires renderer process integration. Screen resolution: ${width}x${height}`
          })
        } catch (screenshotError) {
          content.push({
            type: 'text' as const,
            text: `Screenshot capture failed: ${screenshotError}`
          })
        }
      }

      return { content }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to capture desktop state: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }

  private async handleClipboardTool(args: unknown) {
    const parsedArgs = ClipboardToolArgsSchema.parse(args)

    if (parsedArgs.mode === 'copy' && !parsedArgs.text) {
      throw new Error('Text is required for copy mode')
    }

    try {
      if (parsedArgs.mode === 'copy') {
        clipboard.writeText(parsedArgs.text!)
        return {
          content: [
            {
              type: 'text' as const,
              text: `Copied "${parsedArgs.text}" to clipboard`
            }
          ]
        }
      } else {
        const clipboardContent = clipboard.readText()
        return {
          content: [
            {
              type: 'text' as const,
              text: `Clipboard Content: "${clipboardContent}"`
            }
          ]
        }
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Clipboard operation failed: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }

  private async handleClickTool(args: unknown) {
    const parsedArgs = ClickToolArgsSchema.parse(args)
    const [x, y] = parsedArgs.loc

    return {
      content: [
        {
          type: 'text' as const,
          text: `Click functionality requires desktop automation capabilities that need to be implemented through Windows APIs or PowerShell commands. Requested: ${parsedArgs.clicks === 1 ? 'Single' : parsedArgs.clicks === 2 ? 'Double' : 'Triple'} ${parsedArgs.button} click at coordinates (${x}, ${y}).`
        }
      ],
      isError: true
    }
  }

  private async handleTypeTool(args: unknown) {
    const parsedArgs = TypeToolArgsSchema.parse(args)
    const [x, y] = parsedArgs.loc

    return {
      content: [
        {
          type: 'text' as const,
          text: `Type functionality requires desktop automation capabilities that need to be implemented through Windows APIs or PowerShell commands. Requested: Type "${parsedArgs.text}" at coordinates (${x}, ${y})${parsedArgs.clear ? ' (with clear existing text)' : ''}.`
        }
      ],
      isError: true
    }
  }

  private async handleSwitchTool(args: unknown) {
    const parsedArgs = SwitchToolArgsSchema.parse(args)

    try {
      // Use Alt+Tab to switch between applications or bring specific window to front
      const command = `Add-Type -TypeDefinition 'using System; using System.Diagnostics; using System.Runtime.InteropServices; public class WindowHelper { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName); }'; $proc = Get-Process | Where-Object {$_.ProcessName -like "*${parsedArgs.name}*" -and $_.MainWindowTitle -ne ""} | Select-Object -First 1; if ($proc) { [WindowHelper]::SetForegroundWindow($proc.MainWindowHandle); Write-Host "Switched to $($proc.ProcessName)"; } else { Write-Host "Process not found"; }`

      const { stdout } = await execAsync(`powershell.exe -Command "${command}"`, { timeout: 10000 })

      return {
        content: [
          {
            type: 'text' as const,
            text: stdout.includes('Switched to')
              ? `Switched to ${parsedArgs.name} window.`
              : `Failed to switch to ${parsedArgs.name} window.`
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Switch operation failed: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }

  private async handleScrollTool(args: unknown) {
    const parsedArgs = ScrollToolArgsSchema.parse(args)
    const locationText = parsedArgs.loc
      ? ` at coordinates (${parsedArgs.loc[0]}, ${parsedArgs.loc[1]})`
      : ''

    return {
      content: [
        {
          type: 'text' as const,
          text: `Scroll functionality requires desktop automation capabilities that need to be implemented through Windows APIs or PowerShell commands. Requested: Scroll ${parsedArgs.type} ${parsedArgs.direction} by ${parsedArgs.wheel_times} wheel times${locationText}.`
        }
      ],
      isError: true
    }
  }

  private async handleDragTool(args: unknown) {
    const parsedArgs = DragToolArgsSchema.parse(args)
    const [fromX, fromY] = parsedArgs.from_loc
    const [toX, toY] = parsedArgs.to_loc

    return {
      content: [
        {
          type: 'text' as const,
          text: `Drag functionality requires desktop automation capabilities that need to be implemented through Windows APIs or PowerShell commands. Requested: Drag from (${fromX}, ${fromY}) to (${toX}, ${toY}).`
        }
      ],
      isError: true
    }
  }

  private async handleMoveTool(args: unknown) {
    const parsedArgs = MoveToolArgsSchema.parse(args)
    const [x, y] = parsedArgs.to_loc

    return {
      content: [
        {
          type: 'text' as const,
          text: `Mouse move functionality requires desktop automation capabilities that need to be implemented through Windows APIs or PowerShell commands. Requested: Move mouse to (${x}, ${y}).`
        }
      ],
      isError: true
    }
  }

  private async handleShortcutTool(args: unknown) {
    const parsedArgs = ShortcutToolArgsSchema.parse(args)

    return {
      content: [
        {
          type: 'text' as const,
          text: `Keyboard shortcut functionality requires desktop automation capabilities that need to be implemented through Windows APIs or PowerShell commands. Requested: Press ${parsedArgs.shortcut.join('+')} keyboard shortcut.`
        }
      ],
      isError: true
    }
  }

  private async handleKeyTool(args: unknown) {
    const parsedArgs = KeyToolArgsSchema.parse(args)

    return {
      content: [
        {
          type: 'text' as const,
          text: `Key press functionality requires desktop automation capabilities that need to be implemented through Windows APIs or PowerShell commands. Requested: Press the key "${parsedArgs.key}".`
        }
      ],
      isError: true
    }
  }

  private async handleWaitTool(args: unknown) {
    const parsedArgs = WaitToolArgsSchema.parse(args)

    try {
      await new Promise((resolve) => setTimeout(resolve, parsedArgs.duration * 1000))

      return {
        content: [
          {
            type: 'text' as const,
            text: `Waited for ${parsedArgs.duration} seconds.`
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Wait operation failed: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }

  private async handleScrapeTool(args: unknown) {
    const parsedArgs = ScrapeToolArgsSchema.parse(args)

    try {
      const response = await axios.get(parsedArgs.url, {
        timeout: 10000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      })

      const dom = new JSDOM(response.data)
      const document = dom.window.document

      // Remove script and style elements
      const scripts = document.querySelectorAll('script, style')
      scripts.forEach((script) => script.remove())

      // Convert HTML to Markdown
      const turndownService = new TurndownService({
        headingStyle: 'atx',
        bulletListMarker: '-'
      })

      const markdown = turndownService.turndown(document.body.innerHTML)

      return {
        content: [
          {
            type: 'text' as const,
            text: `Scraped the contents of the entire webpage:\n${markdown}`
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Scrape operation failed: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }
}
