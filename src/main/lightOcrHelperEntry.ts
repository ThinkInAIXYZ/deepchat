import { runLightOcrHelper } from './ocr/lightOcrHelper'

const redirectConsoleOutput = (...args: unknown[]) => console.error(...args)
Object.defineProperties(console, {
  log: { configurable: true, value: redirectConsoleOutput, writable: true },
  info: { configurable: true, value: redirectConsoleOutput, writable: true },
  debug: { configurable: true, value: redirectConsoleOutput, writable: true }
})

const server = runLightOcrHelper()

const shutdown = async () => {
  await server.shutdown()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
process.once('uncaughtException', (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
process.once('unhandledRejection', (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
