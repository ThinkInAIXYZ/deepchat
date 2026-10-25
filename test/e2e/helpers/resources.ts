import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'

const execute = promisify(execFile)
const SAMPLE_INTERVAL_MS = 500
const MAX_SAMPLES = 1200

// Use the public rusage_info_v0 layout from the macOS SDK; RSS alone double-counts shared pages.
const MAC_PROCESS_SNAPSHOT = String.raw`
import ctypes, json, os, subprocess, sys
class Usage(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_uint8 * 16)] + [(name, ctypes.c_uint64) for name in
        ['user', 'system', 'idle', 'interrupt', 'pageins', 'wired', 'resident', 'footprint', 'start', 'exit']]
assert ctypes.sizeof(Usage) == 96
class Timebase(ctypes.Structure):
    _fields_ = [('numer', ctypes.c_uint32), ('denom', ctypes.c_uint32)]
timebase = Timebase()
system = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
assert system.mach_timebase_info(ctypes.byref(timebase)) == 0 and timebase.denom > 0
seconds_per_tick = timebase.numer / timebase.denom / 1e9
lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
lib.proc_pid_rusage.restype = ctypes.c_int
probe = Usage()
assert lib.proc_pid_rusage(os.getpid(), 0, ctypes.byref(probe)) == 0 and probe.footprint > 0
root = int(sys.argv[1])
rows = {}
for line in subprocess.check_output(['ps', '-axo', 'pid=,ppid=,comm='], text=True).splitlines():
    fields = line.split(None, 2)
    if len(fields) == 3:
        rows[int(fields[0])] = (int(fields[1]), os.path.basename(fields[2]))
owned = {root}
while True:
    expanded = owned | {pid for pid, (parent, _) in rows.items() if parent in owned}
    if expanded == owned: break
    owned = expanded
result = []
for pid in sorted(owned):
    usage = Usage()
    if pid in rows and lib.proc_pid_rusage(pid, 0, ctypes.byref(usage)) == 0:
        result.append(dict(pid=pid, parent=rows[pid][0], name=rows[pid][1],
            identity=str(usage.start), rssBytes=usage.resident,
            footprintBytes=usage.footprint, cpuSeconds=(usage.user + usage.system) * seconds_per_tick))
assert any(row['pid'] == root for row in result), 'Application process is unavailable'
print(json.dumps(result))
`

type ProcessSample = {
  pid: number
  parent: number
  name: string
  identity: string
  rssBytes: number
  footprintBytes: number
  cpuSeconds: number
}

export async function measureResources(app: ElectronApplication, startedAt: number) {
  if (process.env.DEEPCHAT_E2E_MEASURE_RESOURCES !== '1') return undefined
  if (process.platform !== 'darwin') {
    throw new Error('E2E resource measurement currently requires macOS and Python 3')
  }
  const pid = app.process().pid
  if (!pid) throw new Error('Application process has no PID')
  const histogram = await app.evaluateHandle(() => {
    const { monitorEventLoopDelay } = process.getBuiltinModule(
      'node:perf_hooks'
    ) as typeof import('node:perf_hooks')
    const histogram = monitorEventLoopDelay({ resolution: 10 })
    histogram.enable()
    return histogram
  })
  const samples: Array<{ elapsedMs: number; processes: ProcessSample[] }> = []
  let failure: unknown
  let uiReadyMs: number | undefined
  let stopped = false
  let pending: Promise<void> | undefined
  const takeSample = () => {
    if (pending || stopped) return pending
    pending = (async () => {
      if (samples.length >= MAX_SAMPLES) throw new Error('Resource sample limit exceeded')
      const { stdout } = await execute('python3', ['-c', MAC_PROCESS_SNAPSHOT, String(pid)], {
        timeout: 5000,
        maxBuffer: 1024 * 1024
      })
      samples.push({ elapsedMs: performance.now() - startedAt, processes: JSON.parse(stdout) })
    })()
      .catch((error) => {
        failure = error
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }
  await takeSample()
  const timer = setInterval(takeSample, SAMPLE_INTERVAL_MS)
  timer.unref()
  return {
    async ready(page: Page) {
      await page.getByTestId('app-root').waitFor({ state: 'visible', timeout: 60_000 })
      await page.getByTestId('window-sidebar').waitFor({ state: 'visible', timeout: 30_000 })
      uiReadyMs = performance.now() - startedAt
    },
    async finish(testInfo: TestInfo, launch: number) {
      clearInterval(timer)
      await pending
      await takeSample()
      stopped = true
      const eventLoop = await histogram.evaluate(async (histogram) => {
        // Keep a Node task alive while the inspector settles its awaited result.
        await new Promise<void>((resolve) => setImmediate(resolve))
        histogram.disable()
        return { p95Ms: histogram.percentile(95) / 1e6, p99Ms: histogram.percentile(99) / 1e6 }
      })
      await histogram.dispose()
      if (failure) throw failure
      const report = {
        schema: 1,
        platform: process.platform,
        architecture: process.arch,
        sampleIntervalMs: SAMPLE_INTERVAL_MS,
        uiReadyMs,
        eventLoop,
        samples
      }
      const output = testInfo.outputPath(`resources-${launch}.json`)
      await writeFile(output, JSON.stringify(report, null, 2))
      await testInfo.attach(`resources-${launch}`, {
        path: output,
        contentType: 'application/json'
      })
    }
  }
}
