import desktop from './packages/desktop/vitest.config'
import kernel from './packages/agent-kernel/test/vitest.config'
import mcp from './packages/mcp/vitest.config'
import shared from './packages/shared/vitest.config'
import { fileURLToPath } from 'node:url'

const [renderer, main] = desktop.test.projects
const providerArtifactTest = 'test/main/provider/providerPackage.test.ts'
const kernelArtifactTest = 'test/kernelPackage/agentKernelPackageRuntime.test.ts'

const mainWithoutArtifact = {
  ...main,
  test: {
    ...main.test,
    exclude: [providerArtifactTest]
  }
}

const kernelWithoutArtifact = {
  ...kernel,
  test: {
    ...kernel.test,
    exclude: [kernelArtifactTest]
  }
}

const artifact = {
  ...main,
  test: {
    ...main.test,
    name: 'artifact',
    include: [
      fileURLToPath(new URL(`./packages/desktop/${providerArtifactTest}`, import.meta.url)),
      fileURLToPath(new URL(`./packages/agent-kernel/${kernelArtifactTest}`, import.meta.url))
    ],
    fileParallelism: false,
    maxWorkers: 1
  }
}

export default {
  ...desktop,
  root: import.meta.dirname,
  test: {
    ...desktop.test,
    projects: [renderer, mainWithoutArtifact, kernelWithoutArtifact, shared, mcp, artifact]
  }
}
