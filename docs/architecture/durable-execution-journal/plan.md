# Remaining Execution Journal Work

The maintained persistence, dispatch, recovery, and effective-order contracts are in
[spec.md](./spec.md).

- [ ] Preserve future non-corruption Journal failure subtypes through terminal error wrapping.
- [ ] Replace the low-frequency full-session Tape read used by assistant record revisions with
  a targeted tool revision index.
- [ ] If profiling shows revision-index hashing is material, select winning terminal entries
  before computing SHA-256 fingerprints.

Changes must preserve strict journal idempotency, pre-dispatch durability, native SQLite search
parity, effective-order projection, and restart classification.
