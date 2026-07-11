# Memory Runtime Metric Dictionary

> Version: **1**  
> Scope: **local in-process diagnostics only**  
> Persistence: **none**

Metrics retain only numbers, booleans, timestamps, and shared closed enums. The collector does not accept or
store query text, memory content, prompts, embedding vectors, provider responses, API keys, exception messages,
SQL, stacks, or other free text.

## Agent Scope

| DTO path | Unit | Sampling point | Capacity and cleanup | Privacy classification |
| --- | --- | --- | --- | --- |
| `agent.retrieval.{recall,decision,search,injection}.latencyMs.*` | Millisecond distribution | Corresponding retrieval operation settlement | 256 samples per Agent and series; 64-Agent LRU; 24-hour TTL; removed by Agent cleanup | Content-free timing |
| `agent.retrieval.*.{ftsCandidates,vectorCandidates,selected}` | Count | Authoritative revalidation and fusion completion | Per-Agent counter; same Agent cleanup | Aggregate count |
| `agent.retrieval.*.outcomeCounts.*` | Count by closed outcome | Operation `finally` | Per-Agent counter; same Agent cleanup | Closed enum |
| `agent.retrieval.*.degradationCounts.*` | Count by closed cause | Operation `finally`; one operation may record multiple causes | Per-Agent counter; same Agent cleanup | Closed enum |
| `agent.extraction.{chunksCompleted,chunksCancelled,chunksFailed,llmCalls,casRetries}` | Count | Chunk settlement or actual second CAS apply | Per-Agent counter; same Agent cleanup | Aggregate count |
| `agent.embedding.batchSize` | Row distribution | Embedding drain batch settlement | 256 samples; same Agent cleanup | Aggregate count |
| `agent.embedding.drainDurationMs` | Millisecond distribution | Embedding drain batch settlement | 256 samples; same Agent cleanup | Content-free timing |
| `agent.embedding.{succeeded,failed,ftsOnly}` | Count | Actual repository terminal-state transitions | Per-Agent counter; same Agent cleanup | Aggregate count |
| `agent.maintenance.{cheapDurationMs,heavyDurationMs}` | Millisecond distribution | Maintenance phase settlement | 256 samples; same Agent cleanup | Content-free timing |
| `agent.maintenance.{completed,skipped,failed,llmCalls,llmTokens}` | Count | Maintenance phase settlement | Per-Agent counter; same Agent cleanup | Aggregate count |
| `agent.maintenance.budgetDeniedByStep.*` | Count by closed step | Every rejected `MaintenanceBudget.reserve`, recorded when the pass settles | Per-Agent counter; same Agent cleanup | Closed enum |

Percentiles are calculated at snapshot time by copying and sorting the ring, then applying nearest-rank p50,
p95, and max. Record hot paths never sort samples.

## Process Scope

| DTO path | Unit | Owner and sampling point | Capacity and cleanup | Privacy classification |
| --- | --- | --- | --- | --- |
| `process.extractionQueue.{depth,oldestQueuedAgeMs}` | Tasks / ms | Agent runtime enqueue, dequeue, and session destruction; absolute value | Outside Agent LRU/TTL; cleared on presenter disposal | Content-free queue state |
| `process.embeddingBacklog.{pending,activeAgents}` | Rows / Agents | Absolute repository count and embedding drain owner | Process singleton; cleared on disposal | Aggregate count |
| `process.vector.{openStores,activeLeases}` | Resources | Resource-owner absolute observation through the composite `MemoryPerfObserver` | Process singleton; cleared on disposal | Resource gauge |
| `process.vector.{openStoresHighWater,activeLeasesHighWater}` | Resources | Updated from the same absolute observation | Process lifetime; cleared on disposal | Resource high-water |
| `process.vector.{evictions,warmupSucceeded,warmupDeferred,warmupFailed}` | Count | Vector convergence and warmup settlement | Process lifetime; cleared on disposal | Closed outcome |
| `process.providerAdmission.queued` | Requests | Absolute admission-waiting gauge before and after rate-limit admission | Process singleton; cleared on disposal | Resource gauge |
| `process.providerAdmission.admissionDecisions.{admitted,rateLimited,capacityRejected}` | Count | Admission decision; at most one per request | Process lifetime; cleared on disposal | Closed enum |
| `process.providerAdmission.raceEvents.{deadline,aborted,lateSettled}` | Count | Outer request race event | Process lifetime; cleared on disposal | Closed enum |

Resource owners write process gauges as absolute values. The collector never derives active process resources
from retained Agent state, so Agent TTL and LRU eviction cannot make active gauges drift. The Health UI labels
all process fields as process-wide.
