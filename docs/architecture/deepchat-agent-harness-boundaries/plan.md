# Remaining Harness Boundary Work

Current runtime and hook contracts are in [spec.md](./spec.md). Host ports and Node acceptance are
maintained in [Main host boundaries](../main-harness-portability/spec.md).

- [ ] Compact the full-runtime integration suite by moving owner-only behavior to existing focused
      suites without duplicating protection. Shared hoisted mocks need explicit fixture ownership;
      preserve distinct integration, recovery, persistence, and authority regressions.
- [ ] Design hook decision semantics separately only if the product and security model are approved.
- [ ] Design same-run steering separately only if its product semantics are approved.

The existing instance-scoped pump lease and durable claim remain authoritative during any later
steer-lane change. The service/runtime drain-error reporting overlap and hook environment/process-tree
limits require their own owner review before changing behavior.
