import assert from 'node:assert/strict'
import { definePlugin } from '@arcships/rutis'
import { POSIX_COMMAND_SHELL } from '../../helpers/commandShell'
import { CoreHarnessControl, type CoreControlService } from '../../../src/harness/core/control'
import { CorePayloadStore } from '../../../src/harness/core/payload'
import { DeepChatAgentRuntime } from '../../../src/main/agent/deepchat/instance/deepChatAgentRuntime'
import { SessionStatusPublisher } from '../../../src/main/agent/deepchat/runtime/sessionStatusPublisher'
import { RunLifecycleCoordinator } from '../../../src/main/agent/deepchat/runtime/runLifecycleCoordinator'
import { ProviderPermissionCoordinator } from '../../../src/main/agent/deepchat/runtime/providerPermissionCoordinator'
import { createLoopRun } from '../../../src/main/agent/deepchat/loop/loopRun'
import { toAppSessionId } from '../../../src/main/agent/shared/agentSessionIds'
import { CoreCarrierConfigSchema, type CorePayload } from '../../../src/shared/harness/core'
import type { DeepChatExecutionContract } from '../../../src/shared/types/execution-contract'

export default definePlugin({
  name: 'core-control-contract',
  inject: ['deepchatCoreNative'],
  provides: {
    deepchatCore: { identity: 'async', configure: 'async', status: 'async', stop: 'async' }
  },
  async apply(ctx, input) {
    const config = CoreCarrierConfigSchema.parse(input)
    const payloads = new CorePayloadStore(config, 'core')
    const service = ctx.use<CoreControlService>('deepchatCoreNative')
    let queuedAcceptance: (() => void) | undefined
    let failed = false
    const control = new CoreHarnessControl(
      {
        async control(generation, sequence, command) {
          const receipt = await service.control(generation, sequence, command)
          if (command.method === 'queueAcceptance') {
            const queued = queuedAcceptance
            queuedAcceptance = undefined
            queued?.()
          }
          return receipt
        }
      },
      config.generation,
      () => {
        failed = true
      }
    )
    const runtime = new DeepChatAgentRuntime(control)
    let stopped = false
    const status = () => ({
      generation: config.generation,
      pid: process.pid,
      node: process.versions.node,
      modules: process.versions.modules,
      phase: stopped ? 'stopped' : 'idle',
      businessReady: false
    })
    ctx.effect(async () => {
      control.stop()
      await payloads.close()
    })
    ctx.provide('deepchatCore', {
      identity: status,
      status: async () => await payloads.encode(status()),
      async configure(ref: CorePayload) {
        await payloads.decode(ref)
        await assert.rejects(
          service.control('foreign', 1, {
            method: 'open',
            sessionId: 'foreign',
            scopeId: 'foreign'
          }),
          /generation is unavailable/
        )
        await control.send({ method: 'inputRecovery', sessions: [] })
        const sessionId = toAppSessionId('session')
        const scope = runtime.getOrHydrateScope(sessionId)
        assert.equal(scope.isCurrent(), false)
        await scope.instance.controlReady()
        assert.equal(scope.isCurrent(), true)
        scope.instance.setRuntimeState({
          status: 'idle',
          providerId: 'openai',
          modelId: 'model',
          permissionMode: 'full_access'
        })
        const events: string[] = []
        const publisher = new SessionStatusPublisher({
          publishEvent: (name) => {
            events.push(name)
          },
          publishSessionUpdate: () => {},
          sessionUiPort: { refreshSessionUi() {} }
        })
        const first = await scope.instance.ensureOperationController()
        const owner = scope.instance.operationOwner(first)
        const makeRun = (
          abortController: AbortController,
          runId: string,
          runSessionId = sessionId
        ) =>
          createLoopRun({
            runId,
            sessionId: runSessionId,
            messageId: 'message',
            abortController,
            messages: [],
            streamState: {},
            resources: {
              toolDefinitions: [],
              activeSkillNames: [],
              commandShell: POSIX_COMMAND_SHELL,
              toolMode: { mode: 'agent', source: 'fallback' }
            }
          })
        const run = makeRun(first, 'run')
        assert.equal(await publisher.transition(scope, 'generating', owner), true)
        assert.equal(events.length, 2)
        await scope.instance.registerActiveGeneration(run)
        assert.equal(await scope.instance.ensureOperationController(), first)
        assert.equal(scope.instance.getActiveGeneration(), run)
        assert.equal(await scope.instance.markFirstTurnReady(run.runId), true)
        assert.equal(await scope.instance.waitForFirstTurnReady({ timeoutMs: 0 }), true)
        const lifecycle = new RunLifecycleCoordinator({
          runtime,
          statusPublisher: publisher,
          transcript: { getMessage: () => null, getMessages: () => [], setMessageError() {} },
          pendingInputWakeup: { drain: async () => false },
          terminalObserver: { observeTerminal() {} },
          messageProjection: { refresh() {} },
          programmaticAuthority: { revokeConversation() {} }
        })
        const nativePermissions: Array<{ requestId: string; granted: boolean }> = []
        const decisions: boolean[] = []
        const lateEntered = Promise.withResolvers<void>()
        const lateReleased = Promise.withResolvers<void>()
        let lateCommitted = false
        const permissions = new ProviderPermissionCoordinator({
          runLifecycle: lifecycle,
          messageStore: {
            getMessage: () => null,
            updateAssistantContent() {},
            setMessageError() {}
          },
          messageProjection: { refresh() {} },
          publishEvent() {},
          permissionPort: {
            async resolveAgentPermission(requestId, granted) {
              nativePermissions.push({ requestId, granted })
              if (requestId === 'late') {
                lateEntered.resolve()
                await lateReleased.promise
              }
            }
          }
        })
        const permission = (requestId: string) => ({
          requestId,
          providerId: 'acp',
          permissionType: 'command' as const
        })
        await permissions.register(
          scope,
          run,
          permission('request'),
          { callId: 'tool' },
          (granted) => {
            decisions.push(granted)
          }
        )
        await scope.instance.replacePendingInteractions([
          { messageId: 'message', toolCallId: 'tool', origin: 'acp-permission', order: 0 }
        ])
        const approval = await scope.instance.acquireInteraction('message', 'tool')
        assert.ok(approval && approval !== 'parked')
        const answer = {
          sessionId,
          messageId: 'message',
          toolCallId: 'tool',
          requestId: 'request',
          permissionType: 'command' as const,
          granted: true,
          ownerRun: run,
          interactionLeaseId: approval.id,
          signal: first.signal
        }
        await permissions.resolve(answer)
        assert.deepEqual(decisions, [true])
        assert.equal(scope.instance.hasActiveProviderPermission('request'), false)
        await permissions.resolve(answer)
        assert.equal(nativePermissions.length, 1)
        await permissions.resolve({ ...answer, requestId: 'direct', granted: false })
        assert.deepEqual(nativePermissions.at(-1), { requestId: 'direct', granted: false })
        await permissions.register(
          scope,
          run,
          permission('request'),
          { callId: 'new-tool' },
          (granted) => {
            decisions.push(granted)
          }
        )
        await permissions.resolve(answer)
        assert.equal(nativePermissions.length, 2)
        assert.equal(scope.instance.hasActiveProviderPermission('request'), true)
        await scope.instance.unlockInteraction(approval)
        await permissions.register(scope, run, permission('empty-tool'), {}, (granted) => {
          decisions.push(granted)
        })
        await permissions.register(scope, run, permission('late'), { callId: 'late-tool' }, () => {
          lateCommitted = true
        })
        await scope.instance.replacePendingInteractions([
          { messageId: 'message', toolCallId: 'late-tool', origin: 'acp-permission', order: 0 }
        ])
        const lateApproval = await scope.instance.acquireInteraction('message', 'late-tool')
        assert.ok(lateApproval && lateApproval !== 'parked')
        const resolving = permissions.resolve({
          ...answer,
          requestId: 'late',
          toolCallId: 'late-tool',
          interactionLeaseId: lateApproval.id
        })
        await lateEntered.promise
        scope.instance.requestGenerationAbort()
        assert.equal(first.signal.aborted, true)
        lateReleased.resolve()
        await resolving
        await scope.instance.unlockInteraction(lateApproval)
        assert.equal(lateCommitted, false)
        assert.equal(scope.instance.hasActiveProviderPermission('request'), false)
        assert.equal(scope.instance.hasActiveProviderPermission('empty-tool'), false)
        assert.deepEqual(decisions, [true, false, false])
        const next = await scope.instance.ensureOperationController()
        assert.notEqual(next, first)
        assert.equal(next.signal.aborted, false)
        assert.equal(scope.instance.getActiveGeneration(), undefined)
        let settled = 0
        assert.equal(
          await scope.instance.clearAbortController(first, () => {
            settled++
          }),
          false
        )
        assert.equal(settled, 0)
        assert.equal(await scope.instance.clearActiveGeneration(run.runId), false)
        assert.equal(await publisher.transition(scope, 'error', owner), false)
        assert.equal(events.length, 2)
        assert.equal(scope.state()?.status, 'generating')
        const reuseId = toAppSessionId('reuse-session')
        const reuse = runtime.getOrHydrateScope(reuseId)
        await reuse.instance.controlReady()
        reuse.instance.setRuntimeState({
          status: 'idle',
          providerId: 'openai',
          modelId: 'model',
          permissionMode: 'full_access'
        })
        const shared = await reuse.instance.ensureOperationController()
        const sharedOwner = reuse.instance.operationOwner(shared)
        const older = makeRun(shared, 'reuse-a', reuseId)
        const newer = makeRun(shared, 'reuse-b', reuseId)
        await reuse.instance.registerActiveGeneration(older)
        await reuse.instance.registerActiveGeneration(newer)
        let cleanup = 0
        assert.equal(
          await reuse.instance.clearAbortController(
            shared,
            () => {
              cleanup++
            },
            { operationId: sharedOwner.id, runId: older.runId }
          ),
          false
        )
        assert.equal(reuse.instance.isActiveRun(newer.runId), true)
        assert.equal(await reuse.instance.transitionControlStatus(sharedOwner, 'error'), undefined)
        await reuse.instance.clearActiveGeneration(newer.runId)
        assert.equal(
          await reuse.instance.clearAbortController(
            shared,
            () => {
              cleanup++
            },
            { operationId: sharedOwner.id, runId: older.runId }
          ),
          false
        )
        assert.equal(cleanup, 0)
        await reuse.instance.clearAbortController(
          shared,
          () => {
            cleanup++
          },
          { operationId: sharedOwner.id, runId: newer.runId }
        )
        assert.equal(cleanup, 1)
        const contract: DeepChatExecutionContract = {
          schemaVersion: 1,
          hashVersion: 1,
          request: { sessionId: reuseId, messageId: 'owned', runId: newer.runId, requestSeq: 1 },
          ceilings: { tools: [], workspace: { kind: 'runtime_default' }, maxSubagentDepth: 0 },
          dynamicControlSnapshot: {
            permissionMode: 'full_access',
            requestAdmitted: true,
            cancellationRequested: false
          },
          provenance: {
            promptSections: [],
            providerId: 'openai',
            modelId: 'model',
            promptHash: 'prompt',
            effectiveGenerationConfigHash: 'config',
            providerVisibleToolDefinitionsHash: 'tools',
            internalExecutionPolicyHash: 'policy',
            assemblerVersion: '1',
            taskContractRef: null
          },
          contractHash: 'contract'
        }
        const latestOwner = { kind: 'run' as const, id: newer.runId }
        await reuse.instance.replacePendingToolBatch(
          [
            { messageId: 'owned', toolCallId: 'tail', origin: 'question', order: 1 },
            { messageId: 'owned', toolCallId: 'owned', origin: 'pre-check-permission', order: 0 }
          ],
          {
            callOrder: ['owned', 'tail'],
            invokedCallIds: [],
            committedResultCallIds: [],
            pendingInteractionCallIds: ['owned', 'tail'],
            executionContract: contract
          },
          latestOwner
        )
        assert.equal(reuse.instance.getFirstPendingInteraction()?.toolCallId, 'owned')
        assert.equal(reuse.instance.getPendingToolBatchState()?.executionContract, contract)
        const headLease = await reuse.instance.acquireInteraction('owned', 'owned')
        const tailLease = await reuse.instance.acquireInteraction('owned', 'tail')
        assert.ok(headLease && headLease !== 'parked' && tailLease && tailLease !== 'parked')
        assert.equal(await reuse.instance.checkPendingInteraction(headLease, latestOwner), true)
        assert.equal(await reuse.instance.checkPendingInteraction(tailLease, latestOwner), false)
        await reuse.instance.advancePendingToolBatch({ invokedCallId: 'owned' }, latestOwner)
        await reuse.instance.advancePendingToolBatch(
          { invokedCallId: 'owned', committedResultCallId: 'owned' },
          latestOwner
        )
        assert.deepEqual(reuse.instance.getPendingToolBatchState()?.invokedCallIds, ['owned'])
        await reuse.instance.transitionPendingInteractionOrigin(
          'owned',
          'owned',
          'post-call-permission',
          latestOwner
        )
        await reuse.instance.replacePendingInteractions(
          [
            { messageId: 'owned', toolCallId: 'owned', origin: 'pre-check-permission', order: 99 },
            { messageId: 'owned', toolCallId: 'tail', origin: 'question', order: 0 }
          ],
          latestOwner,
          { reconcile: true }
        )
        assert.deepEqual(reuse.instance.getFirstPendingInteraction(), {
          messageId: 'owned',
          toolCallId: 'owned',
          origin: 'post-call-permission',
          order: 0
        })
        await lifecycle.applyProcessResultStatus(
          reuseId,
          { status: 'paused', pendingInteractions: [] },
          older.runId
        )
        assert.equal(reuse.instance.hasPendingInteractions(), true)
        assert.equal(reuse.instance.getPendingToolBatchState()?.executionContract, contract)
        await lifecycle.applyProcessResultStatus(reuseId, { status: 'completed' }, newer.runId)
        assert.equal(reuse.instance.hasPendingInteractions(), false)
        assert.equal(reuse.instance.getPendingToolBatchState(), undefined)
        await reuse.instance.unlockInteraction(headLease)
        await reuse.instance.unlockInteraction(tailLease)
        const retiringRun = makeRun(next, 'retiring-run')
        await scope.instance.registerActiveGeneration(retiringRun)
        runtime.evict(sessionId)
        const replacement = runtime.getOrHydrateScope(sessionId)
        await replacement.instance.controlReady()
        assert.equal(scope.isCurrent(), false)
        assert.equal(replacement.isCurrent(), true)
        assert.equal(next.signal.aborted, true)
        assert.equal(await scope.instance.clearActiveGeneration(retiringRun.runId), true)
        assert.equal(replacement.isCurrent(), true)
        const pending = replacement.instance.ensureOperationController()
        replacement.instance.requestGenerationAbort()
        const cancelled = await pending
        assert.equal(cancelled.signal.aborted, true)
        const active = await replacement.instance.ensureOperationController()
        await replacement.instance.replacePendingInteractions([
          {
            messageId: 'deferred-message',
            toolCallId: 'deferred-tool',
            origin: 'pre-check-permission',
            order: 0
          }
        ])
        const deferredParent = await replacement.instance.acquireInteraction(
          'deferred-message',
          'deferred-tool'
        )
        assert.ok(deferredParent && deferredParent !== 'parked')
        const deferred = await replacement.instance.registerDeferredToolAbortController(
          'deferred-message',
          'deferred-tool',
          deferredParent,
          replacement.instance.operationOwner(active)
        )
        assert.equal(replacement.instance.hasDeferredToolAbortController('deferred-tool'), true)
        await assert.rejects(
          replacement.instance.registerDeferredToolAbortController(
            'deferred-message',
            'deferred-tool',
            deferredParent,
            replacement.instance.operationOwner(active)
          )
        )
        assert.equal(deferred.signal.aborted, false)
        await replacement.instance.unlockInteraction(deferredParent)
        assert.equal(deferred.signal.aborted, true)
        const nextParent = await replacement.instance.acquireInteraction(
          'deferred-message',
          'deferred-tool'
        )
        assert.ok(nextParent && nextParent !== 'parked')
        const nextDeferred = await replacement.instance.registerDeferredToolAbortController(
          'deferred-message',
          'deferred-tool',
          nextParent,
          replacement.instance.operationOwner(active)
        )
        assert.equal(await replacement.instance.clearDeferredToolAbortController(deferred), false)
        assert.equal(nextDeferred.signal.aborted, false)
        active.abort()
        assert.equal(nextDeferred.signal.aborted, true)
        await replacement.instance.clearDeferredToolAbortController(nextDeferred)
        await replacement.instance.unlockInteraction(nextParent)
        assert.equal(
          await replacement.instance.clearAbortController(active, () => {
            settled++
          }),
          true
        )
        assert.equal(settled, 1)

        const leaseSession = toAppSessionId('lease-session')
        const origin = runtime.getOrHydrateScope(leaseSession)
        await origin.instance.controlReady()
        const interaction = await origin.instance.acquireInteraction('approval', 'tool')
        assert.ok(interaction && interaction !== 'parked')
        assert.equal(await origin.instance.acquireInteraction('approval', 'tool'), null)
        const resume = await origin.instance.tryBeginResume('approval')
        assert.ok(resume)
        assert.equal(await origin.instance.tryBeginResume('approval'), null)
        await origin.instance.finishResume(resume)
        const inputSelection = {
          intent: 'drain' as const,
          source: 'queue' as const,
          reason: 'manual' as const,
          snapshot: {
            queue: [{ id: 'queued', state: 'pending' as const }],
            steerHead: null,
            hasClaimed: false,
            hasBlocking: false,
            awaitingFollowUp: false
          }
        }
        const drain = await origin.instance.beginInput(inputSelection)
        assert.equal(drain.action, 'claim')
        assert.ok(drain.claimId && drain.effectId && drain.drainLeaseId)
        assert.equal(origin.instance.isPendingQueueDraining(), true)
        assert.equal((await origin.instance.beginInput(inputSelection)).action, 'busy')
        const activeAcceptance = await origin.instance.acquireAttachmentAcceptance('send')
        const queued = Promise.withResolvers<void>()
        queuedAcceptance = () => queued.resolve()
        const cancellation = new AbortController()
        const cancelledAcceptance = origin.instance.acquireAttachmentAcceptance(
          'send',
          cancellation.signal
        )
        const abortedAcceptance = assert.rejects(cancelledAcceptance, { name: 'AbortError' })
        await queued.promise
        cancellation.abort()
        await abortedAcceptance
        runtime.evict(leaseSession)
        let successor = runtime.getOrHydrateScope(leaseSession)
        await successor.instance.controlReady()
        await origin.instance.parkInteraction(interaction)
        assert.equal(await successor.instance.acquireInteraction('approval', 'tool'), 'parked')
        assert.equal((await successor.instance.beginInput(inputSelection)).action, 'busy')
        assert.equal((await successor.instance.endInput(drain.drainLeaseId)).released, false)
        await origin.instance.ackInputEffect({
          claimId: drain.claimId,
          effectId: drain.effectId,
          outcome: 'rejected'
        })
        assert.equal((await origin.instance.endInput(drain.drainLeaseId)).released, true)
        const successorQueued = Promise.withResolvers<void>()
        queuedAcceptance = () => successorQueued.resolve()
        let successorEntered = false
        const waiting = successor.instance.acquireAttachmentAcceptance('send').then((release) => {
          successorEntered = true
          return release
        })
        await successorQueued.promise
        assert.equal(successorEntered, false)
        const independent = await successor.instance.acquireAttachmentAcceptance('steer')
        await independent()
        await activeAcceptance()
        const releaseSuccessor = await waiting
        assert.equal(successorEntered, true)
        await releaseSuccessor()
        runtime.evict(leaseSession)
        await runtime.clearSessionControl(leaseSession, successor.instance)
        await assert.rejects(origin.instance.parkInteraction(interaction))
        await origin.instance.unlockInteraction(interaction)
        successor = runtime.getOrHydrateScope(leaseSession)
        await successor.instance.controlReady()
        const successorInteraction = await successor.instance.acquireInteraction('approval', 'tool')
        assert.ok(successorInteraction && successorInteraction !== 'parked')
        await successor.instance.unlockInteraction(successorInteraction)

        const heldAtStop = await successor.instance.acquireAttachmentAcceptance('send')
        const queuedAtStop = Promise.withResolvers<void>()
        queuedAcceptance = () => queuedAtStop.resolve()
        const stoppedWaiter = assert.rejects(successor.instance.acquireAttachmentAcceptance('send'))
        await queuedAtStop.promise

        const final = await replacement.instance.ensureOperationController()
        control.stop()
        await stoppedWaiter
        await assert.rejects(heldAtStop())
        assert.equal(final.signal.aborted, true)
        assert.equal(replacement.isCurrent(), false)
        await assert.rejects(replacement.instance.ensureOperationController())
        assert.equal(failed, false)
        return await payloads.encode({ passed: true })
      },
      async stop() {
        control.stop()
        stopped = true
        return await payloads.encode(status())
      }
    })
  }
})
