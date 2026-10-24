import { definePlugin } from '@arcships/rutis'
import { AgentInvocationAdmission } from '../admission'
import type {
  AgentInvocationAdmissionObservation,
  AgentInvocationAdmissionOptions,
  InternalAgentInvocationPermit
} from '@shared/harness/admission'

export default definePlugin<{ capacity: number; maxPending: number }>({
  name: 'deepchat-admission',
  config: {
    type: 'object',
    required: ['capacity', 'maxPending'],
    additionalProperties: false,
    properties: {
      capacity: { type: 'integer', minimum: 1 },
      maxPending: { type: 'integer', minimum: 0 }
    }
  },
  provides: {
    harnessAdmission: {
      acquire: 'async',
      release: 'async',
      snapshot: 'async',
      close: 'async',
      flushObservations: 'async',
      dispatch: 'async'
    }
  },
  apply(ctx, config) {
    let observationsEnabled = false
    let observationsDropped = 0
    let observationSequence = 0
    const observations = new Set<Promise<void>>()
    const forwardObservation = (observation: AgentInvocationAdmissionObservation) => {
      if (observations.size >= 512 && observation.type !== 'closed') {
        observationsDropped += 1
        return
      }
      const value =
        observation.type === 'closed'
          ? {
              ...observation,
              observationsDropped: observation.observationsDropped + observationsDropped
            }
          : observation
      const task = ctx
        .parallel('deepchat/admission/observation', ++observationSequence, value)
        .catch(() => undefined)
        .finally(() => observations.delete(task))
      observations.add(task)
    }
    const admission = new AgentInvocationAdmission(config.capacity, config.maxPending, {
      observationsEnabled: () => observationsEnabled,
      observe: forwardObservation
    })
    const permits = new Map<
      string,
      { controller: AbortController; permit?: InternalAgentInvocationPermit }
    >()
    const flushObservations = async () => {
      await admission.flushObservations()
      await Promise.all(observations)
    }
    const snapshot = () => ({
      admission: {
        ...admission.snapshot(),
        observationsDropped: admission.snapshot().observationsDropped + observationsDropped
      },
      runtime: {
        pid: process.pid,
        node: process.versions.node,
        electron: process.versions.electron ?? null,
        modules: process.versions.modules
      }
    })

    ctx.effect(async () => {
      admission.close()
      for (const record of permits.values()) {
        record.controller.abort()
        record.permit?.release()
      }
      permits.clear()
      await flushObservations()
    })

    const service = {
      async acquire(
        id: string,
        options: Omit<AgentInvocationAdmissionOptions, 'signal'> & { aborted?: boolean },
        signal: AbortSignal,
        enabled: boolean
      ): Promise<string> {
        if (!(signal instanceof AbortSignal)) throw new Error('Admission requires an AbortSignal')
        observationsEnabled = enabled === true
        if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || permits.has(id)) {
          throw new Error('Invalid admission acquisition identity')
        }
        const record: { controller: AbortController; permit?: InternalAgentInvocationPermit } = {
          controller: new AbortController()
        }
        permits.set(id, record)
        if (options.aborted === true) record.controller.abort()
        const cancellation = AbortSignal.any([ctx.signal, signal, record.controller.signal])
        try {
          const permit = await admission.acquire({ ...options, signal: cancellation })
          record.permit = permit as InternalAgentInvocationPermit
          if (cancellation.aborted) {
            permit.release()
            cancellation.throwIfAborted()
          }
          return id
        } catch (error) {
          if (permits.get(id) === record) permits.delete(id)
          throw error
        }
      },
      release(
        id: string,
        reason: 'permit_released' | 'lease_suspended' | 'lease_released',
        enabled: boolean
      ): boolean {
        if (!['permit_released', 'lease_suspended', 'lease_released'].includes(reason)) {
          throw new Error('Invalid admission release reason')
        }
        observationsEnabled = enabled === true
        const record = permits.get(id)
        if (!record) return false
        permits.delete(id)
        record.controller.abort()
        record.permit?.releaseWithReason(reason)
        return true
      },
      snapshot,
      async close(reason: string, enabled: boolean) {
        observationsEnabled = enabled === true
        admission.close(reason)
        await flushObservations()
      },
      flushObservations
    }
    let nextRequest = 1
    const requests = new Map<
      number,
      {
        method: keyof typeof service
        args: unknown[]
        resolve: (value: unknown) => void
        reject: (error: unknown) => void
      }
    >()
    ctx.effect(() => {
      for (const request of requests.values())
        request.reject(new Error('Admission generation ended'))
      requests.clear()
    })
    ctx.provide('harnessAdmission', {
      ...service,
      dispatch(sequence: number, method: string, args: unknown[]): Promise<unknown> {
        if (
          !Number.isSafeInteger(sequence) ||
          sequence < nextRequest ||
          sequence - nextRequest > 1024 ||
          requests.has(sequence) ||
          !Object.hasOwn(service, method) ||
          !Array.isArray(args)
        ) {
          throw new Error('Invalid admission command sequence')
        }
        return new Promise((resolve, reject) => {
          requests.set(sequence, { method: method as keyof typeof service, args, resolve, reject })
          while (requests.has(nextRequest)) {
            const request = requests.get(nextRequest)!
            requests.delete(nextRequest++)
            try {
              // Start in caller order; a queued acquire must not block later release commands.
              Promise.resolve(Reflect.apply(service[request.method], undefined, request.args)).then(
                request.resolve,
                request.reject
              )
            } catch (error) {
              request.reject(error)
            }
          }
        })
      }
    })
  }
})
