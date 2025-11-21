import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'

const execAsync = promisify(exec)

/**
 * Helper class for opening user's default terminal and executing commands
 */
export class TerminalHelper {
  /**
   * Open user's default terminal and execute a command
   * @param command The command to execute
   * @param keepOpen Whether to keep the terminal open after command execution
   */
  static async openTerminalAndExecute(command: string, keepOpen: boolean = true): Promise<void> {
    const platform = process.platform

    if (platform === 'darwin') {
      await this.openMacOSTerminal(command, keepOpen)
    } else if (platform === 'win32') {
      await this.openWindowsTerminal(command, keepOpen)
    } else {
      await this.openLinuxTerminal(command, keepOpen)
    }
  }

  /**
   * Open terminal on macOS
   */
  private static async openMacOSTerminal(command: string, keepOpen: boolean): Promise<void> {
    try {
      // Try to detect default terminal
      const defaultTerminal = await this.getMacOSDefaultTerminal()
      const scriptContent = this.buildMacOSScript(command, keepOpen)
      const scriptPath = await this.createTempScript(scriptContent, '.sh')

      if (defaultTerminal === 'Terminal.app') {
        // Use Terminal.app
        await execAsync(
          `osascript -e 'tell application "Terminal" to do script "bash \\"${scriptPath}\\"'"`
        )
      } else if (defaultTerminal === 'iTerm.app') {
        // Use iTerm2
        await execAsync(
          `osascript -e 'tell application "iTerm" to tell current window to tell current session to write text "bash \\"${scriptPath}\\""'`
        )
      } else {
        // Fallback to Terminal.app
        await execAsync(
          `osascript -e 'tell application "Terminal" to do script "bash \\"${scriptPath}\\""'`
        )
      }
    } catch (error) {
      console.error('[TerminalHelper] Failed to open macOS terminal:', error)
      throw new Error('Failed to open terminal on macOS')
    }
  }

  /**
   * Get default terminal on macOS
   */
  private static async getMacOSDefaultTerminal(): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `defaults read com.apple.terminal "Default Window Settings" 2>/dev/null || echo ""`
      )
      if (stdout.trim()) {
        return 'Terminal.app'
      }
    } catch {
      // Ignore error
    }

    // Check if iTerm2 is installed
    try {
      await execAsync('test -d /Applications/iTerm.app')
      return 'iTerm.app'
    } catch {
      // iTerm2 not found
    }

    return 'Terminal.app'
  }

  /**
   * Build macOS shell script content
   */
  private static buildMacOSScript(command: string, keepOpen: boolean): string {
    let script = '#!/bin/bash\n'
    script += `cd "${process.cwd()}"\n`
    script += `${command}\n`
    if (keepOpen) {
      script += 'echo ""\n'
      script += 'echo "Press Enter to close this window..."\n'
      script += 'read\n'
    }
    return script
  }

  /**
   * Open terminal on Windows
   */
  private static async openWindowsTerminal(command: string, keepOpen: boolean): Promise<void> {
    try {
      const scriptContent = this.buildWindowsScript(command, keepOpen)
      const scriptPath = await this.createTempScript(scriptContent, '.bat')

      // Try Windows Terminal first (modern Windows)
      try {
        await execAsync(`wt.exe cmd /k "${scriptPath}"`)
        return
      } catch {
        // Windows Terminal not available, fallback to cmd
      }

      // Fallback to cmd.exe
      await execAsync(`start cmd /k "${scriptPath}"`)
    } catch (error) {
      console.error('[TerminalHelper] Failed to open Windows terminal:', error)
      throw new Error('Failed to open terminal on Windows')
    }
  }

  /**
   * Build Windows batch script content
   */
  private static buildWindowsScript(command: string, keepOpen: boolean): string {
    let script = `@echo off\n`
    script += `cd /d "${process.cwd()}"\n`
    script += `${command}\n`
    if (keepOpen) {
      script += `echo.\n`
      script += `echo Press any key to close this window...\n`
      script += `pause >nul\n`
    }
    return script
  }

  /**
   * Open terminal on Linux
   */
  private static async openLinuxTerminal(command: string, keepOpen: boolean): Promise<void> {
    try {
      const scriptContent = this.buildLinuxScript(command, keepOpen)
      const scriptPath = await this.createTempScript(scriptContent, '.sh')

      // Try common terminal emulators
      const terminals = [
        'x-terminal-emulator',
        'gnome-terminal',
        'konsole',
        'xterm',
        'terminator',
        'xfce4-terminal',
        'mate-terminal',
        'tilix'
      ]

      for (const terminal of terminals) {
        try {
          if (terminal === 'x-terminal-emulator') {
            await execAsync(`x-terminal-emulator -e bash "${scriptPath}"`)
          } else if (terminal === 'gnome-terminal') {
            await execAsync(`gnome-terminal -- bash -c "bash '${scriptPath}'; exec bash"`)
          } else if (terminal === 'konsole') {
            await execAsync(`konsole -e bash "${scriptPath}"`)
          } else {
            await execAsync(`${terminal} -e bash "${scriptPath}"`)
          }
          return
        } catch {
          // Try next terminal
          continue
        }
      }

      throw new Error('No terminal emulator found')
    } catch (error) {
      console.error('[TerminalHelper] Failed to open Linux terminal:', error)
      throw new Error('Failed to open terminal on Linux')
    }
  }

  /**
   * Build Linux shell script content
   */
  private static buildLinuxScript(command: string, keepOpen: boolean): string {
    let script = '#!/bin/bash\n'
    script += `cd "${process.cwd()}"\n`
    script += `${command}\n`
    if (keepOpen) {
      script += 'echo ""\n'
      script += 'echo "Press Enter to close this window..."\n'
      script += 'read\n'
    }
    return script
  }

  /**
   * Create temporary script file
   */
  private static async createTempScript(content: string, extension: string): Promise<string> {
    const tempDir = tmpdir()
    const scriptPath = path.join(tempDir, `deepchat-acp-init-${Date.now()}${extension}`)

    await fs.promises.writeFile(scriptPath, content, { mode: 0o755 })
    return scriptPath
  }
}
