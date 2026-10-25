import { describe, expect, it } from 'vitest'
import { createAzure } from '@ai-sdk/azure'
import { createGoogle } from '@ai-sdk/google'
import { createVertex } from '@ai-sdk/google-vertex'
import { createVertex as createVertexEdge } from '@ai-sdk/google-vertex/edge'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV4 } from '@ai-sdk/provider'

const openaiBody = (vector: unknown) => ({ data: [{ embedding: vector }] })
const googleBody = (vector: unknown) => ({ embedding: { values: vector } })
const googleBatchBody = (vector: unknown) => ({
  embeddings: [{ values: vector }, { values: vector }]
})
const vertexBody = (vector: unknown) => ({
  predictions: [{ embeddings: { values: vector, statistics: { token_count: 1 } } }]
})

const adapters: {
  name: string
  create: (fetch: typeof globalThis.fetch) => EmbeddingModelV4
  body: (vector: unknown) => unknown
  vectors: (body: any) => number[][]
  values?: string[]
}[] = [
  {
    name: 'OpenAI',
    create: (fetch) => createOpenAI({ apiKey: 'fixture', fetch }).embedding('fixture'),
    body: openaiBody,
    vectors: (body) => body.data.map((item: any) => item.embedding)
  },
  {
    name: 'OpenAI compatible',
    create: (fetch) =>
      createOpenAICompatible({
        name: 'fixture',
        baseURL: 'https://embedding.example/v1',
        fetch
      }).embeddingModel('fixture'),
    body: openaiBody,
    vectors: (body) => body.data.map((item: any) => item.embedding)
  },
  {
    name: 'Azure OpenAI internal model',
    create: (fetch) =>
      createAzure({ resourceName: 'fixture', apiKey: 'fixture', fetch }).embedding('fixture'),
    body: openaiBody,
    vectors: (body) => body.data.map((item: any) => item.embedding)
  },
  {
    name: 'Google single',
    create: (fetch) => createGoogle({ apiKey: 'fixture', fetch }).embeddingModel('fixture'),
    body: googleBody,
    vectors: (body) => [body.embedding.values]
  },
  {
    name: 'Google batch',
    create: (fetch) => createGoogle({ apiKey: 'fixture', fetch }).embeddingModel('fixture'),
    body: googleBatchBody,
    vectors: (body) => body.embeddings.map((item: any) => item.values),
    values: ['first', 'second']
  },
  ...[createVertex, createVertexEdge].flatMap((create, index) => [
    {
      name: `Vertex ${index === 0 ? 'Node' : 'edge'} predict`,
      create: (fetch: typeof globalThis.fetch) =>
        create({ apiKey: 'fixture', fetch }).embeddingModel('text-embedding-005'),
      body: vertexBody,
      vectors: (body: any) => body.predictions.map((item: any) => item.embeddings.values)
    },
    {
      name: `Vertex ${index === 0 ? 'Node' : 'edge'} embedContent`,
      create: (fetch: typeof globalThis.fetch) =>
        create({ apiKey: 'fixture', fetch }).embeddingModel('gemini-embedding-2'),
      body: googleBody,
      vectors: (body: any) => [body.embedding.values]
    }
  ])
]

describe.each(adapters)('$name embedding response contract', (adapter) => {
  function embed(vector: unknown) {
    const body = JSON.stringify(adapter.body(vector))
      .replaceAll('"negative-zero"', '-0')
      .replaceAll('"overflow"', '1e309')
    const model = adapter.create(
      async () => new Response(body, { headers: { 'content-type': 'application/json' } })
    )
    return model.doEmbed({ values: adapter.values ?? ['fixture'] })
  }

  it('preserves finite numeric values and separates parsed vectors from the raw response', async () => {
    const vector = [0.25, -0.75, 0, -0, Math.fround(1e-40), 3.4e38, Number.MAX_VALUE]
    const result = await embed(
      vector.map((value) => (Object.is(value, -0) ? 'negative-zero' : value))
    )
    const rawVectors = adapter.vectors(result.response?.body)
    expect(result.embeddings).toEqual(rawVectors.map(() => vector))
    for (const [index, embedding] of result.embeddings.entries()) {
      expect(embedding).not.toBe(rawVectors[index])
      expect(Object.is(embedding[3], -0)).toBe(true)
      embedding[0] = 7
      expect(rawVectors[index][0]).toBe(0.25)
    }
  })

  it('preserves empty numeric arrays', async () => {
    const result = await embed([])
    expect(result.embeddings).toEqual(adapter.vectors(result.response?.body).map(() => []))
  })

  it('rejects nonnumeric, nonfinite and nonarray vectors before returning embeddings', async () => {
    for (const vector of [null, {}, 1, 'vector', [null], ['0.25'], [[1]], [true], ['overflow']]) {
      await expect(embed(vector)).rejects.toThrow()
    }
  })
})
