import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const path = await vi.importActual<typeof import('node:path')>('node:path')

interface WorkflowStep {
  uses?: string
  run?: string
  with?: Record<string, unknown>
}

interface Workflow {
  jobs: Record<string, { steps?: WorkflowStep[] }>
}

const repositoryRoot = process.cwd()
const WORKFLOW_INSTALL_COUNTS = {
  'prcheck.yml': 5,
  'build.yml': 0,
  '_package-windows.yml': 2,
  '_package-linux.yml': 2,
  '_package-macos.yml': 2,
  'package-regression.yml': 0,
  'release.yml': 1,
  'windows-arm64-e2e.yml': 2
}

const readWorkflow = (name: string): Workflow =>
  parse(
    fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', name), 'utf8')
  ) as Workflow

const getSteps = (workflow: Workflow): WorkflowStep[] =>
  Object.values(workflow.jobs).flatMap((job) => job.steps ?? [])

describe('pnpm workflow install contracts', () => {
  for (const [workflowName, expectedInstallCount] of Object.entries(WORKFLOW_INSTALL_COUNTS)) {
    it(`keeps ${workflowName} installs frozen without dependency caching`, () => {
      const steps = getSteps(readWorkflow(workflowName))
      const installCommands = steps.flatMap((step) =>
        step.run?.startsWith('pnpm install') ? [step.run] : []
      )

      expect(installCommands).toHaveLength(expectedInstallCount)
      expect(new Set(installCommands)).toEqual(
        expectedInstallCount === 0
          ? new Set()
          : new Set([
              workflowName === 'release.yml'
                ? 'pnpm install --frozen-lockfile --ignore-scripts'
                : 'pnpm install --frozen-lockfile'
            ])
      )

      const setupNodeSteps = steps.filter((step) => step.uses?.startsWith('actions/setup-node@'))
      if (expectedInstallCount === 0) {
        expect(setupNodeSteps).toHaveLength(0)
      } else {
        expect(setupNodeSteps.length).toBeGreaterThan(0)
      }
      for (const step of setupNodeSteps) {
        expect(step.with).toMatchObject({
          'package-manager-cache': false
        })
      }
    })
  }
})
