import { performance } from 'node:perf_hooks'
import process from 'node:process'

const DEFAULT_HISTORY_SIZE = 200
const DEFAULT_ITERATIONS = 1_000

function parsePositiveInteger(value, option) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer; received ${value ?? '(missing)'}.`)
  }
  return parsed
}

function readOptions(args) {
  let historySize = DEFAULT_HISTORY_SIZE
  let iterations = DEFAULT_ITERATIONS

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') {
      continue
    }
    if (argument === '--history-size') {
      historySize = parsePositiveInteger(args[++index], argument)
    } else if (argument === '--iterations') {
      iterations = parsePositiveInteger(args[++index], argument)
    } else if (argument === '--help' || argument === '-h') {
      console.log(`Usage: pnpm run profile:manual:display-message-tail -- [options]

Options:
  --history-size <number>  Settled rows before the streaming tail (default: ${DEFAULT_HISTORY_SIZE})
  --iterations <number>    Streaming snapshots to profile (default: ${DEFAULT_ITERATIONS})`)
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${argument}`)
    }
  }

  return { historySize, iterations }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function countReusedReferences(previous, next) {
  return next.reduce((count, entry, index) => count + Number(entry === previous[index]), 0)
}

function profile({ historySize, iterations }) {
  const stable = Array.from({ length: historySize }, (_, index) => ({ id: `history-${index}` }))
  let previousFastPath = stable.concat({ id: 'stream', snapshot: 0 })
  let previousFullRebuild = previousFastPath
  const fastPathTimings = []
  const fullRebuildTimings = []
  let fastPathReusedReferences = 0
  let fullRebuildReusedReferences = 0

  for (let snapshot = 1; snapshot <= iterations; snapshot += 1) {
    const tail = { id: 'stream', snapshot }

    const fastPathStart = performance.now()
    const nextFastPath = stable.concat(tail)
    fastPathTimings.push(performance.now() - fastPathStart)
    fastPathReusedReferences += countReusedReferences(previousFastPath, nextFastPath)
    previousFastPath = nextFastPath

    const fullRebuildStart = performance.now()
    const nextFullRebuild = [...stable.map((entry) => ({ ...entry })), tail]
    fullRebuildTimings.push(performance.now() - fullRebuildStart)
    fullRebuildReusedReferences += countReusedReferences(previousFullRebuild, nextFullRebuild)
    previousFullRebuild = nextFullRebuild
  }

  const totalEntries = (historySize + 1) * iterations
  console.log('Display-message stable/tail fast-path profile (manual; not a CI gate)')
  console.log(`history size: ${historySize}; iterations: ${iterations}`)
  console.table([
    {
      strategy: 'stable/tail fast path',
      reusedReferences: `${fastPathReusedReferences}/${totalEntries}`,
      medianMs: median(fastPathTimings).toFixed(4)
    },
    {
      strategy: 'full row rebuild comparison',
      reusedReferences: `${fullRebuildReusedReferences}/${totalEntries}`,
      medianMs: median(fullRebuildTimings).toFixed(4)
    }
  ])
}

try {
  profile(readOptions(process.argv.slice(2)))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
