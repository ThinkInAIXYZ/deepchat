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
  }

  // Unix-like: use SHELL env var or default to bash
  const shell = process.env.SHELL || '/bin/bash'
  if (shell.includes('bash')) {
    return { shell, args: ['-c'] }
  }
  if (shell.includes('zsh')) {
    return { shell, args: ['-c'] }
  }
  if (shell.includes('fish')) {
    return { shell, args: ['-c'] }
  }
  return { shell, args: ['-c'] }
}

/**
 * Execute shell command to get environment variables
 * This will source shell initialization files to get nvm/n/fnm/volta paths
 */
async function executeShellEnvCommand(): Promise<Record<string, string>> {
  const { shell, args } = getUserShell()
  const platform = process.platform

  let envCommand: string

  if (platform === 'win32') {
    envCommand = 'Get-ChildItem Env: | ForEach-Object { "$($_.Name)=$($_.Value)" }'
  } else {
    const shellName = path.basename(shell)

    if (shellName === 'bash') {
      envCommand = `
        [ -f ~/.bashrc ] && source ~/.bashrc
        [ -f ~/.bash_profile ] && source ~/.bash_profile
        [ -f ~/.profile ] && source ~/.profile
        env
      `.trim()
    } else if (shellName === 'zsh') {
      envCommand = `
        [ -f ~/.zshrc ] && source ~/.zshrc
        env
      `.trim()
    } else {
      envCommand = 'env'
    }
  }

  return await new Promise<Record<string, string>>((resolve, reject) => {
    const child = spawn(shell, [...args, envCommand], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    let stdout = ''
    let stderr = ''
    let timeoutId: NodeJS.Timeout | null = null

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
        resolve({})
        return
      }

      if (signal) {
        console.warn(`[ACP] Shell environment command killed by signal: ${signal}`)
        resolve({})
        return
      }

      const env: Record<string, string> = {}
      const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
      for (const line of lines) {
        const match = line.match(/^([^=]+)=(.*)$/)
        if (match) {
          const [, key, value] = match
          env[key.trim()] = value.trim()
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
  if (cachedShellEnv !== null) {
    console.log('[ACP] Using cached shell environment variables')
    return cachedShellEnv
  }

  console.log('[ACP] Fetching shell environment variables (this may take a moment)...')

  try {
    const shellEnv = await executeShellEnvCommand()
    const filteredEnv: Record<string, string> = {}

    if (shellEnv.PATH) {
      filteredEnv.PATH = shellEnv.PATH
    }
    if (shellEnv.Path) {
      filteredEnv.Path = shellEnv.Path
    }

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
