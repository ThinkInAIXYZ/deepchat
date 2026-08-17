import logger from '@shared/logger'
import { app } from 'electron'
import type { MainDatabase } from '@/data/mainDatabase'
import {
  classifyDatabaseStartupFailure,
  isDecryptedDatabaseCorruptionError,
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
        kind: NonNullable<ReturnType<typeof classifyDatabaseStartupFailure>>
        invalidPassword: boolean
      }
    | undefined

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
        pending = { kind, invalidPassword: false }
      }
    }

    if (pending) {
      const choice = await input.splash.requestDatabaseRecovery({
        kind: pending.kind,
        preservedPath: `${dbPath}.corrupt.*`,
        invalidPassword: pending.invalidPassword
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
            pending = { kind: 'true-corruption', invalidPassword: false }
            continue
          }
          pending = { ...pending, invalidPassword: true }
          continue
        }

        password = choice.password
        passwordResolved = true
        input.security.persistRecoveredEncryptionMetadata(choice.password)
        pending = undefined
        continue
      }

      const preservedPath = quarantineDatabaseFiles(dbPath)
      logger.info(`DatabaseStartup: quarantined damaged database to ${preservedPath}`)
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
      const database = await initializer.initialize()
      await initializer.migrate()
      return database
    } catch (error) {
      const kind = classifyDatabaseStartupFailure({ error, dbPath, password })
      if (!kind) {
        throw error
      }
      pending = { kind, invalidPassword: false }
    }
  }
}
