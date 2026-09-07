import { createHash } from 'node:crypto'

import type {
  AgentMemoryKind,
  MemoryTombstoneIdentity,
  MemoryTombstoneIdentityKind,
  MemoryScope
} from '../domain/types'
import { normalizeForProvenanceV2 } from './scoring'
import { normalizeMemoryScope } from './scope'

const MEMORY_TOMBSTONE_HASH_DOMAIN = 'deepchat.agent-memory.tombstone.v1'
const SCOPED_CONTENT_TOMBSTONE_HASH_DOMAIN = 'deepchat.agent-memory.tombstone.content.v2'

export function isTombstoneEligibleMemoryKind(kind: AgentMemoryKind): boolean {
  return kind !== 'persona' && kind !== 'working'
}

function hashMemoryTombstoneIdentity(
  agentId: string,
  identityKind: MemoryTombstoneIdentityKind,
  value: string
): string {
  return createHash('sha256')
    .update(JSON.stringify([MEMORY_TOMBSTONE_HASH_DOMAIN, identityKind, agentId, value]), 'utf8')
    .digest('hex')
}

function hashScopedContentTombstoneIdentity(
  agentId: string,
  scope: Exclude<MemoryScope, { type: 'agent' }>,
  normalizedContent: string
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        SCOPED_CONTENT_TOMBSTONE_HASH_DOMAIN,
        agentId,
        scope.type,
        scope.id,
        normalizedContent
      ]),
      'utf8'
    )
    .digest('hex')
}

export function buildMemoryTombstoneIdentities(input: {
  agentId: string
  content: string
  provenanceKey: string | null
  scope: MemoryScope
}): MemoryTombstoneIdentity[] {
  const identities: MemoryTombstoneIdentity[] = []
  if (input.provenanceKey) {
    identities.push({
      identityKind: 'provenance',
      identityHash: hashMemoryTombstoneIdentity(input.agentId, 'provenance', input.provenanceKey)
    })
  }
  const scope = normalizeMemoryScope(input.scope)
  const normalizedContent = normalizeForProvenanceV2(input.content)
  identities.push({
    identityKind: 'content',
    // Keep the original identity for agent-scoped rows so tombstones created before typed scopes
    // remain effective. Narrower scopes use an explicit v2 domain to avoid suppressing identical
    // content in an unrelated user, project, or session scope.
    identityHash:
      scope.type === 'agent'
        ? hashMemoryTombstoneIdentity(input.agentId, 'content', normalizedContent)
        : hashScopedContentTombstoneIdentity(input.agentId, scope, normalizedContent)
  })
  return identities
}
