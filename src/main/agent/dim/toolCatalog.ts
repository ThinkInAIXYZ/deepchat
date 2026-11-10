import type { JsonValue } from '@shared/contracts/json'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import type { DimModelCatalog } from './modelCatalog'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'

interface NativeDefinition {
  name: string
  description: string
  inputSchema: MCPToolDefinition['function']['parameters']
  risk?: string
}
interface CatalogOptions {
  host: DimRuntimeSupervisor
  models: Pick<DimModelCatalog, 'registerForHistory'>
  cwd: string
  defaultModel(): Promise<{ providerId: string; modelId: string } | null>
}

/** UI metadata comes from Rust's registry; no native handler is mirrored in the desktop. */
export class DimToolCatalog {
  private reading: Promise<MCPToolDefinition[]> | undefined
  constructor(private readonly options: CatalogOptions) {}

  async definitions(): Promise<MCPToolDefinition[]> {
    if (this.reading) return this.reading
    const task = this.read()
    this.reading = task
    try {
      return await task
    } finally {
      if (this.reading === task) this.reading = undefined
    }
  }

  private async read(): Promise<MCPToolDefinition[]> {
    const selected = await this.options.defaultModel()
    if (!selected) return []
    const model = await this.options.models.registerForHistory(
      selected.providerId,
      selected.modelId
    )
    const client = await this.options.host.start()
    // This isolated catalog scope accepts no input and does not migrate a desktop
    // conversation. A history-only registration grants no inference credentials.
    const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
      cwd: this.options.cwd,
      model: { ...model },
      policy: { preset: 'read-only', allowedTools: [], disallowedTools: [] }
    })
    try {
      const native = await client.call<NativeDefinition[]>('session.deepchat_tools.catalog', {
        sessionId,
        branchId: 'main'
      })
      return native.map((tool) => ({
        type: 'function',
        source: 'agent',
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
        server: { name: 'dim', icons: 'T', description: 'dim native tools' },
        execution:
          tool.risk === 'read_filesystem' ? TOOL_EXECUTION.read.parallel : TOOL_EXECUTION.write
      }))
    } finally {
      await client.call('deepchat.host.delete', { sessionId } satisfies Record<string, JsonValue>)
    }
  }
}
