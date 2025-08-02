// Windows MCP Server - Desktop automation and interaction tools for Windows
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'

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

    return {
      content: [
        {
          type: 'text' as const,
          text: `Windows MCP Server: This tool would launch "${parsedArgs.name}". Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
    }
  }

  private async handlePowershellTool(args: unknown) {
    const parsedArgs = PowershellToolArgsSchema.parse(args)

    return {
      content: [
        {
          type: 'text' as const,
          text: `Windows MCP Server: This tool would execute PowerShell command "${parsedArgs.command}". Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
    }
  }

  private async handleStateTool(args: unknown) {
    const parsedArgs = StateToolArgsSchema.parse(args)

    return {
      content: [
        {
          type: 'text' as const,
          text: `Windows MCP Server: This tool would capture desktop state${parsedArgs.use_vision ? ' with screenshot' : ''}. Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
    }
  }

  private async handleClipboardTool(args: unknown) {
    const parsedArgs = ClipboardToolArgsSchema.parse(args)

    if (parsedArgs.mode === 'copy' && !parsedArgs.text) {
      throw new Error('Text is required for copy mode')
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Windows MCP Server: This tool would ${parsedArgs.mode} clipboard${parsedArgs.mode === 'copy' ? ` with text "${parsedArgs.text}"` : ''}. Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
    }
  }

  private async handleClickTool(args: unknown) {
    const parsedArgs = ClickToolArgsSchema.parse(args)
    const [x, y] = parsedArgs.loc

    return {
      content: [
        {
          type: 'text' as const,
          text: `Windows MCP Server: This tool would perform ${parsedArgs.clicks === 1 ? 'single' : parsedArgs.clicks === 2 ? 'double' : 'triple'} ${parsedArgs.button} click at coordinates (${x}, ${y}). Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
    }
  }

  private async handleTypeTool(args: unknown) {
    const parsedArgs = TypeToolArgsSchema.parse(args)
    const [x, y] = parsedArgs.loc

    return {
      content: [
        {
          type: 'text' as const,
          text: `Windows MCP Server: This tool would click at (${x}, ${y}) and type "${parsedArgs.text}"${parsedArgs.clear ? ' (clearing existing text first)' : ''}. Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
    }
  }

  private async handleSwitchTool(args: unknown) {
    const parsedArgs = SwitchToolArgsSchema.parse(args)

    return {
      content: [
        {
          type: 'text' as const,
          text: `Windows MCP Server: This tool would switch to "${parsedArgs.name}" window. Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
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
          text: `Windows MCP Server: This tool would scroll ${parsedArgs.type} ${parsedArgs.direction} ${parsedArgs.wheel_times} wheel times${locationText}. Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
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
          text: `Windows MCP Server: This tool would drag from (${fromX}, ${fromY}) to (${toX}, ${toY}). Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
    }
  }

  private async handleMoveTool(args: unknown) {
    const parsedArgs = MoveToolArgsSchema.parse(args)
    const [x, y] = parsedArgs.to_loc

    return {
      content: [
        {
          type: 'text' as const,
          text: `Windows MCP Server: This tool would move mouse cursor to (${x}, ${y}). Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
    }
  }

  private async handleShortcutTool(args: unknown) {
    const parsedArgs = ShortcutToolArgsSchema.parse(args)

    return {
      content: [
        {
          type: 'text' as const,
          text: `Windows MCP Server: This tool would press keyboard shortcut ${parsedArgs.shortcut.join('+')}. Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
    }
  }

  private async handleKeyTool(args: unknown) {
    const parsedArgs = KeyToolArgsSchema.parse(args)

    return {
      content: [
        {
          type: 'text' as const,
          text: `Windows MCP Server: This tool would press key "${parsedArgs.key}". Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
    }
  }

  private async handleWaitTool(args: unknown) {
    const parsedArgs = WaitToolArgsSchema.parse(args)

    return {
      content: [
        {
          type: 'text' as const,
          text: `Windows MCP Server: This tool would wait for ${parsedArgs.duration} seconds. Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
    }
  }

  private async handleScrapeTool(args: unknown) {
    const parsedArgs = ScrapeToolArgsSchema.parse(args)

    return {
      content: [
        {
          type: 'text' as const,
          text: `Windows MCP Server: This tool would scrape content from "${parsedArgs.url}". Implementation requires Windows-specific libraries and should be connected to external Windows MCP server process.`
        }
      ]
    }
  }
}
