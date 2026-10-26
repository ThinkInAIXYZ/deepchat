import { app } from 'electron'
import { setLegacyConsoleDebugEnabled } from '@shared/logger'
import { startApp } from './appMain'

setLegacyConsoleDebugEnabled(!app.isPackaged)
startApp()
