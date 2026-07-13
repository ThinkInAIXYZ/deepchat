import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test('workspace read-only routes expose directory search and git status @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)
  await expect(app.page.getByTestId('app-main')).toBeVisible()

  const repoRoot = process.cwd()
  const snapshot = await app.page.evaluate(
    async ({ repoRoot }) => {
      type WorkspaceNode = {
        isDirectory?: unknown
        name?: unknown
        path?: unknown
      }

      await window.deepchat.invoke('workspace.register', {
        mode: 'workspace',
        workspacePath: repoRoot
      })

      try {
        const directory = (await window.deepchat.invoke('workspace.readDirectory', {
          path: repoRoot
        })) as {
          nodes?: WorkspaceNode[]
        }
        const search = (await window.deepchat.invoke('workspace.searchFiles', {
          query: 'package',
          workspacePath: repoRoot
        })) as {
          nodes?: WorkspaceNode[]
        }
        const gitStatus = (await window.deepchat.invoke('workspace.getGitStatus', {
          workspacePath: repoRoot
        })) as {
          state?: {
            ahead?: unknown
            behind?: unknown
            branch?: unknown
            changes?: unknown
          } | null
        }

        const nodes = Array.isArray(directory.nodes) ? directory.nodes : []
        const searchNodes = Array.isArray(search.nodes) ? search.nodes : []

        return {
          directoryCount: nodes.length,
          firstNodeValid:
            nodes.length === 0 ||
            (typeof nodes[0]?.name === 'string' &&
              typeof nodes[0]?.path === 'string' &&
              typeof nodes[0]?.isDirectory === 'boolean'),
          gitStateValid:
            gitStatus.state === null ||
            (typeof gitStatus.state?.ahead === 'number' &&
              typeof gitStatus.state?.behind === 'number' &&
              Array.isArray(gitStatus.state?.changes)),
          hasPackageJson: nodes.some((node) => node.name === 'package.json'),
          searchCount: searchNodes.length,
          searchNodeValid:
            searchNodes.length === 0 ||
            (typeof searchNodes[0]?.name === 'string' &&
              typeof searchNodes[0]?.path === 'string' &&
              typeof searchNodes[0]?.isDirectory === 'boolean')
        }
      } finally {
        await window.deepchat.invoke('workspace.unregister', {
          mode: 'workspace',
          workspacePath: repoRoot
        })
      }
    },
    { repoRoot }
  )

  expect(snapshot.directoryCount).toBeGreaterThan(0)
  expect(snapshot.hasPackageJson).toBe(true)
  expect(snapshot.firstNodeValid).toBe(true)
  expect(snapshot.searchCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.searchNodeValid).toBe(true)
  expect(snapshot.gitStateValid).toBe(true)
})
