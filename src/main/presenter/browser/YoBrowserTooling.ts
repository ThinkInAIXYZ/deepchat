import type { MCPToolDefinition } from '@shared/presenter'

const baseServer = {
  name: 'yo-browser',
  icons: '🌐',
  description: 'DeepChat built-in Yo Browser'
}

export class YoBrowserTooling {
  static getToolDefinitions(supportsVision: boolean): MCPToolDefinition[] {
    const tools: MCPToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'yo_browser_navigate',
          description: 'Navigate Yo Browser to a URL. Reuses an existing tab when possible.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'Target URL to open' },
              reuse: {
                type: 'boolean',
                description: 'Reuse an existing tab that matches the domain when true'
              }
            },
            required: ['url']
          }
        },
        server: baseServer
      },
      {
        type: 'function',
        function: {
          name: 'yo_browser_list_tabs',
          description: 'List all Yo Browser tabs with their urls and status.',
          parameters: {
            type: 'object',
            properties: {}
          }
        },
        server: baseServer
      },
      {
        type: 'function',
        function: {
          name: 'yo_browser_activate_tab',
          description: 'Activate a tab by its ID.',
          parameters: {
            type: 'object',
            properties: {
              tabId: { type: 'string', description: 'The target tab id' }
            },
            required: ['tabId']
          }
        },
        server: baseServer
      },
      {
        type: 'function',
        function: {
          name: 'yo_browser_extract_dom',
          description: 'Extract DOM content. Use a selector to limit scope when needed.',
          parameters: {
            type: 'object',
            properties: {
              tabId: { type: 'string', description: 'Tab id to read from (optional)' },
              selector: { type: 'string', description: 'CSS selector to extract content from' }
            }
          }
        },
        server: baseServer
      },
      {
        type: 'function',
        function: {
          name: 'yo_browser_evaluate_script',
          description: 'Execute JavaScript in the active tab.',
          parameters: {
            type: 'object',
            properties: {
              tabId: { type: 'string', description: 'Tab id to execute against (optional)' },
              script: { type: 'string', description: 'JavaScript snippet to run' }
            },
            required: ['script']
          }
        },
        server: baseServer
      },
      {
        type: 'function',
        function: {
          name: 'yo_browser_download_file',
          description:
            'Download a file using the browser session, preserving cookies of the active tab.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'File url to download' },
              savePath: { type: 'string', description: 'Optional file path to save as' }
            },
            required: ['url']
          }
        },
        server: baseServer
      }
    ]

    if (supportsVision) {
      tools.push({
        type: 'function',
        function: {
          name: 'yo_browser_take_screenshot',
          description:
            'Capture a screenshot of the current tab. Use fullPage for long pages when needed.',
          parameters: {
            type: 'object',
            properties: {
              tabId: { type: 'string', description: 'Tab id to capture (optional)' },
              fullPage: { type: 'boolean', description: 'Capture the full page if true' },
              quality: { type: 'number', description: 'Image quality 0-100 (optional)' }
            }
          }
        },
        server: baseServer
      })
    }

    return tools
  }
}
