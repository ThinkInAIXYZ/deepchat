import { eventBus, SendTarget } from '@/eventbus'
import { MCPServerConfig } from '@shared/presenter'
import { MCP_EVENTS } from '@/events'
import ElectronStore from 'electron-store'
import { app } from 'electron'
import { compare } from 'compare-versions'

// Interface for MCP settings
interface IMcpSettings {
  mcpServers: Record<string, MCPServerConfig>
  defaultServer?: string // Keep old field for version compatibility
  defaultServers: string[] // New: array of multiple default servers
  mcpEnabled: boolean // Add MCP enabled status field
  [key: string]: unknown // Allow any key
}
export type MCPServerType = 'stdio' | 'sse' | 'inmemory' | 'http'

// Check current system platform
function isMacOS(): boolean {
  return process.platform === 'darwin'
}

function isWindows(): boolean {
  return process.platform === 'win32'
}

function isLinux(): boolean {
  return process.platform === 'linux'
}

// Platform-specific MCP server configurations
const PLATFORM_SPECIFIC_SERVERS: Record<string, MCPServerConfig> = {
  // macOS specific services
  ...(isMacOS()
    ? {
        'deepchat/apple-server': {
          args: [],
          descriptions: 'DeepChat built-in Apple system integration service (macOS only)',
          icons: '🍎',
          autoApprove: ['all'],
          type: 'inmemory' as MCPServerType,
          command: 'deepchat/apple-server',
          env: {},
          disable: false
        }
      }
    : {}),

  // Windows specific services (reserved)
  ...(isWindows()
    ? {
        // 'deepchat-inmemory/windows-server': {
        //   args: [],
        //   descriptions: 'DeepChat built-in Windows system integration service (Windows only)',
        //   icons: '🪟',
        //   autoApprove: ['all'],
        //   type: 'inmemory' as MCPServerType,
        //   command: 'deepchat-inmemory/windows-server',
        //   env: {},
        //   disable: false
        // }
      }
    : {}),

  // Linux specific services (reserved)
  ...(isLinux()
    ? {
        // 'deepchat-inmemory/linux-server': {
        //   args: [],
        //   descriptions: 'DeepChat built-in Linux system integration service (Linux only)',
        //   icons: '🐧',
        //   autoApprove: ['all'],
        //   type: 'inmemory' as MCPServerType,
        //   command: 'deepchat-inmemory/linux-server',
        //   env: {},
        //   disable: false
        // }
      }
    : {})
}

// Extract in-memory services as a constant
const DEFAULT_INMEMORY_SERVERS: Record<string, MCPServerConfig> = {
  buildInFileSystem: {
    args: [app.getPath('home')],
    descriptions: 'DeepChat built-in file system mcp service',
    icons: '📁',
    autoApprove: ['read'],
    type: 'inmemory' as MCPServerType,
    command: 'filesystem',
    env: {},
    disable: true
  },
  Artifacts: {
    args: [],
    descriptions: 'DeepChat built-in artifacts mcp service',
    icons: '🎨',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'artifacts',
    env: {},
    disable: false
  },
  bochaSearch: {
    args: [],
    descriptions: 'DeepChat built-in Bocha search service',
    icons: '🔍',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'bochaSearch',
    env: {
      apiKey: 'YOUR_BOCHA_API_KEY' // User needs to provide the actual API Key
    },
    disable: false
  },
  braveSearch: {
    args: [],
    descriptions: 'DeepChat built-in Brave search service',
    icons: '🦁',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'braveSearch',
    env: {
      apiKey: 'YOUR_BRAVE_API_KEY' // User needs to provide the actual API Key
    },
    disable: false
  },
  difyKnowledge: {
    args: [],
    descriptions: 'DeepChat built-in Dify knowledge base retrieval service',
    icons: '📚',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'difyKnowledge',
    env: {
      configs: [
        {
          description: 'this is a description for the current knowledge base',
          apiKey: 'YOUR_DIFY_API_KEY',
          datasetId: 'YOUR_DATASET_ID',
          endpoint: 'http://localhost:3000/v1'
        }
      ]
    },
    disable: false
  },
  imageServer: {
    args: [],
    descriptions: 'Image processing MCP service',
    icons: '🖼️',
    autoApprove: ['read_image_base64', 'read_multiple_images_base64'], // Auto-approve reading, require confirmation for uploads
    type: 'inmemory' as MCPServerType,
    command: 'image', // We need to map this command to the ImageServer class later
    env: {},
    disable: false
  },
  powerpack: {
    args: [],
    descriptions: 'DeepChat built-in powerpack toolkit',
    icons: '🛠️',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'powerpack',
    env: {},
    disable: false
  },
  ragflowKnowledge: {
    args: [],
    descriptions: 'DeepChat built-in RAGFlow knowledge base retrieval service',
    icons: '📚',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'ragflowKnowledge',
    env: {
      configs: [
        {
          description: 'Default RAGFlow knowledge base',
          apiKey: 'YOUR_RAGFLOW_API_KEY',
          datasetIds: ['YOUR_DATASET_ID'],
          endpoint: 'http://localhost:8000'
        }
      ]
    },
    disable: false
  },
  fastGptKnowledge: {
    args: [],
    descriptions: 'DeepChat built-in FastGPT knowledge base retrieval service',
    icons: '📚',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'fastGptKnowledge',
    env: {
      configs: [
        {
          description: 'this is a description for the current knowledge base',
          apiKey: 'YOUR_FastGPT_API_KEY',
          datasetId: 'YOUR_DATASET_ID',
          endpoint: 'http://localhost:3000/api'
        }
      ]
    },
    disable: false
  },
  'deepchat-inmemory/deep-research-server': {
    args: [],
    descriptions:
      'DeepChat built-in deep research service, using Bocha search (note that this service requires a long context model, do not use it with short context models)',
    icons: '🔬',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'deepchat-inmemory/deep-research-server',
    env: {
      BOCHA_API_KEY: 'YOUR_BOCHA_API_KEY'
    },
    disable: false
  },
  'deepchat-inmemory/auto-prompting-server': {
    args: [],
    descriptions: 'DeepChat built-in auto template prompt service',
    icons: '📜',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'deepchat-inmemory/auto-prompting-server',
    env: {},
    disable: false
  },
  'deepchat-inmemory/conversation-search-server': {
    args: [],
    descriptions: 'DeepChat built-in conversation history search service',
    icons: '🔍',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'deepchat-inmemory/conversation-search-server',
    env: {},
    disable: false
  },
  'deepchat-inmemory/meeting-server': {
    args: [],
    descriptions: 'DeepChat built-in meeting service for organizing multi-agent discussions',
    icons: '👥',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    command: 'deepchat-inmemory/meeting-server',
    env: {},
    disable: false
  },
  // Merge platform-specific services
  ...PLATFORM_SPECIFIC_SERVERS
}

const DEFAULT_MCP_SERVERS = {
  mcpServers: {
    // First define built-in MCP servers
    ...DEFAULT_INMEMORY_SERVERS,
    // Then the default third-party MCP servers
    memory: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: {},
      descriptions: 'Memory storage service',
      icons: '🧠',
      autoApprove: ['all'],
      disable: true,
      type: 'stdio' as MCPServerType
    }
  },
  defaultServers: [
    'Artifacts',
    // Add default enabled platform-specific services based on the platform
    ...(isMacOS() ? ['deepchat/apple-server'] : [])
  ],
  mcpEnabled: false // Disable MCP feature by default
}
// This part of mcp has system logic to determine whether to enable it, not controlled by user configuration, but by the software environment
export const SYSTEM_INMEM_MCP_SERVERS: Record<string, MCPServerConfig> = {
  'deepchat-inmemory/custom-prompts-server': {
    command: 'deepchat-inmemory/custom-prompts-server',
    args: [],
    env: {},
    descriptions: 'DeepChat built-in custom prompt service',
    icons: '📝',
    autoApprove: ['all'],
    type: 'inmemory' as MCPServerType,
    disable: false
  }
}

export class McpConfHelper {
  private mcpStore: ElectronStore<IMcpSettings>

  constructor() {
    // Initialize MCP settings storage
    this.mcpStore = new ElectronStore<IMcpSettings>({
      name: 'mcp-settings',
      defaults: {
        mcpServers: DEFAULT_MCP_SERVERS.mcpServers,
        defaultServers: DEFAULT_MCP_SERVERS.defaultServers,
        mcpEnabled: DEFAULT_MCP_SERVERS.mcpEnabled
      }
    })
  }

  // Get MCP server configurations
  getMcpServers(): Promise<Record<string, MCPServerConfig>> {
    const storedServers = this.mcpStore.get('mcpServers') || DEFAULT_MCP_SERVERS.mcpServers

    // Check and add missing in-memory services
    const serversWithDefaults = { ...storedServers }
    let added = false
    for (const [serverName, serverConfig] of Object.entries(DEFAULT_INMEMORY_SERVERS)) {
      if (!serversWithDefaults[serverName]) {
        console.log(`Adding missing in-memory service: ${serverName}`)
        serversWithDefaults[serverName] = serverConfig
        added = true
      }
    }

    // Remove services not supported on the current platform
    const finalServers = Object.fromEntries(
      Object.entries(serversWithDefaults).filter(([serverName, serverConfig]) => {
        if (serverConfig.type === 'inmemory') {
          if (serverName === 'deepchat/apple-server' && !isMacOS()) {
            console.log(`Removing service not supported on the current platform: ${serverName}`)
            return false
          }
          // Add checks for other platform-specific services here
          // if (serverName === 'deepchat-inmemory/windows-server' && !isWindows()) {
          //   console.log(`Removing service not supported on the current platform: ${serverName}`)
          //   return false
          // }
          // if (serverName === 'deepchat-inmemory/linux-server' && !isLinux()) {
          //   console.log(`Removing service not supported on the current platform: ${serverName}`)
          //   return false
          // }
        }
        return true
      })
    )

    // If there are changes, update the storage
    if (added || Object.keys(finalServers).length !== Object.keys(serversWithDefaults).length) {
      this.mcpStore.set('mcpServers', finalServers)
    }

    return Promise.resolve(finalServers)
  }

  // Set MCP server configurations
  async setMcpServers(servers: Record<string, MCPServerConfig>): Promise<void> {
    this.mcpStore.set('mcpServers', servers)
    eventBus.send(MCP_EVENTS.CONFIG_CHANGED, SendTarget.ALL_WINDOWS, {
      mcpServers: servers,
      defaultServers: this.mcpStore.get('defaultServers') || [],
      mcpEnabled: this.mcpStore.get('mcpEnabled')
    })
  }

  // Get the list of default servers
  getMcpDefaultServers(): Promise<string[]> {
    return Promise.resolve(this.mcpStore.get('defaultServers') || [])
  }

  // Add a default server
  async addMcpDefaultServer(serverName: string): Promise<void> {
    const defaultServers = this.mcpStore.get('defaultServers') || []
    const mcpServers = await this.getMcpServers() // Use getMcpServers to ensure platform check

    // Detect and clean up invalid servers
    const validDefaultServers = defaultServers.filter((server) => {
      const exists = mcpServers[server] !== undefined
      if (!exists) {
        console.log(`Detected invalid MCP server: ${server}, removed from default list`)
      }
      return exists
    })

    // Check if the server to be added exists and is supported on the current platform
    if (mcpServers[serverName]) {
      // Add the new server (if not already in the list)
      if (!validDefaultServers.includes(serverName)) {
        validDefaultServers.push(serverName)
      }
    } else {
      console.log(`Attempted to add a non-existent or unsupported MCP server: ${serverName}`)
      return
    }

    // If there are changes, update storage and send event
    if (
      validDefaultServers.length !== defaultServers.length ||
      !defaultServers.includes(serverName)
    ) {
      this.mcpStore.set('defaultServers', validDefaultServers)
      eventBus.send(MCP_EVENTS.CONFIG_CHANGED, SendTarget.ALL_WINDOWS, {
        mcpServers: mcpServers,
        defaultServers: validDefaultServers,
        mcpEnabled: this.mcpStore.get('mcpEnabled')
      })
    }
  }

  // Remove a default server
  async removeMcpDefaultServer(serverName: string): Promise<void> {
    const defaultServers = this.mcpStore.get('defaultServers') || []
    const updatedServers = defaultServers.filter((name) => name !== serverName)
    this.mcpStore.set('defaultServers', updatedServers)
    eventBus.send(MCP_EVENTS.CONFIG_CHANGED, SendTarget.ALL_WINDOWS, {
      mcpServers: this.mcpStore.get('mcpServers'),
      defaultServers: updatedServers,
      mcpEnabled: this.mcpStore.get('mcpEnabled')
    })
  }

  // Toggle the default status of a server
  async toggleMcpDefaultServer(serverName: string): Promise<void> {
    const defaultServers = this.mcpStore.get('defaultServers') || []
    if (defaultServers.includes(serverName)) {
      await this.removeMcpDefaultServer(serverName)
    } else {
      await this.addMcpDefaultServer(serverName)
    }
  }

  // Set MCP enabled status
  async setMcpEnabled(enabled: boolean): Promise<void> {
    this.mcpStore.set('mcpEnabled', enabled)
    eventBus.send(MCP_EVENTS.CONFIG_CHANGED, SendTarget.ALL_WINDOWS, {
      mcpServers: this.mcpStore.get('mcpServers'),
      defaultServers: this.mcpStore.get('defaultServers'),
      mcpEnabled: enabled
    })
  }

  // Get MCP enabled status
  getMcpEnabled(): Promise<boolean> {
    return Promise.resolve(this.mcpStore.get('mcpEnabled') ?? DEFAULT_MCP_SERVERS.mcpEnabled)
  }

  // Add an MCP server
  async addMcpServer(name: string, config: MCPServerConfig): Promise<boolean> {
    const mcpServers = await this.getMcpServers()
    mcpServers[name] = config
    await this.setMcpServers(mcpServers)
    return true
  }

  // Remove an MCP server
  async removeMcpServer(name: string): Promise<void> {
    const mcpServers = await this.getMcpServers()
    const { [name]: removedServer, ...newMcpServers } = mcpServers
    await this.setMcpServers(newMcpServers)

    // If the removed server is in the default server list, remove it from the list
    const defaultServers = await this.getMcpDefaultServers()
    if (defaultServers.includes(name)) {
      await this.removeMcpDefaultServer(name)
    }
  }

  // Update an MCP server configuration
  async updateMcpServer(name: string, config: Partial<MCPServerConfig>): Promise<void> {
    const mcpServers = await this.getMcpServers()
    if (!mcpServers[name]) {
      throw new Error(`MCP server ${name} not found`)
    }
    mcpServers[name] = {
      ...mcpServers[name],
      ...config
    }
    await this.setMcpServers(mcpServers)
  }

  // Restore default server configurations
  async resetToDefaultServers(): Promise<void> {
    const currentServers = await this.getMcpServers()

    // Remove all in-memory services
    const nonInMemoryServers = Object.fromEntries(
      Object.entries(currentServers).filter(([, serverConfig]) => serverConfig.type !== 'inmemory')
    )

    // Add or overwrite with default servers
    const updatedServers = { ...nonInMemoryServers, ...DEFAULT_MCP_SERVERS.mcpServers }

    // Update server configurations
    await this.setMcpServers(updatedServers)

    // Restore default server settings, ensuring correct handling of platform-specific services
    const platformAwareDefaultServers = [
      'Artifacts',
      // Add default enabled platform-specific services based on the platform
      ...(isMacOS() ? ['deepchat/apple-server'] : [])
    ]

    this.mcpStore.set('defaultServers', platformAwareDefaultServers)
    eventBus.send(MCP_EVENTS.CONFIG_CHANGED, SendTarget.ALL_WINDOWS, {
      mcpServers: updatedServers,
      defaultServers: platformAwareDefaultServers,
      mcpEnabled: this.mcpStore.get('mcpEnabled')
    })
  }

  public onUpgrade(oldVersion: string | undefined): void {
    console.log('onUpgrade', oldVersion)
    if (oldVersion && compare(oldVersion, '0.0.12', '<=')) {
      // Migrate old defaultServer to new defaultServers
      const oldDefaultServer = this.mcpStore.get('defaultServer') as string | undefined
      if (oldDefaultServer) {
        console.log(`Migrating old defaultServer: ${oldDefaultServer} to defaultServers`)
        const defaultServers = this.mcpStore.get('defaultServers') || []
        if (!defaultServers.includes(oldDefaultServer)) {
          defaultServers.push(oldDefaultServer)
          this.mcpStore.set('defaultServers', defaultServers)
        }
        // Delete the old defaultServer field to prevent re-migration
        this.mcpStore.delete('defaultServer')
      }

      // Migrate filesystem server to buildInFileSystem
      try {
        const mcpServers = this.mcpStore.get('mcpServers') || {}
        // console.log('mcpServers', mcpServers)
        if (mcpServers.filesystem) {
          console.log(
            'Detected old filesystem MCP server, migrating to buildInFileSystem'
          )

          // Check if buildInFileSystem already exists
          if (!mcpServers.buildInFileSystem) {
            // Create buildInFileSystem configuration
            mcpServers.buildInFileSystem = {
              args: [app.getPath('home')], // default value
              descriptions: 'Built-in file system mcp service',
              icons: '💾',
              autoApprove: ['read'],
              type: 'inmemory' as MCPServerType,
              command: 'filesystem',
              env: {},
              disable: false
            }
          }

          // If filesystem args length is greater than 2, migrate the third and subsequent parameters
          if (mcpServers.filesystem.args && mcpServers.filesystem.args.length > 2) {
            mcpServers.buildInFileSystem.args = mcpServers.filesystem.args.slice(2)
          }

          // Migrate autoApprove settings
          if (mcpServers.filesystem.autoApprove) {
            mcpServers.buildInFileSystem.autoApprove = [...mcpServers.filesystem.autoApprove]
          }

          delete mcpServers.filesystem
          // Update mcpServers
          this.mcpStore.set('mcpServers', mcpServers)

          // If filesystem is a default server, add buildInFileSystem to the default server list
          const defaultServers = this.mcpStore.get('defaultServers') || []
          if (
            defaultServers.includes('filesystem') &&
            !defaultServers.includes('buildInFileSystem')
          ) {
            defaultServers.push('buildInFileSystem')
            this.mcpStore.set('defaultServers', defaultServers)
          }

          console.log('Migration from filesystem to buildInFileSystem complete')
        }
      } catch (error) {
        console.error('Error migrating filesystem server:', error)
      }
    }

    // Check and add platform-specific services after upgrade
    try {
      const mcpServers = this.mcpStore.get('mcpServers') || {}
      const defaultServers = this.mcpStore.get('defaultServers') || []
      let hasChanges = false

      // Check if platform-specific services need to be added
      if (isMacOS() && !mcpServers['deepchat/apple-server']) {
        console.log('Detected macOS platform, adding Apple system integration service')
        mcpServers['deepchat/apple-server'] = PLATFORM_SPECIFIC_SERVERS['deepchat/apple-server']
        hasChanges = true

        // If not in the default server list, add it
        if (!defaultServers.includes('deepchat/apple-server')) {
          defaultServers.push('deepchat/apple-server')
          this.mcpStore.set('defaultServers', defaultServers)
        }
      }

      // Remove services not supported on the current platform
      const serversToRemove: string[] = []
      for (const [serverName] of Object.entries(mcpServers)) {
        if (serverName === 'deepchat/apple-server' && !isMacOS()) {
          serversToRemove.push(serverName)
        }
        // Add checks for other platform-specific services here
      }

      for (const serverName of serversToRemove) {
        console.log(`Removing service not supported on the current platform: ${serverName}`)
        delete mcpServers[serverName]
        hasChanges = true

        // Remove from the default server list
        const index = defaultServers.indexOf(serverName)
        if (index > -1) {
          defaultServers.splice(index, 1)
          this.mcpStore.set('defaultServers', defaultServers)
        }
      }

      if (hasChanges) {
        this.mcpStore.set('mcpServers', mcpServers)
        console.log('Platform-specific services upgrade complete')
      }
    } catch (error) {
      console.error('Error upgrading platform-specific services:', error)
    }
  }
}

