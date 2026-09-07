import type {
  CronJob,
  CronJobDeliveryReceipt,
  CronJobDeliveryTarget,
  CronJobRun
} from '@shared/cronJobs'
import { CronJobsRepository } from './repository'

export interface CronJobRemoteDeliveryPort {
  deliverCronJobResult(input: {
    job: CronJob
    run: CronJobRun
    target: Extract<CronJobDeliveryTarget, { type: 'remote' }>
  }): Promise<{ remoteMessageId?: string | null }>
}

export class CronJobDeliveryRouter {
  constructor(
    private readonly repository: CronJobsRepository,
    private readonly remoteDeliveryPort: CronJobRemoteDeliveryPort
  ) {}

  async deliver(input: { job: CronJob; run: CronJobRun }): Promise<CronJobDeliveryReceipt[]> {
    const targets = this.getTargets(input.job, input.run)
    return await Promise.all(targets.map((target) => this.deliverTarget(input, target)))
  }

  private getTargets(job: CronJob, run: CronJobRun): CronJobDeliveryTarget[] {
    if (run.status === 'completed') {
      return job.delivery.suppressSuccessNotification ? [] : job.delivery.targets
    }

    if ((run.status === 'failed' || run.status === 'cancelled') && job.delivery.notifyOnFailure) {
      return job.delivery.targets
    }

    return []
  }

  private async deliverTarget(
    input: { job: CronJob; run: CronJobRun },
    target: CronJobDeliveryTarget
  ): Promise<CronJobDeliveryReceipt> {
    try {
      const remoteMessageId = await this.dispatch(input, target)
      return this.repository.recordDelivery({
        jobId: input.job.id,
        runId: input.run.id,
        target,
        status: 'success',
        remoteMessageId
      })
    } catch (error) {
      return this.repository.recordDelivery({
        jobId: input.job.id,
        runId: input.run.id,
        target,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async dispatch(
    input: { job: CronJob; run: CronJobRun },
    target: CronJobDeliveryTarget
  ): Promise<string | null> {
    const result = await this.remoteDeliveryPort.deliverCronJobResult({
      ...input,
      target
    })
    return result.remoteMessageId ?? null
  }
}
