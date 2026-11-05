/**
 * Node sidecar entry.
 *
 * The Go shell starts this process and speaks one JSON request per line on
 * stdin, one JSON response per line on stdout, plus unsolicited `{event}`
 * lines. See `docs/features/mygo-rewrite/m0-report.md` and
 * `boot-route-inventory.md`.
 *
 * Routes come from the same factories the Electron main process uses, composed
 * into one registry. Anything that still needs Electron (windows, tray, IPC, the
 * SQLCipher database) stays out until its service moves here.
 */
import os from 'node:os'
import { createInterface } from 'node:readline'
import {
  configGetEntriesRoute,
  configGetLanguageRoute,
  configGetThemeRoute,
  configListCustomPromptsRoute,
  configSetLanguageRoute,
  configSetThemeRoute,
  configUpdateEntriesRoute,
  deviceGetInfoRoute,
  upgradeGetStatusRoute,
  windowGetCurrentStateRoute,
  windowGetRuntimeIdentityRoute,
  type ConfigEntryKey
} from '@shared/contracts/routes'
import { getLocaleDirection, resolveSupportedLocale } from '@shared/locales'
import { appHost } from '@/platform/appHost'
import { createSettingsStore, type SettingsStore } from '@/config/settingsStore'
import { MainDatabase } from '@/data/mainDatabase'
import { SessionDatabase } from '@/session/data/database'
import { AppSessionService } from '@/agent/shared/appSessionService'
import { ProjectDatabase } from '@/project/data/database'
import { createOnboardingRoutes } from '@/onboarding/routes'
import { ProviderSettings } from '@/provider/settings'
import { McpSettings } from '@/mcp/settings'
import { McpDatabase } from '@/mcp/data/database'
import { SecretStore } from '@/config/secretStore'
import { mcpGetEnabledRoute, mcpGetServersRoute } from '@shared/contracts/routes'
import { ProviderDatabase } from '@/provider/data/database'
import { toProviderSummary } from '@/provider/summary'
import { providersListSummariesRoute } from '@shared/contracts/routes'
import { toSessionListItem } from '@/session/listItem'
import { sessionsGetAgentsRoute, sessionsListLightweightRoute } from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap, type RouteContext } from '@/routes/routeRegistry'

const settings: SettingsStore = createSettingsStore()

// The shell is the only caller, so requests are internal rather than renderer calls.
const context: RouteContext = { caller: { kind: 'internal', component: 'agent-cli' } }

const write = (payload: unknown): void => {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

/** Writes an unsolicited event line, which the shell broadcasts to every page. */
export const emit = (event: string, payload: unknown): void => {
  write({ event, payload })
}

const readEntries = (keys: readonly ConfigEntryKey[]): Record<string, unknown> => {
  const values: Record<string, unknown> = {}
  for (const key of keys) {
    values[key] = settings.get(key)
  }
  return values
}

const readLanguage = () => {
  const requested = settings.get<string>('language') ?? 'system'
  const locale = resolveSupportedLocale(requested === 'system' ? appHost.getLocale() : requested)
  return {
    requestedLanguage: requested,
    locale,
    direction: getLocaleDirection(locale)
  }
}

const readTheme = () => {
  const theme = settings.get<'dark' | 'light' | 'system'>('appTheme') ?? 'system'
  return { theme, isDark: theme === 'dark' }
}

const readDeviceInfo = () => {
  const platform = process.platform
  const osVersionMetadata =
    platform === 'win32'
      ? [
          { name: 'Windows 11', build: 22000 },
          { name: 'Windows 10', build: 10240 },
          { name: 'Windows 8.1', build: 9600 },
          { name: 'Windows 8', build: 9200 }
        ]
      : platform === 'darwin'
        ? [
            { name: 'macOS Tahoe', build: 25 },
            { name: 'macOS Sequoia', build: 24 },
            { name: 'macOS Sonoma', build: 23 },
            { name: 'macOS Ventura', build: 22 },
            { name: 'macOS Monterey', build: 21 },
            { name: 'macOS Big Sur', build: 20 }
          ]
        : []

  return {
    // Assistive-technology detection is an Electron/AppKit capability; the shell
    // owns it. Until the shell reports one, assume it is off.
    accessibilitySupportEnabled: false,
    platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    totalMemory: os.totalmem(),
    osVersion: os.release(),
    osVersionMetadata
  }
}

// Opening the encrypted database is opt-in so the sidecar still starts for
// settings-only work without a database. The shell passes the path and the
// password it read from `mygo.Secrets`; the sidecar never stores the password.
const dbPath = process.env.DEEPCHAT_DB_PATH
const database = dbPath
  ? (() => {
      try {
        const opened = new MainDatabase(dbPath, process.env.DEEPCHAT_DB_KEY || undefined)
        emit('sidecar.db.ready', { path: dbPath })
        return opened
      } catch (error) {
        emit('sidecar.db.error', {
          message: error instanceof Error ? error.message : String(error)
        })
        return null
      }
    })()
  : null

// Providers read from the same encrypted database through the same settings class
// the Electron main process uses. The privacy port is the only collaborator that
// needs a value, and it comes from the settings store in both runtimes.
const providerSettings = database
  ? new ProviderSettings(
      settings,
      {
        isEnabled: () => settings.get<boolean>('privacyModeEnabled') === true,
        setEnabled: () => {}
      },
      new ProviderDatabase(database),
      () => {},
      settings.get<string>('appVersion') ?? undefined
    )
  : null

// MCP settings are store-backed with a database mirror, exactly as in the main
// process. The server manager and tool dispatch stay behind: they need the plugin
// runtime and agent loop, which have not moved yet.
const mcpSettings = (() => {
  const instance = new McpSettings(new SecretStore(settings))
  if (database) {
    instance.connectDatabase(new McpDatabase(database))
  }
  return instance
})()

const requireSessions = (): AppSessionService => {
  if (!database) {
    throw new Error('Database is not available in this sidecar session')
  }
  return new AppSessionService(new ProjectDatabase(database), new SessionDatabase(database))
}

const sidecarRoutes: DeepchatRouteMap = createRouteMap([
  [
    configGetEntriesRoute.name,
    async (rawInput) => {
      const input = configGetEntriesRoute.input.parse(rawInput)
      return configGetEntriesRoute.output.parse({
        version: Date.now(),
        values: readEntries(input.keys ?? [])
      })
    }
  ],
  [
    configUpdateEntriesRoute.name,
    async (rawInput) => {
      const input = configUpdateEntriesRoute.input.parse(rawInput)
      for (const change of input.changes) {
        settings.set(change.key, change.value)
      }
      return configUpdateEntriesRoute.output.parse({
        version: Date.now(),
        changedKeys: input.changes.map((change) => change.key),
        values: readEntries(input.changes.map((change) => change.key))
      })
    }
  ],
  [configGetLanguageRoute.name, async () => configGetLanguageRoute.output.parse(readLanguage())],
  [
    configSetLanguageRoute.name,
    async (rawInput) => {
      const input = configSetLanguageRoute.input.parse(rawInput)
      settings.set('language', input.language)
      return configSetLanguageRoute.output.parse(readLanguage())
    }
  ],
  [configGetThemeRoute.name, async () => configGetThemeRoute.output.parse(readTheme())],
  [
    configSetThemeRoute.name,
    async (rawInput) => {
      const input = configSetThemeRoute.input.parse(rawInput)
      settings.set('appTheme', input.theme)
      return configSetThemeRoute.output.parse(readTheme())
    }
  ],
  [
    configListCustomPromptsRoute.name,
    async () =>
      configListCustomPromptsRoute.output.parse({
        prompts: settings.get<unknown[]>('customPrompts') ?? []
      })
  ],
  [
    deviceGetInfoRoute.name,
    async () => deviceGetInfoRoute.output.parse({ info: readDeviceInfo() })
  ],
  [
    // Update state lives in the shell: it owns packaging and downloading. The
    // sidecar reports "nothing pending" until the shell pushes real state.
    upgradeGetStatusRoute.name,
    async () =>
      upgradeGetStatusRoute.output.parse({
        snapshot: { status: null, progress: null, error: null, updateInfo: null }
      })
  ],
  [
    mcpGetEnabledRoute.name,
    async () => mcpGetEnabledRoute.output.parse({ enabled: await mcpSettings.getMcpEnabled() })
  ],
  [
    mcpGetServersRoute.name,
    async () => mcpGetServersRoute.output.parse({ servers: await mcpSettings.getMcpServers() })
  ],
  [
    providersListSummariesRoute.name,
    async () => {
      if (!providerSettings) {
        throw new Error('Database is not available in this sidecar session')
      }
      return providersListSummariesRoute.output.parse({
        providers: providerSettings.getProviders().map(toProviderSummary)
      })
    }
  ],
  [
    sessionsListLightweightRoute.name,
    async (rawInput) => {
      const input = sessionsListLightweightRoute.input.parse(rawInput)
      const page = requireSessions().listPage({
        limit: input.limit ?? undefined,
        cursor: input.cursor ?? undefined,
        includeSubagents: input.includeSubagents ?? false
      })
      return sessionsListLightweightRoute.output.parse({
        items: page.records.map((record) => toSessionListItem(record, 'idle')),
        nextCursor: page.nextCursor ?? null,
        hasMore: page.hasMore
      })
    }
  ],
  [sessionsGetAgentsRoute.name, async () => sessionsGetAgentsRoute.output.parse({ agents: [] })],
  [
    windowGetRuntimeIdentityRoute.name,
    async () =>
      windowGetRuntimeIdentityRoute.output.parse({
        windowId: Number(process.env.DEEPCHAT_WINDOW_ID ?? 1),
        webContentsId: Number(process.env.DEEPCHAT_WINDOW_ID ?? 1)
      })
  ],
  [
    windowGetCurrentStateRoute.name,
    async () =>
      windowGetCurrentStateRoute.output.parse({
        state: {
          windowId: Number(process.env.DEEPCHAT_WINDOW_ID ?? 1),
          exists: true,
          isMaximized: false,
          isFullScreen: false,
          isFocused: true
        }
      })
  ]
])

const registry = new Map(sidecarRoutes)
for (const [name, handler] of createOnboardingRoutes(settings)) {
  if (registry.has(name)) {
    throw new Error(`Duplicate sidecar route: ${name}`)
  }
  registry.set(name, handler)
}

const handleLine = async (line: string): Promise<void> => {
  const trimmed = line.trim()
  if (!trimmed) return

  let request: { id?: number; route?: string; input?: unknown }
  try {
    request = JSON.parse(trimmed)
  } catch (error) {
    write({ error: `bad request: ${String(error)}` })
    return
  }

  const route = request.route
  if (!route) return

  const handler = registry.get(route as never)
  if (!handler) {
    write({ id: request.id, result: {} })
    return
  }

  try {
    write({ id: request.id, result: await handler(request.input, context) })
  } catch (error) {
    write({ id: request.id, error: error instanceof Error ? error.message : String(error) })
  }
}

const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  void handleLine(line)
})
input.on('close', () => process.exit(0))

emit('sidecar.ready', { routes: registry.size })
