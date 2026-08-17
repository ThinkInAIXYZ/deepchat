import logger from '@shared/logger'
import { app } from 'electron'
import type { MainDatabase } from '@/data/mainDatabase'
import type { DatabaseStartupFailureKind } from '@shared/contracts/databaseSecurity'
import {
  allocateQuarantineDirectory,
  classifyDatabaseStartupFailure,
  isDecryptedDatabaseCorruptionError,
  OrphanWalDatabaseError,
  quarantineDatabaseFiles
} from '@/data/databaseStartupRecovery'
import { DatabaseInitializer, type DatabaseInitializationObservation } from './databaseInitializer'
import type { DatabaseSecurityService } from './databaseSecurity'
import type { SplashWindow } from './splashWindow'

export async function initializeMainDatabaseWithRecovery(input: {
  security: DatabaseSecurityService
  splash: SplashWindow
  observe?: (observation: DatabaseInitializationObservation) => void | Promise<void>
}): Promise<MainDatabase> {
  const dbPath = input.security.getDatabasePath()
  let password: string | undefined
  let passwordResolved = false
  let pending:
    | {
        kind: DatabaseStartupFailureKind
        invalidPassword: boolean
        quarantineFailed: boolean
        quarantineDirectory: string
      }
    | undefined

  const beginRecovery = (kind: DatabaseStartupFailureKind) => {
    pending = {
      kind,
      invalidPassword: false,
      quarantineFailed: false,
      quarantineDirectory: allocateQuarantineDirectory(dbPath)
    }
  }

  while (true) {
    if (!passwordResolved) {
      try {
        password = await input.security.resolveStartupPassword((request) =>
          input.splash.requestDatabaseUnlock(request)
        )
        passwordResolved = true
      } catch (error) {
        const kind = classifyDatabaseStartupFailure({ error, dbPath, password })
        if (!kind) {
          throw error
        }
        beginRecovery(kind)
      }
    }

    if (pending) {
      const choice = await input.splash.requestDatabaseRecovery({
        kind: pending.kind,
        preservedPath: pending.quarantineDirectory,
        invalidPassword: pending.invalidPassword,
        ...(pending.quarantineFailed ? { quarantineFailed: true } : {})
      })

      if (!choice) {
        app.quit()
        throw new Error('Database recovery canceled')
      }

      if (choice.action === 'password') {
        try {
          input.security.validatePassword(choice.password)
        } catch (error) {
          if (isDecryptedDatabaseCorruptionError(error)) {
            password = choice.password
            passwordResolved = true
            input.security.persistRecoveredEncryptionMetadata(choice.password)
            pending = {
              ...pending,
              kind: 'true-corruption',
              invalidPassword: false,
              quarantineFailed: false
            }
            continue
          }
          if (error instanceof OrphanWalDatabaseError) {
            pending = {
              ...pending,
              kind: 'orphaned-sidecar',
              invalidPassword: false,
              quarantineFailed: false
            }
            continue
          }
          pending = { ...pending, invalidPassword: true, quarantineFailed: false }
          continue
        }

        password = choice.password
        passwordResolved = true
        input.security.persistRecoveredEncryptionMetadata(choice.password)
        pending = undefined
        continue
      }

      try {
        quarantineDatabaseFiles(dbPath, pending.quarantineDirectory)
      } catch (error) {
        logger.warn('DatabaseStartup: failed to quarantine damaged database', error)
        pending = {
          ...pending,
          quarantineFailed: true
        }
        continue
      }

      logger.info(`DatabaseStartup: quarantined damaged database to ${pending.quarantineDirectory}`)
      if (pending.kind === 'unreadable' && password === undefined) {
        input.security.clearEncryptionMetadata()
      }
      pending = undefined
      continue
    }

    try {
      const initializer = new DatabaseInitializer({
        password,
        dbPath,
        observe: input.observe
      })
      return await initializer.initialize()
    } catch (error) {
      const kind = classifyDatabaseStartupFailure({ error, dbPath, password })
      if (!kind) {
        throw error
      }
      beginRecovery(kind)
    }
  }
}
