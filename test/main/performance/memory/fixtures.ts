export interface SyntheticMemoryRow {
  id: string
  agentId: string
  content: string
  createdAt: number
}

export interface SyntheticTapeEntry {
  id: number
  sessionId: string
  messageId: string
  orderSeq: number
  content: string
}

export interface SyntheticDecisionCandidate {
  candidateIndex: number
  content: string
  neighbors: Array<{ id: string; content: string }>
}

export interface SyntheticAgent {
  id: string
  embedding: { providerId: string; modelId: string }
}

export function buildMemoryFixture(count: number, agentId = 'agent-0'): SyntheticMemoryRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `memory-${index.toString().padStart(6, '0')}`,
    agentId,
    content: index % 10 === 0 ? `redis project fact ${index}` : `synthetic memory ${index}`,
    createdAt: index + 1
  }))
}

export function buildTapeFixture(count: number, sessionId = 'session-0'): SyntheticTapeEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    sessionId,
    messageId: `message-${index.toString().padStart(6, '0')}`,
    orderSeq: index + 1,
    content: `synthetic tape entry ${index}`
  }))
}

export function buildAgentFixture(count: number): SyntheticAgent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `agent-${index.toString().padStart(3, '0')}`,
    embedding: { providerId: 'shared-provider', modelId: 'shared-model' }
  }))
}

export function buildDecisionFixture(
  candidateCount = 8,
  neighborsPerCandidate = 3
): SyntheticDecisionCandidate[] {
  return Array.from({ length: candidateCount }, (_, candidateIndex) => ({
    candidateIndex,
    content: `topic${candidateIndex} shared durable fact`,
    neighbors: Array.from({ length: neighborsPerCandidate }, (_, neighborIndex) => ({
      id: `neighbor-${candidateIndex}-${neighborIndex}`,
      content: `topic${candidateIndex} shared durable fact neighbor ${neighborIndex}`
    }))
  }))
}
