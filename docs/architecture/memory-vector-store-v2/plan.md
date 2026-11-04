# Remaining Vector Store Migration Work

The maintained v2 publication, migration, and quarantine contract is in [spec.md](./spec.md).

- [ ] After the compatibility migration window, remove bundled VSS and its materialization and
  network-install machinery, remove `installRuntime:duckdb:vss` from the build, and reduce legacy
  v1 handling to destruction and reindexing.

Until that change, WAL-free v1 preservation remains supported. Current v2 reads never load VSS.
