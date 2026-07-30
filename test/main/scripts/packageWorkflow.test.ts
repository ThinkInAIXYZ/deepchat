import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const { spawnSync } =
  await vi.importActual<typeof import('node:child_process')>('node:child_process')

interface WorkflowStep {
  name?: string
  uses?: string
  if?: string
  run?: string
  shell?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}

interface ReusableWorkflow {
  on: {
    workflow_call: {
      inputs: Record<string, { required: boolean; type: string }>
      secrets: Record<string, { required: boolean }>
    }
  }
  permissions: Record<string, string>
  env: Record<string, string>
  jobs: {
    package: {
      'runs-on': string
      'timeout-minutes': number
      permissions: Record<string, string>
      steps: WorkflowStep[]
    }
  }
}

interface BuildWorkflowJob {
  if: string
  permissions: Record<string, string>
  strategy: {
    'fail-fast': boolean
    matrix: { arch: string[] }
  }
  uses: string
  with: Record<string, unknown>
  secrets: Record<string, string>
}

interface BuildWorkflow {
  permissions: Record<string, string>
  jobs: Record<string, BuildWorkflowJob>
}

type PackageJobName = 'package-windows' | 'package-linux' | 'package-macos'

interface RegressionStatusJob {
  name: string
  if: string
  concurrency: {
    group: string
    queue: string
  }
  needs: PackageJobName[]
  'runs-on': string
  'timeout-minutes': number
  permissions: Record<string, string>
  steps: WorkflowStep[]
}

interface RegressionWorkflow {
  on: {
    workflow_call: {
      inputs: Record<string, { required: boolean; type: string }>
      secrets: Record<string, { required: boolean }>
    }
    workflow_dispatch: Record<string, never>
    schedule: Array<{ cron: string }>
  }
  permissions: Record<string, string>
  jobs: Record<PackageJobName, BuildWorkflowJob> & {
    'scheduled-status': RegressionStatusJob
  }
}

interface ReleaseWorkflowJob {
  needs?: string | string[]
  'runs-on'?: string
  permissions: Record<string, string>
  outputs?: Record<string, string>
  strategy?: {
    'fail-fast': boolean
    matrix: { arch: string[] }
  }
  uses?: string
  with?: Record<string, unknown>
  secrets?: Record<string, string>
  steps?: WorkflowStep[]
}

interface ReleaseWorkflow {
  permissions: Record<string, string>
  concurrency: {
    group: string
    'cancel-in-progress': boolean
  }
  jobs: Record<string, ReleaseWorkflowJob>
}

const workflowDirectory = path.resolve('.github/workflows')
const readWorkflowSource = (name: string) =>
  fs.readFileSync(path.join(workflowDirectory, name), 'utf8')
const readWorkflow = <T>(name: string) => parse(readWorkflowSource(name)) as T

const commonInputs = {
  'source-sha': { required: true, type: 'string' },
  arch: { required: true, type: 'string' },
  'artifact-purpose': { required: true, type: 'string' },
  'enforce-installer-size': { required: true, type: 'boolean' }
}

const commonSecrets = {
  RTK_GITHUB_TOKEN: { required: false },
  DC_GITHUB_CLIENT_ID: { required: false },
  DC_GITHUB_CLIENT_SECRET: { required: false },
  DC_GITHUB_REDIRECT_URI: { required: false }
}

const reusableWorkflows = {
  windows: {
    name: '_package-windows.yml',
    runner: "${{ inputs.arch == 'arm64' && 'windows-11-arm' || 'windows-2025-vs2026' }}",
    artifact: 'deepchat-package-win32-${{ inputs.arch }}'
  },
  linux: {
    name: '_package-linux.yml',
    runner: "${{ inputs.arch == 'arm64' && 'ubuntu-24.04-arm' || 'ubuntu-24.04' }}",
    artifact: 'deepchat-package-linux-${{ inputs.arch }}'
  },
  macos: {
    name: '_package-macos.yml',
    runner: "${{ inputs.arch == 'arm64' && 'macos-15' || 'macos-15-intel' }}",
    artifact: 'deepchat-package-darwin-${{ inputs.arch }}'
  }
}

const getStep = (workflow: ReusableWorkflow, name: string) => {
  const step = workflow.jobs.package.steps.find((candidate) => candidate.name === name)
  if (!step) throw new Error(`Missing workflow step: ${name}`)
  return step
}

const runBashStep = (script: string, env: NodeJS.ProcessEnv) =>
  spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env
    }
  })

describe('native package reusable workflows', () => {
  it('owns the fixed runner mapping and a shared immutable input contract', () => {
    for (const definition of Object.values(reusableWorkflows)) {
      const workflow = readWorkflow<ReusableWorkflow>(definition.name)
      expect(Object.keys(workflow.on.workflow_call.inputs)).toEqual(
        Object.keys(commonInputs)
      )
      expect(workflow.on.workflow_call.inputs).toMatchObject(commonInputs)
      expect(workflow.permissions).toEqual({ contents: 'read' })
      expect(workflow.env).toMatchObject({
        CI: 'true',
        FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'
      })
      expect(workflow.jobs.package['runs-on']).toBe(definition.runner)
      expect(workflow.jobs.package['timeout-minutes']).toBeGreaterThan(0)
      expect(workflow.jobs.package.permissions).toEqual({ contents: 'read' })
      expect(workflow.jobs.package.steps[0]).toMatchObject({
        name: 'Validate immutable source input'
      })
      expect(workflow.jobs.package.steps[0].run).toContain(
        '^[a-f0-9]{40}$'
      )
    }
  })

  it('passes only explicit platform secrets and never inherits caller secrets', () => {
    const windows = readWorkflow<ReusableWorkflow>(reusableWorkflows.windows.name)
    const linux = readWorkflow<ReusableWorkflow>(reusableWorkflows.linux.name)
    const macos = readWorkflow<ReusableWorkflow>(reusableWorkflows.macos.name)
    expect(windows.on.workflow_call.secrets).toEqual(commonSecrets)
    expect(linux.on.workflow_call.secrets).toEqual(commonSecrets)
    expect(macos.on.workflow_call.secrets).toEqual({
      ...commonSecrets,
      DEEPCHAT_CSC_LINK: { required: false },
      DEEPCHAT_CSC_KEY_PASS: { required: false },
      DEEPCHAT_APPLE_NOTARY_USERNAME: { required: false },
      DEEPCHAT_APPLE_NOTARY_TEAM_ID: { required: false },
      DEEPCHAT_APPLE_NOTARY_PASSWORD: { required: false }
    })
    for (const definition of Object.values(reusableWorkflows)) {
      expect(readWorkflowSource(definition.name)).not.toContain('secrets: inherit')
    }
    expect(readWorkflowSource(reusableWorkflows.windows.name)).not.toContain(
      'DEEPCHAT_APPLE_NOTARY_'
    )
    expect(readWorkflowSource(reusableWorkflows.linux.name)).not.toContain(
      'DEEPCHAT_APPLE_NOTARY_'
    )
  })

  it('keeps target dependency installation frozen and ordered after install:sharp', () => {
    for (const definition of Object.values(reusableWorkflows)) {
      const workflow = readWorkflow<ReusableWorkflow>(definition.name)
      const steps = workflow.jobs.package.steps
      const installs = steps
        .map((step, index) => ({ index, run: step.run }))
        .filter(({ run }) => run === 'pnpm install --frozen-lockfile')
      const sharpIndex = steps.findIndex((step) => step.run === 'pnpm run install:sharp')
      expect(installs).toHaveLength(2)
      expect(installs[0].index).toBeLessThan(sharpIndex)
      expect(sharpIndex).toBeLessThan(installs[1].index)
      const setupNode = steps.find((step) => step.uses?.startsWith('actions/setup-node@'))
      expect(setupNode?.with).toMatchObject({
        'node-version': '24.14.1',
        'package-manager-cache': false
      })
    }
  })

  it('pins external actions and checks out the requested immutable source', () => {
    for (const definition of Object.values(reusableWorkflows)) {
      const workflow = readWorkflow<ReusableWorkflow>(definition.name)
      const actionSteps = workflow.jobs.package.steps.filter((step) => step.uses)
      for (const step of actionSteps) {
        expect(step.uses).toMatch(/^[^@]+@[0-9a-f]{40}$/)
      }
      const checkout = actionSteps.find((step) => step.uses?.startsWith('actions/checkout@'))
      expect(checkout?.with).toMatchObject({
        ref: '${{ inputs.source-sha }}',
        'fetch-depth': 1,
        'persist-credentials': false
      })
    }
  })

  it('uploads only the package contract for distribution and reports for verification', () => {
    for (const definition of Object.values(reusableWorkflows)) {
      const workflow = readWorkflow<ReusableWorkflow>(definition.name)
      const distribution = getStep(workflow, 'Upload distribution package')
      const diagnostics = getStep(workflow, 'Upload verification diagnostics')
      expect(distribution.if).toContain("inputs.artifact-purpose == 'distribution'")
      expect(distribution.with).toMatchObject({
        name: definition.artifact,
        path: 'package-output/',
        'if-no-files-found': 'error',
        'compression-level': 0,
        overwrite: true
      })
      expect(diagnostics.if).toContain("inputs.artifact-purpose == 'verification'")
      expect(String(diagnostics.with?.path)).not.toContain('package-output/files')
      expect(String(diagnostics.with?.path)).not.toContain('package-output/metadata')
      expect(diagnostics.with?.overwrite).toBe(true)
    }
  })

  it('derives macOS distribution evidence and disables identity discovery for verification', () => {
    const source = readWorkflowSource(reusableWorkflows.macos.name)
    const workflow = readWorkflow<ReusableWorkflow>(reusableWorkflows.macos.name)
    expect(source).toContain("if [[ \"${PACKAGE_PURPOSE}\" == 'distribution' ]]")
    expect(source).toContain(
      "CSC_IDENTITY_AUTO_DISCOVERY: ${{ inputs.artifact-purpose == 'verification' && 'false' || '' }}"
    )
    expect(source).toContain(
      "build_for_release: ${{ inputs.artifact-purpose == 'distribution' && '2' || '' }}"
    )
    expect(source).toContain(
      'plugin:bundle -- --name cua --platform darwin --arch "${TARGET_ARCH}" --purpose "${PACKAGE_PURPOSE}"'
    )
    expect(getStep(workflow, 'Create package manifest and verify distribution evidence').run).toContain(
      'scripts/ci/package-manifest.mjs'
    )
    expect(source).not.toContain('signed:')
  })

  it('rejects Apple credentials for verification and requires them for distribution', () => {
    const workflow = readWorkflow<ReusableWorkflow>(reusableWorkflows.macos.name)
    const script = getStep(workflow, 'Validate package request and signing inputs').run!
    const credentialNames = [
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
      'DEEPCHAT_APPLE_NOTARY_USERNAME',
      'DEEPCHAT_APPLE_NOTARY_TEAM_ID',
      'DEEPCHAT_APPLE_NOTARY_PASSWORD'
    ]
    const emptyCredentials = Object.fromEntries(
      credentialNames.map((name) => [name, ''])
    )
    const runValidation = (
      purpose: 'distribution' | 'verification',
      credentials: Record<string, string>
    ) =>
      runBashStep(script, {
        SOURCE_SHA: 'a'.repeat(40),
        TARGET_PLATFORM: 'darwin',
        TARGET_ARCH: 'x64',
        PACKAGE_PURPOSE: purpose,
        ...emptyCredentials,
        ...credentials
      })

    expect(runValidation('verification', {}).status).toBe(0)

    const unexpectedCredentials = Object.fromEntries(
      credentialNames.map((name) => [name, `unexpected-${name}`])
    )
    const verification = runValidation('verification', unexpectedCredentials)
    expect(verification.status).toBe(1)
    expect(verification.stderr).toContain(
      `macOS verification must not receive Apple credentials: ${credentialNames.join(' ')}`
    )

    const distribution = runValidation('distribution', unexpectedCredentials)
    expect(distribution.status).toBe(0)

    const missingDistributionCredential = runValidation('distribution', {
      ...unexpectedCredentials,
      CSC_KEY_PASSWORD: ''
    })
    expect(missingDistributionCredential.status).toBe(1)
    expect(missingDistributionCredential.stderr).toContain(
      'Missing required macOS distribution secrets: CSC_KEY_PASSWORD'
    )
  })

  it('removes Apple credentials from the verification package process', () => {
    const workflow = readWorkflow<ReusableWorkflow>(reusableWorkflows.macos.name)
    const script = getStep(workflow, 'Build and package macOS').run!
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'deepchat-package-workflow-')
    )
    const fakeBinDirectory = path.join(temporaryDirectory, 'bin')
    const fakePnpmPath = path.join(fakeBinDirectory, 'pnpm')
    const credentialNames = [
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
      'DEEPCHAT_APPLE_NOTARY_USERNAME',
      'DEEPCHAT_APPLE_NOTARY_TEAM_ID',
      'DEEPCHAT_APPLE_NOTARY_PASSWORD'
    ]
    fs.mkdirSync(fakeBinDirectory)
    fs.writeFileSync(
      fakePnpmPath,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == 'exec' && "\${2:-}" == 'electron-builder' ]]; then
  {
    for name in ${credentialNames.join(' ')} CSC_IDENTITY_AUTO_DISCOVERY; do
      if [[ -n "\${!name+x}" ]]; then
        printf '%s=set:%s\\n' "\${name}" "\${!name}"
      else
        printf '%s=unset\\n' "\${name}"
      fi
    done
  } > "\${CAPTURE_PATH}"
fi
`
    )
    fs.chmodSync(fakePnpmPath, 0o755)

    const baseEnvironment = {
      PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      TARGET_ARCH: 'x64',
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      ...Object.fromEntries(credentialNames.map((name) => [name, `secret-${name}`]))
    }

    try {
      const verificationCapture = path.join(temporaryDirectory, 'verification.txt')
      const verification = runBashStep(script, {
        ...baseEnvironment,
        PACKAGE_PURPOSE: 'verification',
        CAPTURE_PATH: verificationCapture
      })
      expect(verification.status, verification.stderr).toBe(0)
      const verificationEnvironment = fs.readFileSync(verificationCapture, 'utf8')
      for (const name of credentialNames) {
        expect(verificationEnvironment).toContain(`${name}=unset`)
      }
      expect(verificationEnvironment).toContain(
        'CSC_IDENTITY_AUTO_DISCOVERY=set:false'
      )

      const distributionCapture = path.join(temporaryDirectory, 'distribution.txt')
      const distribution = runBashStep(script, {
        ...baseEnvironment,
        PACKAGE_PURPOSE: 'distribution',
        CAPTURE_PATH: distributionCapture
      })
      expect(distribution.status, distribution.stderr).toBe(0)
      const distributionEnvironment = fs.readFileSync(distributionCapture, 'utf8')
      for (const name of credentialNames) {
        expect(distributionEnvironment).toContain(`${name}=set:secret-${name}`)
      }
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })
})

describe('Build Application caller', () => {
  const workflow = readWorkflow<BuildWorkflow>('build.yml')
  const source = readWorkflowSource('build.yml')

  it('uses a matrix to call each OS workflow with a fixed distribution purpose', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs)).toEqual([
      'package-windows',
      'package-linux',
      'package-macos'
    ])
    const expectedUses = {
      'package-windows': './.github/workflows/_package-windows.yml',
      'package-linux': './.github/workflows/_package-linux.yml',
      'package-macos': './.github/workflows/_package-macos.yml'
    }
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(job.permissions).toEqual({ contents: 'read' })
      expect(job.strategy).toEqual({
        'fail-fast': false,
        matrix: { arch: ['x64', 'arm64'] }
      })
      expect(job.uses).toBe(expectedUses[name as keyof typeof expectedUses])
      expect(job.with).toEqual({
        'source-sha': '${{ github.sha }}',
        arch: '${{ matrix.arch }}',
        'artifact-purpose': 'distribution',
        'enforce-installer-size': false
      })
    }
    expect(source).not.toContain('secrets: inherit')
  })

  it('passes Apple credentials only to the macOS distribution caller', () => {
    const windowsSecrets = Object.keys(workflow.jobs['package-windows'].secrets)
    const linuxSecrets = Object.keys(workflow.jobs['package-linux'].secrets)
    const macSecrets = Object.keys(workflow.jobs['package-macos'].secrets)
    expect(windowsSecrets).toEqual(Object.keys(commonSecrets))
    expect(linuxSecrets).toEqual(Object.keys(commonSecrets))
    expect(macSecrets).toEqual([
      ...Object.keys(commonSecrets),
      'DEEPCHAT_CSC_LINK',
      'DEEPCHAT_CSC_KEY_PASS',
      'DEEPCHAT_APPLE_NOTARY_USERNAME',
      'DEEPCHAT_APPLE_NOTARY_TEAM_ID',
      'DEEPCHAT_APPLE_NOTARY_PASSWORD'
    ])
  })
})

describe('Package Regression caller', () => {
  const workflow = readWorkflow<RegressionWorkflow>('package-regression.yml')
  const source = readWorkflowSource('package-regression.yml')
  const packageJobNames: PackageJobName[] = [
    'package-windows',
    'package-linux',
    'package-macos'
  ]

  it('supports reusable, manual, and daily six-target verification', () => {
    expect(workflow.on.workflow_call.inputs).toMatchObject({
      'source-sha': { required: true, type: 'string' }
    })
    expect(workflow.on.workflow_dispatch).toEqual({})
    expect(workflow.on.schedule).toEqual([{ cron: '37 18 * * *' }])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs)).toEqual([
      ...packageJobNames,
      'scheduled-status'
    ])

    const expectedUses: Record<PackageJobName, string> = {
      'package-windows': './.github/workflows/_package-windows.yml',
      'package-linux': './.github/workflows/_package-linux.yml',
      'package-macos': './.github/workflows/_package-macos.yml'
    }
    for (const name of packageJobNames) {
      const job = workflow.jobs[name]
      expect(job.permissions).toEqual({ contents: 'read' })
      expect(job.strategy).toEqual({
        'fail-fast': false,
        matrix: { arch: ['x64', 'arm64'] }
      })
      expect(job.uses).toBe(expectedUses[name])
      expect(job.with).toEqual({
        'source-sha': '${{ inputs.source-sha || github.sha }}',
        arch: '${{ matrix.arch }}',
        'artifact-purpose': 'verification',
        'enforce-installer-size': true
      })
      expect(Object.keys(job.secrets!)).toEqual(Object.keys(commonSecrets))
    }

    const scheduledStatus = workflow.jobs['scheduled-status']
    expect(scheduledStatus).toMatchObject({
      name: 'scheduled-regression-status',
      if: "${{ always() && github.event_name == 'schedule' }}",
      needs: packageJobNames,
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 5,
      permissions: {
        contents: 'read',
        issues: 'write'
      }
    })
    expect(scheduledStatus.concurrency).toEqual({
      group: 'scheduled-package-regression-issue',
      queue: 'max'
    })
    expect(scheduledStatus.steps).toHaveLength(1)
    expect(scheduledStatus.steps[0]).toMatchObject({
      name: 'Update scheduled package regression issue',
      shell: 'bash',
      env: {
        GH_TOKEN: '${{ github.token }}',
        WINDOWS_RESULT: '${{ needs.package-windows.result }}',
        LINUX_RESULT: '${{ needs.package-linux.result }}',
        MACOS_RESULT: '${{ needs.package-macos.result }}'
      }
    })
  })

  it('cannot receive or forward Apple signing credentials', () => {
    expect(workflow.on.workflow_call.secrets).toEqual(commonSecrets)
    expect(source).not.toContain('DEEPCHAT_CSC')
    expect(source).not.toContain('DEEPCHAT_APPLE')
    expect(source).not.toContain('secrets: inherit')
  })

  it('creates one scheduled failure issue, updates it, and closes it on recovery', () => {
    const statusStep = workflow.jobs['scheduled-status'].steps[0]
    const script = statusStep.run!
    const issueTitle = statusStep.env?.ISSUE_TITLE
    if (!issueTitle) throw new Error('Missing scheduled regression issue title')
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'deepchat-regression-status-')
    )
    const fakeBinDirectory = path.join(temporaryDirectory, 'bin')
    const fakeGhPath = path.join(fakeBinDirectory, 'gh')
    fs.mkdirSync(fakeBinDirectory)
    fs.writeFileSync(
      fakeGhPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'ARG:%s\\n' "\${@}" >> "\${GH_CALLS_PATH}"
if [[ "\${1:-}" == 'issue' && "\${2:-}" == 'list' ]]; then
  printf '%s' "\${FAKE_OPEN_ISSUES:-}"
  exit 0
fi
previous=''
for argument in "\${@}"; do
  if [[ "\${previous}" == '--body-file' ]]; then
    printf '%s\\n' 'BODY:' >> "\${GH_CALLS_PATH}"
    while IFS= read -r line || [[ -n "\${line}" ]]; do
      printf '%s\\n' "\${line}" >> "\${GH_CALLS_PATH}"
    done < "\${argument}"
  fi
  previous="\${argument}"
done
`
    )
    fs.chmodSync(fakeGhPath, 0o755)

    const runStatus = (
      results: {
        windows: string
        linux: string
        macos: string
      },
      openIssues: string
    ) => {
      const callsPath = path.join(temporaryDirectory, 'gh-calls.txt')
      fs.writeFileSync(callsPath, '')
      const result = runBashStep(script, {
        PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        GH_TOKEN: 'test-token',
        GH_CALLS_PATH: callsPath,
        FAKE_OPEN_ISSUES: openIssues,
        GITHUB_REPOSITORY: 'ThinkInAIXYZ/deepchat',
        GITHUB_RUN_NUMBER: '123',
        GITHUB_SHA: 'b'.repeat(40),
        ISSUE_TITLE: issueTitle,
        RUNNER_TEMP: temporaryDirectory,
        RUN_URL: 'https://github.com/ThinkInAIXYZ/deepchat/actions/runs/123',
        WINDOWS_RESULT: results.windows,
        LINUX_RESULT: results.linux,
        MACOS_RESULT: results.macos
      })
      return {
        result,
        calls: fs.readFileSync(callsPath, 'utf8')
      }
    }

    try {
      const firstFailure = runStatus(
        { windows: 'failure', linux: 'success', macos: 'success' },
        ''
      )
      expect(firstFailure.result.status, firstFailure.result.stderr).toBe(0)
      expect(firstFailure.calls).toContain('ARG:issue\nARG:list\n')
      expect(firstFailure.calls).toContain('ARG:--state\nARG:open\n')
      expect(firstFailure.calls).toContain(
        `ARG:--search\nARG:"${issueTitle}" in:title\n`
      )
      expect(firstFailure.calls).toContain('ARG:--json\nARG:number,title\n')
      expect(firstFailure.calls).toContain(
        'ARG:--jq\nARG:.[] | select(.title == env.ISSUE_TITLE) | .number\n'
      )
      expect(firstFailure.calls).toContain('ARG:issue\nARG:create\n')
      expect(firstFailure.calls).toContain('Windows: `failure`')
      expect(firstFailure.calls).toContain(
        'https://github.com/ThinkInAIXYZ/deepchat/actions/runs/123'
      )

      const repeatedFailure = runStatus(
        { windows: 'success', linux: 'success', macos: 'failure' },
        '42'
      )
      expect(repeatedFailure.result.status, repeatedFailure.result.stderr).toBe(0)
      expect(repeatedFailure.calls).toContain('ARG:issue\nARG:comment\nARG:42\n')
      expect(repeatedFailure.calls).not.toContain('ARG:issue\nARG:create\n')

      const recovery = runStatus(
        { windows: 'success', linux: 'success', macos: 'success' },
        '42'
      )
      expect(recovery.result.status, recovery.result.stderr).toBe(0)
      expect(recovery.calls).toContain('ARG:issue\nARG:close\nARG:42\n')
      expect(recovery.calls).toContain('ARG:--reason\nARG:completed\n')
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })
})

describe('Release caller and publication boundary', () => {
  const workflow = readWorkflow<ReleaseWorkflow>('release.yml')
  const source = readWorkflowSource('release.yml')

  it('runs preflight before six distribution packages and keeps write access isolated', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.concurrency).toMatchObject({ 'cancel-in-progress': false })
    expect(Object.keys(workflow.jobs)).toEqual([
      'preflight',
      'package-windows',
      'package-linux',
      'package-macos',
      'assemble',
      'publish'
    ])
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(job.permissions).toEqual({
        contents: name === 'publish' ? 'write' : 'read'
      })
    }

    const expectedUses = {
      'package-windows': './.github/workflows/_package-windows.yml',
      'package-linux': './.github/workflows/_package-linux.yml',
      'package-macos': './.github/workflows/_package-macos.yml'
    }
    for (const [name, reusable] of Object.entries(expectedUses)) {
      const job = workflow.jobs[name]
      expect(job.needs).toBe('preflight')
      expect(job.strategy).toEqual({
        'fail-fast': false,
        matrix: { arch: ['x64', 'arm64'] }
      })
      expect(job.uses).toBe(reusable)
      expect(job.with).toEqual({
        'source-sha': '${{ needs.preflight.outputs.sha }}',
        arch: '${{ matrix.arch }}',
        'artifact-purpose': 'distribution',
        'enforce-installer-size': true
      })
    }
    expect(Object.keys(workflow.jobs['package-windows'].secrets!)).toEqual(
      Object.keys(commonSecrets)
    )
    expect(Object.keys(workflow.jobs['package-linux'].secrets!)).toEqual(
      Object.keys(commonSecrets)
    )
    expect(Object.keys(workflow.jobs['package-macos'].secrets!)).toEqual([
      ...Object.keys(commonSecrets),
      'DEEPCHAT_CSC_LINK',
      'DEEPCHAT_CSC_KEY_PASS',
      'DEEPCHAT_APPLE_NOTARY_USERNAME',
      'DEEPCHAT_APPLE_NOTARY_TEAM_ID',
      'DEEPCHAT_APPLE_NOTARY_PASSWORD'
    ])
  })

  it('downloads exactly six named package artifacts before fail-closed assembly', () => {
    const assemble = workflow.jobs.assemble
    expect(assemble.needs).toEqual([
      'preflight',
      'package-windows',
      'package-linux',
      'package-macos'
    ])
    const downloads = assemble.steps!.filter((step) =>
      step.uses?.startsWith('actions/download-artifact@')
    )
    expect(downloads.map((step) => step.with?.name)).toEqual([
      'deepchat-package-win32-x64',
      'deepchat-package-win32-arm64',
      'deepchat-package-linux-x64',
      'deepchat-package-linux-arm64',
      'deepchat-package-darwin-x64',
      'deepchat-package-darwin-arm64'
    ])
    for (const download of downloads) {
      expect(download.with).toMatchObject({ 'digest-mismatch': 'error' })
    }
    const assembly = assemble.steps!.find(
      (step) => step.name === 'Assemble fail-closed release assets'
    )
    expect(assembly?.run).toContain('scripts/ci/assemble-release.mjs')
    const upload = assemble.steps!.find(
      (step) => step.name === 'Upload verified release assets'
    )
    expect(upload?.with).toMatchObject({
      name: 'deepchat-release-assets',
      path: 'release-assets/',
      'if-no-files-found': 'error',
      'compression-level': 0,
      overwrite: true
    })
  })

  it('revalidates local and remote draft assets before reporting publication success', () => {
    const preflight = workflow.jobs.preflight.steps!.find(
      (step) => step.name === 'Resolve and validate release source'
    )
    expect(preflight?.run).toContain('refs/tags/${release_tag}^{commit}')
    expect(preflight?.run).toContain('git merge-base --is-ancestor')
    expect(preflight?.run).toContain('scripts/ci/release-preflight.mjs')

    const publishSteps = workflow.jobs.publish.steps!
    const release = publishSteps.find((step) => step.name === 'Create draft release')
    expect(release?.uses).toBe(
      'softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228'
    )
    expect(release?.with).toMatchObject({
      draft: true,
      files: 'release-assets/*',
      fail_on_unmatched_files: true,
      overwrite_files: true
    })
    const rejectExisting = publishSteps.find(
      (step) => step.name === 'Reject unknown assets in an existing draft'
    )
    expect(rejectExisting?.run).toContain('/releases?per_page=100')
    expect(rejectExisting?.run).toContain('--allow-partial-assets')
    const verifyPublished = publishSteps.find(
      (step) => step.name === 'Verify published draft assets'
    )
    expect(verifyPublished?.run).toContain('releases/${RELEASE_ID}')
    expect(verifyPublished?.run).toContain('scripts/ci/verify-release-assets.mjs remote')
    expect(source).not.toContain('releases/tags/${RELEASE_TAG}')
  })

  it('pins every external action and removes tolerant legacy assembly', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses) expect(step.uses).toMatch(/^[^@]+@[0-9a-f]{40}$/)
      }
    }
    expect(source).not.toContain('secrets: inherit')
    expect(source).not.toContain('context.sha')
    expect(source).not.toContain('|| true')
    expect(source).not.toContain('ruby ')
    expect(source).not.toContain('release_assets')
    expect(source).not.toContain('.github/actions/light-ocr-package-size')
  })
})
