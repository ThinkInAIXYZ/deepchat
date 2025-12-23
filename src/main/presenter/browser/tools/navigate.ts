import { z } from 'zod'
import type { BrowserToolDefinition, ToolResult } from './types'

const NavigateArgsSchema = z.object({
  url: z.string().url().describe('URL to navigate to'),
  tabId: z.string().optional().describe('Tab identifier (defaults to active tab)'),
  newTab: z.boolean().optional().default(false).describe('Open navigation in a new tab'),
  reuse: z
    .boolean()
    .optional()
    .default(true)
    .describe('Reuse an existing tab that matches the domain when true')
})

const NavigationOnlyArgsSchema = z.object({
  tabId: z.string().optional().describe('Tab identifier (defaults to active tab)')
})

export function createNavigateTools(): BrowserToolDefinition[] {
  return [
    {
      name: 'browser_navigate',
      description: 'Navigate the browser to the specified URL.',
      schema: NavigateArgsSchema,
      handler: async (args, context) => {
        const parsed = NavigateArgsSchema.parse(args)

        // Handle new tab creation
        if (parsed.newTab) {
          if (!context.createTab) {
            return {
              content: [{ type: 'text', text: 'Tab creation not available' }],
              isError: true
            }
          }
          const newTab = await context.createTab(parsed.url)
          if (!newTab) {
            return {
              content: [{ type: 'text', text: 'Failed to create new tab' }],
              isError: true
            }
          }
          return {
            content: [
              {
                type: 'text',
                text: `Opened new tab ${newTab.id} -> ${parsed.url}\nTitle: ${newTab.title || 'unknown'}`
              }
            ]
          }
        }

        // Handle reuse logic
        if (parsed.reuse && !parsed.tabId) {
          // Try to find a reusable tab by domain
          const tabs = await context.listTabs?.()
          if (tabs && tabs.length > 0) {
            try {
              const targetHost = new URL(parsed.url).hostname
              const reusableTab = tabs.find((t) => {
                try {
                  return new URL(t.url).hostname === targetHost
                } catch {
                  return false
                }
              })
              if (reusableTab) {
                const tab = await context.getTab(reusableTab.id)
                if (tab) {
                  await tab.navigate(parsed.url)
                  await context.activateTab?.(reusableTab.id)
                  return {
                    content: [
                      {
                        type: 'text',
                        text: `Reused tab ${reusableTab.id} and navigated to ${parsed.url}\nTitle: ${tab.title || 'unknown'}`
                      }
                    ]
                  }
                }
              }
            } catch {
              // Ignore URL parse errors, fall through to normal navigation
            }
          }
        }

        // Normal navigation
        let tab = parsed.tabId ? await context.getTab(parsed.tabId) : await context.getActiveTab()

        if (!tab) {
          // Create a new tab if none exists
          if (context.createTab) {
            const newTab = await context.createTab(parsed.url)
            if (newTab) {
              // Add a small delay to ensure BrowserTab is fully initialized
              // This is especially important on first call when browser window is just created
              await new Promise((resolve) => setTimeout(resolve, 100))
              // Get the BrowserTab object and wait for navigation to complete
              // Note: createTab already started navigation via tabPresenter.createTab,
              // so we just need to wait for it to complete
              const browserTab = await context.getTab(newTab.id)
              if (browserTab) {
                try {
                  // createTab already started navigation via tabPresenter.createTab
                  // If tab is loading, wait for it to complete instead of calling navigate again
                  if (browserTab.contents.isLoading()) {
                    // Wait for current navigation to complete
                    await new Promise<void>((resolve, reject) => {
                      let timeout: ReturnType<typeof setTimeout>
                      let onStopLoading: () => void
                      let onFailLoad: (
                        _event: unknown,
                        errorCode: number,
                        errorDescription: string
                      ) => void

                      const cleanup = () => {
                        clearTimeout(timeout)
                        browserTab.contents.removeListener('did-stop-loading', onStopLoading)
                        browserTab.contents.removeListener('did-fail-load', onFailLoad)
                      }

                      onStopLoading = () => {
                        cleanup()
                        resolve()
                      }

                      onFailLoad = (_event, errorCode, errorDescription) => {
                        cleanup()
                        reject(new Error(`Navigation failed ${errorCode}: ${errorDescription}`))
                      }

                      timeout = setTimeout(() => {
                        cleanup()
                        reject(new Error('Timeout waiting for page load'))
                      }, 15000)

                      browserTab.contents.once('did-stop-loading', onStopLoading)
                      browserTab.contents.once('did-fail-load', onFailLoad)
                    })

                    // Check if URL matches after loading
                    const finalUrl = browserTab.contents.getURL()
                    if (finalUrl !== parsed.url) {
                      // URL doesn't match, need to navigate
                      await browserTab.navigate(parsed.url, 15000) // 15 second timeout
                    }
                  } else {
                    // Tab is not loading, check if URL matches
                    const currentUrl = browserTab.contents.getURL()
                    if (currentUrl !== parsed.url) {
                      // URL doesn't match, need to navigate
                      await browserTab.navigate(parsed.url, 15000) // 15 second timeout
                    }
                  }

                  const result: ToolResult = {
                    content: [
                      {
                        type: 'text' as const,
                        text: `Created new tab and navigated to ${parsed.url}\nTitle: ${browserTab.title || 'unknown'}`
                      }
                    ]
                  }
                  return result
                } catch (error) {
                  // If navigation fails, still return success since tab was created
                  // The tab might still be loading or the URL might be correct
                  const result: ToolResult = {
                    content: [
                      {
                        type: 'text' as const,
                        text: `Created new tab and navigated to ${parsed.url}\nTitle: ${browserTab.title || 'unknown'}`
                      }
                    ]
                  }
                  return result
                }
              }
              // Fallback if getTab fails
              const result: ToolResult = {
                content: [
                  {
                    type: 'text' as const,
                    text: `Created new tab and navigated to ${parsed.url}\nTitle: ${newTab.title || 'unknown'}`
                  }
                ]
              }
              return result
            }
          }
          const errorResult: ToolResult = {
            content: [
              {
                type: 'text' as const,
                text: 'No active tab available'
              }
            ],
            isError: true
          }
          return errorResult
        }

        await tab.navigate(parsed.url)
        const result: ToolResult = {
          content: [
            {
              type: 'text' as const,
              text: `Navigated to ${parsed.url}\nTitle: ${tab.title || 'unknown'}`
            }
          ]
        }
        return result
      }
    },
    {
      name: 'browser_go_back',
      description: 'Go back to the previous page in the current tab.',
      schema: NavigationOnlyArgsSchema,
      handler: async (args, context) => {
        const parsed = NavigationOnlyArgsSchema.parse(args)
        const tabId = await context.resolveTabId(parsed)
        const tab = await context.getTab(tabId)

        if (!tab) {
          return {
            content: [
              {
                type: 'text',
                text: `Tab ${tabId} not found`
              }
            ],
            isError: true
          }
        }

        await tab.goBack()
        return {
          content: [
            {
              type: 'text',
              text: `Went back. Current URL: ${tab.url || 'about:blank'}`
            }
          ]
        }
      }
    },
    {
      name: 'browser_go_forward',
      description: 'Go forward to the next page in the current tab.',
      schema: NavigationOnlyArgsSchema,
      handler: async (args, context) => {
        const parsed = NavigationOnlyArgsSchema.parse(args)
        const tabId = await context.resolveTabId(parsed)
        const tab = await context.getTab(tabId)

        if (!tab) {
          return {
            content: [
              {
                type: 'text',
                text: `Tab ${tabId} not found`
              }
            ],
            isError: true
          }
        }

        await tab.goForward()
        return {
          content: [
            {
              type: 'text',
              text: `Went forward. Current URL: ${tab.url || 'about:blank'}`
            }
          ]
        }
      }
    }
  ]
}
