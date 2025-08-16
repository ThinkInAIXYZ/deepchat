import { MetricType } from '@shared/presenter'

export const EMBEDDING_TEST_KEY = 'sample'

/**
 * 计算向量的 L2 范数（欧几里得范数）
 * @param vector 输入向量
 * @returns
 */
function calcNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
}

/**
 * 判断一个向量是否已 normalized（L2 范数 ≈ 1）
 * @param vector 输入向量
 * @param tolerance 浮点误差容忍范围，默认 1e-3
 * @returns true 表示已 normalized
 */
export function isNormalized(vector: number[], tolerance = 1e-3): boolean {
  if (!vector || !Array.isArray(vector) || vector.length === 0) return false
  if (tolerance < 0) throw new Error('Tolerance must be non-negative')
  if (vector.some((v) => typeof v !== 'number' || !isFinite(v))) return false

  const norm = calcNorm(vector)
  return Math.abs(norm - 1) <= tolerance
}
/**
 * 向量 normalized 处理
 * @param vector 输入向量
 * @returns normalized 向量
 */
export function normalized(vector: number[]): number[] {
  if (!vector || !Array.isArray(vector) || vector.length === 0) {
    throw new Error('Vector cannot be empty')
  }
  const norm = calcNorm(vector)
  if (norm === 0) {
    throw new Error('Cannot normalize zero vector')
  }
  return vector.map((v) => v / norm)
}
/**
 * 必定返回 normalized 向量
 * @param vector 输入向量
 * @param tolerance 浮点误差容忍范围，默认 1e-3
 * @returns normalized 向量
 * @description 由于向量长度在多模态应用（或部分RAG应用）中有含义，因此未强制对embedding结果进行向量化，如有需要请自行调用
 */
export function ensureNormalized(vector: number[], tolerance = 1e-3): number[] {
  if (!vector || !Array.isArray(vector) || vector.length === 0) {
    throw new Error('Vector cannot be empty')
  }
  if (tolerance < 0) throw new Error('Tolerance must be non-negative')
  const norm = calcNorm(vector)
  if (norm === 0) {
    throw new Error('Cannot normalize zero vector')
  }
  if (Math.abs(norm - 1) <= tolerance) {
    return vector
  }
  return vector.map((v) => v / norm)
}

/**
 * 将 similarityQuery 返回的 distance 归一化为 [0,1] confidence
 * @param distance 原始 distance
 * @param metric 'cosine' | 'ip'
 * @returns 0~1 置信度值
 */
export function normalizeDistance(distance: number, metric: MetricType): number {
  if (metric === 'cosine') {
    // cosine distance ∈ [0,1]，0 越相似，1 越不相似
    // confidence = 1 - distance
    const clipped = Math.min(Math.max(distance, 0), 1)
    return 1 - clipped
  } else if (metric === 'ip') {
    // ip distance = -inner_product，可能为负数
    // distance < 0 → 向量夹角 < 90°，相似度高
    // distance = 0 → 向量正交，无相似性
    // distance > 0 → 向量夹角 > 90°，方向相反
    //
    // 使用 sigmoid 将其映射到 (0,1)
    // 这里使用 distance * k 来调整 sigmoid 的陡峭程度，需要根据经验和需求微调缩放因子k
    // k = 0.1 sigmoid 更平滑
    // k = 0.5 sigmoid 更陡峭
    const k = 0.04
    const sigmoid = 1 / (1 + Math.exp(Math.sign(distance) * Math.pow(distance, 2) * k))
    return sigmoid
  } else {
    throw new Error(`Unsupported metric: ${metric}`)
  }
}

/**
 * 获取相似度度量方式
 * @param normalized 是否已 normalized
 * @returns 相似度度量方式
 */
export function getMetric(normalized: boolean): MetricType {
  return normalized ? 'cosine' : 'ip'
}
