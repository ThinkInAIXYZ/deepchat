import { spawn } from 'child_process'
import * as path from 'path'

// Memory cache for shell environment variables
let cachedShellEnv: Record<string, string> | null = null

const TIMEOUT_MS = 3000 // 3 seconds timeout

/**
 * Get user's default shell
 */
export function getUserShell(): { shell: string; args: string[] } {
  const platform = process.platform

  if (platform === 'win32') {
    // Windows: use PowerShell or cmd.exe
    const powershell = process.env.PSModulePath ? 'powershell.exe' : null
    if (powershell) {
      return { shell: powershell, args: ['-NoProfile', '-Command'] }
    }
    return { shell: 'cmd.exe', args: ['/c'] }
  } else {
    // Unix-like: use SHELL env var or default to bash
    const shell = process.env.SHELL || '/bin/bash'
    // For interactive shells, use -c to execute command
    // For bash/zsh, we need to source profile files to get nvm/etc
    if (shell.includes('bash')) {
      return { shell, args: ['-c'] }
    } else if (shell.includes('zsh')) {
      return { shell, args: ['-c'] }
    } else if (shell.includes('fish')) {
      return { shell, args: ['-c'] }
    } else {
      return { shell, args: ['-c'] }
    }
  }
}

/**
 * Execute shell command to get environment variables
 * This will source shell initialization files to get nvm/n/fnm/volta paths
 */
async function executeShellEnvCommand(): Promise<Record<string, string>> {
  const { shell, args } = getUserShell()
  const platform = process.platform

  // Build command to get environment variables
  // For bash/zsh, we need to source common profile files
  let envCommand: string

  if (platform === 'win32') {
    // Windows: PowerShell command to get all env vars
    envCommand = 'Get-ChildItem Env: | ForEach-Object { "$($_.Name)=$($_.Value)" }'
  } else {
    // Unix-like: source common profile files and then print env
    // This ensures nvm/n/fnm/volta initialization scripts are loaded
    const shellName = path.basename(shell)

    if (shellName === 'bash') {
      // Source .bashrc, .bash_profile, .profile in order
      envCommand = `
        [ -f ~/.bashrc ] && source ~/.bashrc
        [ -f ~/.bash_profile ] && source ~/.bash_profile
        [ -f ~/.profile ] && source ~/.profile
        env
      `.trim()
    } else if (shellName === 'zsh') {
      // Source .zshrc
      envCommand = `
        [ -f ~/.zshrc ] && source ~/.zshrc
        env
      `.trim()
    } else {
      // For other shells, just run env
      envCommand = 'env'
    }
  }

  return new Promise<Record<string, string>>((resolve, reject) => {
    const child = spawn(shell, [...args, envCommand], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    let stdout = ''
    let stderr = ''
    let timeoutId: NodeJS.Timeout | null = null

    // Set timeout
    timeoutId = setTimeout(() => {
      child.kill()
      reject(new Error(`Shell environment command timed out after ${TIMEOUT_MS}ms`))
    }, TIMEOUT_MS)

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId)
      reject(error)
    })

    child.on('exit', (code, signal) => {
      if (timeoutId) clearTimeout(timeoutId)

      if (code !== 0 && signal === null) {
        console.warn(
          `[ACP] Shell environment command exited with code ${code}, stderr: ${stderr.substring(0, 200)}`
        )
        // Don't reject, return empty object as fallback
        resolve({})
        return
      }

      if (signal) {
        console.warn(`[ACP] Shell environment command killed by signal: ${signal}`)
        resolve({})
        return
      }

      // Parse environment variables from output
      const env: Record<string, string> = {}

      if (platform === 'win32') {
        // PowerShell output format: KEY=VALUE
        const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
        for (const line of lines) {
          const match = line.match(/^([^=]+)=(.*)$/)
          if (match) {
            const [, key, value] = match
            env[key.trim()] = value.trim()
          }
        }
      } else {
        // Unix env output format: KEY=VALUE
        const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
        for (const line of lines) {
          const match = line.match(/^([^=]+)=(.*)$/)
          if (match) {
            const [, key, value] = match
            env[key.trim()] = value.trim()
          }
        }
      }

      resolve(env)
    })
  })
}

/**
 * Get shell environment variables with caching
 * This will source shell initialization files to get nvm/n/fnm/volta paths
 */
export async function getShellEnvironment(): Promise<Record<string, string>> {
  // Check cache first
  if (cachedShellEnv !== null) {
    console.log('[ACP] Using cached shell environment variables')
    return cachedShellEnv
  }

  console.log('[ACP] Fetching shell environment variables (this may take a moment)...')

  try {
    const shellEnv = await executeShellEnvCommand()

    // Filter and keep only relevant environment variables
    // Focus on PATH and Node.js related variables
    const filteredEnv: Record<string, string> = {}

    // Always include PATH (most important for nvm/n/fnm/volta)
    if (shellEnv.PATH) {
      filteredEnv.PATH = shellEnv.PATH
    }
    if (shellEnv.Path) {
      // Windows uses 'Path' instead of 'PATH'
      filteredEnv.Path = shellEnv.Path
    }

    // Include Node.js version manager related variables
    const nodeEnvVars = [
      'NVM_DIR',
      'NVM_CD_FLAGS',
      'NVM_BIN',
      'NODE_PATH',
      'NODE_VERSION',
      'FNM_DIR',
      'VOLTA_HOME',
      'N_PREFIX'
    ]

    for (const key of nodeEnvVars) {
      if (shellEnv[key]) {
        filteredEnv[key] = shellEnv[key]
      }
    }

    // Include npm-related variables
    const npmEnvVars = [
      'npm_config_registry',
      'npm_config_cache',
      'npm_config_prefix',
      'npm_config_tmp',
      'NPM_CONFIG_REGISTRY',
      'NPM_CONFIG_CACHE',
      'NPM_CONFIG_PREFIX',
      'NPM_CONFIG_TMP'
    ]

    for (const key of npmEnvVars) {
      if (shellEnv[key]) {
        filteredEnv[key] = shellEnv[key]
      }
    }

    // Cache the result
    cachedShellEnv = filteredEnv

    console.log('[ACP] Shell environment variables fetched and cached:', {
      pathLength: filteredEnv.PATH?.length || filteredEnv.Path?.length || 0,
      hasNvm: !!filteredEnv.NVM_DIR,
      hasFnm: !!filteredEnv.FNM_DIR,
      hasVolta: !!filteredEnv.VOLTA_HOME,
      hasN: !!filteredEnv.N_PREFIX,
      envVarCount: Object.keys(filteredEnv).length
    })

    return filteredEnv
  } catch (error) {
    console.warn('[ACP] Failed to get shell environment variables:', error)
    // Cache empty object to avoid repeated failures
    cachedShellEnv = {}
    return {}
  }
}

/**
 * Clear the shell environment cache
 * Should be called when ACP configuration changes (e.g., useBuiltinRuntime)
 */
export function clearShellEnvironmentCache(): void {
  cachedShellEnv = null
  console.log('[ACP] Shell environment cache cleared')
}
