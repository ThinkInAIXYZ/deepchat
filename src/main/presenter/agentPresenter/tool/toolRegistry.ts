export type ToolRegistrySource = 'mcp' | 'agent' | 'browser' | 'builtin'

export type ToolRegistryEntry = {
  name: string
  source: ToolRegistrySource
}

export class ToolRegistry {
  private readonly registry = new Map<string, ToolRegistryEntry>()

  register(entry: ToolRegistryEntry): void {
    this.registry.set(entry.name, entry)
  }

  get(name: string): ToolRegistryEntry | undefined {
    return this.registry.get(name)
  }

  list(): ToolRegistryEntry[] {
    return Array.from(this.registry.values())
  }
}
