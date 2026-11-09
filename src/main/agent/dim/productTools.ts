import { createHash } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'
import type { MCPToolDefinition } from '@shared/types/mcp'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import type { SessionDatabase } from '@/session/data/database'
import type {
  DimProductCapabilitySet,
  DimProductToolCall,
  DimProductToolDefinition,
  DimProductToolResult
} from './productGateway'

export interface DimDesktopTool {
  definition: MCPToolDefinition
  risk: DimProductToolDefinition['risk']
  execute(call: DimProductToolCall, signal: AbortSignal): Promise<DimProductToolResult>
}
interface ProductToolsOptions {
  database: SessionDatabase
  catalog(binding: Readonly<DimSessionBinding>): Promise<DimDesktopTool[]>
  authorize(binding: Readonly<DimSessionBinding>): void | Promise<void>
}

/** Only desktop capabilities enter this catalog. Native dispatch and consent stay in Rust. */
export class DimProductTools {
  constructor(private readonly options: ProductToolsOptions) {}

  readonly resolve = async (nativeId: string): Promise<DimProductCapabilitySet> => {
    const binding = this.options.database.dimSessionBindingsTable.getByNative(nativeId)
    if (!binding) throw new Error('Product tools have no current desktop binding')
    const scope = Object.freeze({ ...binding })
    const current = () => {
      const current = this.options.database.dimSessionBindingsTable.get(scope.sessionId)
      if (
        !current ||
        current.dimSessionId !== scope.dimSessionId ||
        current.branchId !== scope.branchId ||
        current.generation !== scope.generation ||
        this.options.database.dimScopeChangesTable.get(scope.sessionId)
      )
        throw new Error('Product tools belong to a replaced native scope')
    }
    const check = async () => {
      current()
      await this.options.authorize(scope)
      current()
    }
    await check()
    const entries = await this.options.catalog(scope)
    await check()
    const tools: DimProductToolDefinition[] = entries.map(({ definition, risk }) => ({
      name: definition.function.name,
      description: definition.function.description,
      inputSchema: definition.function.parameters as unknown as { [key: string]: JsonValue },
      source: 'extension',
      risk,
      metadata: { deepchatServer: definition.server.name }
    }))
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
      throw new Error('Desktop tool names must be unique')
    return {
      version: createHash('sha256')
        .update(
          JSON.stringify([
            scope.sessionId,
            scope.generation,
            entries.map((entry) => entry.definition),
            tools
          ])
        )
        .digest('hex'),
      tools,
      execute: async (call, signal) => {
        signal.throwIfAborted()
        await check()
        if (call.sessionId !== scope.dimSessionId || call.branchId !== scope.branchId)
          throw new Error('Product tool belongs to another native execution scope')
        const tool = entries.find((entry) => entry.definition.function.name === call.name)
        if (!tool) throw new Error('Desktop capability is no longer available')
        return tool.execute(call, signal)
      }
    }
  }
}
