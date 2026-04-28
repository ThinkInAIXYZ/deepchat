import { app, shell } from 'electron'
import fsSync from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { IConfigPresenter, IMCPPresenter, MCPServerConfig } from '@shared/presenter'
import {
  COMPUTER_USE_ENABLED_KEY,
  COMPUTER_USE_SERVER_NAME,
  COMPUTER_USE_SOURCE,
  COMPUTER_USE_SOURCE_ID,
  type ComputerUseArch,
  type ComputerUseMcpState,
  type ComputerUsePermissionName,
  type ComputerUsePermissionState,
  type ComputerUsePermissionStatus,
  type ComputerUsePermissionTarget,
  type ComputerUsePlatform,
  type ComputerUseStatus
} from '@shared/types/computerUse'

const execFileAsync = promisify(execFile)

const HELPER_APP_NAME = 'DeepChat Computer Use.app'
const HELPER_BINARY_NAME = 'cua-driver'
const PERMISSION_SETTINGS_URLS: Record<ComputerUsePermissionName, string> = {
  accessibility:
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility',
  screenRecording:
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture'
}

type ComputerUsePresenterDeps = {
  configPresenter: IConfigPresenter
  mcpPresenter: IMCPPresenter
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  appPath?: string
  isPackaged?: boolean
  runtimePath?: string
}

type HelperPaths = {
  helperAppPath: string
  helperBinaryPath: string
}

export class ComputerUsePresenter {
  private readonly configPresenter: IConfigPresenter
  private readonly mcpPresenter: IMCPPresenter
  private readonly platform: NodeJS.Platform
  private readonly arch: NodeJS.Architecture
  private readonly appPath: string
  private readonly isPackaged: boolean
  private readonly runtimePath?: string
  private lastError: string | undefined

  constructor(deps: ComputerUsePresenterDeps) {
    this.configPresenter = deps.configPresenter
    this.mcpPresenter = deps.mcpPresenter
    this.platform = deps.platform ?? process.platform
    this.arch = deps.arch ?? process.arch
    this.appPath = deps.appPath ?? app.getAppPath()
    this.isPackaged = deps.isPackaged ?? app.isPackaged
    this.runtimePath = deps.runtimePath
  }

  async initialize(): Promise<void> {
    if (!this.isMacOS()) {
      this.setEnabledSetting(false)
      await this.removeManagedServer()
      return
    }

    if (this.isEnabled()) {
      const helper = await this.resolveAvailableHelper()
      if (helper) {
        await this.ensureMcpServer(true, helper.helperBinaryPath)
      }
    } else {
      await this.removeManagedServer()
    }
  }

  async getStatus(): Promise<ComputerUseStatus> {
    const platform = this.getPlatform()
    const enabled = this.isEnabled()
    const baseStatus: ComputerUseStatus = {
      platform,
      available: false,
      enabled,
      arch: this.getArch(),
      permissions: this.unknownPermissions(),
      mcpServer: 'notRegistered',
      lastError: this.lastError
    }

    if (platform === 'unsupported') {
      return {
        ...baseStatus,
        enabled: false,
        lastError: undefined
      }
    }

    const helper = this.resolveHelperPaths()
    const helperExists = await this.pathExists(helper.helperBinaryPath)
    if (!helperExists) {
      return {
        ...baseStatus,
        helperPath: helper.helperAppPath,
        helperVersion: await this.readHelperVersion(helper.helperAppPath),
        mcpServer: await this.getMcpState(),
        lastError: 'missingHelper'
      }
    }

    const archStatus = await this.validateHelperArchitecture(helper.helperBinaryPath)
    const permissions = await this.checkPermissions()
    const mcpServer = await this.getMcpState()

    return {
      ...baseStatus,
      available: archStatus.ok,
      helperPath: helper.helperAppPath,
      helperVersion: await this.readHelperVersion(helper.helperAppPath),
      permissions,
      mcpServer: archStatus.ok ? mcpServer : 'error',
      lastError: archStatus.ok ? this.lastError : archStatus.error
    }
  }

  async setEnabled(enabled: boolean): Promise<ComputerUseStatus> {
    this.lastError = undefined

    if (!this.isMacOS()) {
      this.setEnabledSetting(false)
      await this.removeManagedServer()
      return await this.getStatus()
    }

    this.setEnabledSetting(enabled)

    if (!enabled) {
      await this.stopManagedServer()
      await this.removeManagedServer()
      return await this.getStatus()
    }

    const helper = this.resolveHelperPaths()
    if (!(await this.pathExists(helper.helperBinaryPath))) {
      this.lastError = 'missingHelper'
      return await this.getStatus()
    }

    const archStatus = await this.validateHelperArchitecture(helper.helperBinaryPath)
    if (!archStatus.ok) {
      this.lastError = archStatus.error
      return await this.getStatus()
    }

    await this.ensureMcpServer(true, helper.helperBinaryPath)

    if (await this.configPresenter.getMcpEnabled()) {
      try {
        await this.mcpPresenter.startServer(COMPUTER_USE_SERVER_NAME)
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
      }
    }

    return await this.getStatus()
  }

  async openPermissionGuide(target: ComputerUsePermissionTarget = 'all'): Promise<void> {
    if (!this.isMacOS()) {
      return
    }

    const helper = this.resolveHelperPaths()
    if (await this.pathExists(helper.helperAppPath)) {
      try {
        await this.runHelperPermissionProbe(helper, { prompt: true, background: false })
        this.lastError = undefined
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
      }
    }

    const permissionTarget = target === 'all' ? 'accessibility' : target
    await shell.openExternal(PERMISSION_SETTINGS_URLS[permissionTarget])
  }

  async checkPermissions(): Promise<ComputerUsePermissionStatus> {
    if (!this.isMacOS()) {
      return this.unknownPermissions()
    }

    const helper = this.resolveHelperPaths()
    if (!(await this.pathExists(helper.helperBinaryPath))) {
      return this.unknownPermissions()
    }

    try {
      const { stdout, stderr } = await this.runHelperPermissionProbe(helper, {
        prompt: false,
        background: true
      })
      this.lastError = undefined
      return this.parsePermissionOutput(`${stdout}\n${stderr}`)
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      return this.unknownPermissions()
    }
  }

  async restartMcpServer(): Promise<ComputerUseStatus> {
    const helper = await this.resolveAvailableHelper()
    if (!helper || !this.isEnabled()) {
      return await this.getStatus()
    }

    await this.ensureMcpServer(true, helper.helperBinaryPath)

    if (await this.configPresenter.getMcpEnabled()) {
      try {
        await this.stopManagedServer()
        await this.mcpPresenter.startServer(COMPUTER_USE_SERVER_NAME)
        this.lastError = undefined
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
      }
    }

    return await this.getStatus()
  }

  resolveHelperPaths(): HelperPaths {
    const runtimePath = this.resolveRuntimePath()
    const helperAppPath = path.join(
      runtimePath,
      'computer-use',
      'cua-driver',
      'current',
      HELPER_APP_NAME
    )
    return {
      helperAppPath,
      helperBinaryPath: path.join(helperAppPath, 'Contents', 'MacOS', HELPER_BINARY_NAME)
    }
  }

  buildMcpServerConfig(helperBinaryPath: string, enabled = true): MCPServerConfig {
    return {
      type: 'stdio',
      command: helperBinaryPath,
      args: ['mcp'],
      env: {
        DEEPCHAT_COMPUTER_USE: '1',
        CUA_DRIVER_AUTO_UPDATE_ENABLED: '0',
        CUA_DRIVER_AUTO_UPDATE: '0',
        CUA_DRIVER_TELEMETRY_ENABLED: '0',
        CUA_DRIVER_TELEMETRY: '0'
      },
      descriptions: 'DeepChat built-in macOS computer use service',
      icons: '🖥️',
      autoApprove: [],
      enabled,
      disable: false,
      source: COMPUTER_USE_SOURCE,
      sourceId: COMPUTER_USE_SOURCE_ID
    }
  }

  private async resolveAvailableHelper(): Promise<HelperPaths | null> {
    if (!this.isMacOS()) {
      return null
    }

    const helper = this.resolveHelperPaths()
    if (!(await this.pathExists(helper.helperBinaryPath))) {
      return null
    }

    const archStatus = await this.validateHelperArchitecture(helper.helperBinaryPath)
    return archStatus.ok ? helper : null
  }

  private async ensureMcpServer(enabled: boolean, helperBinaryPath: string): Promise<void> {
    const config = this.buildMcpServerConfig(helperBinaryPath, enabled)
    const servers = await this.configPresenter.getMcpServers()
    const existing = servers[COMPUTER_USE_SERVER_NAME]

    if (existing) {
      await this.mcpPresenter.updateMcpServer(COMPUTER_USE_SERVER_NAME, config)
      return
    }

    await this.configPresenter.addMcpServer(COMPUTER_USE_SERVER_NAME, config)
  }

  private async removeManagedServer(): Promise<void> {
    const servers = await this.configPresenter.getMcpServers()
    const existing = servers[COMPUTER_USE_SERVER_NAME]
    if (!existing) {
      return
    }
    await this.stopManagedServer()
    await this.configPresenter.removeMcpServer(COMPUTER_USE_SERVER_NAME)
  }

  private async stopManagedServer(): Promise<void> {
    try {
      if (await this.mcpPresenter.isServerRunning(COMPUTER_USE_SERVER_NAME)) {
        await this.mcpPresenter.stopServer(COMPUTER_USE_SERVER_NAME)
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  private async getMcpState(): Promise<ComputerUseMcpState> {
    const servers = await this.configPresenter.getMcpServers()
    if (!servers[COMPUTER_USE_SERVER_NAME]) {
      return 'notRegistered'
    }

    try {
      return (await this.mcpPresenter.isServerRunning(COMPUTER_USE_SERVER_NAME))
        ? 'running'
        : 'registered'
    } catch {
      return 'error'
    }
  }

  private isEnabled(): boolean {
    if (!this.isMacOS()) {
      return false
    }
    return this.configPresenter.getSetting<boolean>(COMPUTER_USE_ENABLED_KEY) ?? false
  }

  private setEnabledSetting(enabled: boolean): void {
    this.configPresenter.setSetting(COMPUTER_USE_ENABLED_KEY, enabled)
  }

  private isMacOS(): boolean {
    return this.platform === 'darwin'
  }

  private getPlatform(): ComputerUsePlatform {
    return this.isMacOS() ? 'darwin' : 'unsupported'
  }

  private getArch(): ComputerUseArch {
    if (this.arch === 'arm64') {
      return 'arm64'
    }
    if (this.arch === 'x64') {
      return 'x64'
    }
    return 'unknown'
  }

  private expectedBinaryArch(): 'arm64' | 'x86_64' | null {
    if (this.arch === 'arm64') {
      return 'arm64'
    }
    if (this.arch === 'x64') {
      return 'x86_64'
    }
    return null
  }

  private async validateHelperArchitecture(
    helperBinaryPath: string
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const expected = this.expectedBinaryArch()
    if (!expected) {
      return { ok: false, error: 'archMismatch' }
    }

    try {
      const { stdout } = await execFileAsync('/usr/bin/lipo', ['-archs', helperBinaryPath], {
        timeout: 5000
      })
      const archs = stdout.trim().split(/\s+/).filter(Boolean)
      if (archs.includes(expected)) {
        return { ok: true }
      }
      return { ok: false, error: 'archMismatch' }
    } catch {
      return { ok: true }
    }
  }

  private async readHelperVersion(helperAppPath: string): Promise<string | undefined> {
    try {
      const infoPlistPath = path.join(helperAppPath, 'Contents', 'Info.plist')
      const content = await fs.readFile(infoPlistPath, 'utf8')
      const match = content.match(
        /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/
      )
      return match?.[1]
    } catch {
      return undefined
    }
  }

  private parsePermissionOutput(output: string): ComputerUsePermissionStatus {
    return {
      accessibility: this.parsePermissionState(output, 'Accessibility'),
      screenRecording: this.parsePermissionState(output, 'Screen Recording')
    }
  }

  private parsePermissionState(output: string, label: string): ComputerUsePermissionState {
    const line = output
      .split(/\r?\n/)
      .find((candidate) => candidate.toLowerCase().includes(label.toLowerCase()))
    if (!line) {
      return 'unknown'
    }
    if (/not granted|missing|denied/i.test(line)) {
      return 'missing'
    }
    if (/granted/i.test(line)) {
      return 'granted'
    }
    return 'unknown'
  }

  private unknownPermissions(): ComputerUsePermissionStatus {
    return {
      accessibility: 'unknown',
      screenRecording: 'unknown'
    }
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath)
      return true
    } catch {
      return false
    }
  }

  private buildHelperEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      DEEPCHAT_COMPUTER_USE: '1',
      CUA_DRIVER_AUTO_UPDATE_ENABLED: '0',
      CUA_DRIVER_AUTO_UPDATE: '0',
      CUA_DRIVER_TELEMETRY_ENABLED: '0',
      CUA_DRIVER_TELEMETRY: '0'
    }
  }

  private async runHelperPermissionProbe(
    helper: HelperPaths,
    options: { prompt: boolean; background: boolean }
  ): Promise<{ stdout: string; stderr: string }> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepchat-computer-use-permissions-'))
    const outputPath = path.join(tempDir, 'permissions.json')

    try {
      await execFileAsync(
        '/usr/bin/open',
        [
          '-W',
          '-n',
          ...(options.background ? ['-g'] : []),
          helper.helperAppPath,
          '--args',
          'deepchat-permission-probe',
          ...(options.prompt ? ['--prompt'] : []),
          '--output',
          outputPath
        ],
        {
          timeout: 10000,
          env: this.buildHelperEnv()
        }
      )

      const raw = await fs.readFile(outputPath, 'utf8')
      const parsed = JSON.parse(raw) as {
        accessibility?: boolean
        screen_recording?: boolean
        screenRecording?: boolean
      }
      const screenRecording = parsed.screen_recording ?? parsed.screenRecording
      return {
        stdout: [
          `Accessibility: ${parsed.accessibility === true ? 'granted' : 'NOT granted'}.`,
          `Screen Recording: ${screenRecording === true ? 'granted' : 'NOT granted'}.`
        ].join('\n'),
        stderr: ''
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }

  private resolveRuntimePath(): string {
    if (this.runtimePath) {
      return this.runtimePath
    }

    if (!this.isPackaged) {
      return this.resolveDevelopmentRuntimePath()
    }

    return path.join(this.appPath, 'runtime').replace('app.asar', 'app.asar.unpacked')
  }

  private resolveDevelopmentRuntimePath(): string {
    const candidates = [path.join(process.cwd(), 'runtime')]
    let current = this.appPath

    for (let index = 0; index < 8; index += 1) {
      candidates.push(path.join(current, 'runtime'))
      const parent = path.dirname(current)
      if (parent === current) {
        break
      }
      current = parent
    }

    return (
      candidates.find((candidate) =>
        fsSync.existsSync(path.join(candidate, 'computer-use', 'cua-driver', 'current'))
      ) ?? candidates[0]
    )
  }
}
