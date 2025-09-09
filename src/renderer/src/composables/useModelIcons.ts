// 导入所有 LLM provider 图标，与 ModelIcon.vue 保持一致
import adobeColorIcon from '@/assets/llm-icons/adobe-color.svg?url'
import zeaburColorIcon from '@/assets/llm-icons/zeabur-color.svg?url'
import zhipuColorIcon from '@/assets/llm-icons/zhipu-color.svg?url'
import volcengineColorIcon from '@/assets/llm-icons/volcengine-color.svg?url'
import wenxinColorIcon from '@/assets/llm-icons/wenxin-color.svg?url'
import workersaiColorIcon from '@/assets/llm-icons/workersai-color.svg?url'
import xuanyuanColorIcon from '@/assets/llm-icons/xuanyuan-color.svg?url'
import yiColorIcon from '@/assets/llm-icons/yi-color.svg?url'
import upstageColorIcon from '@/assets/llm-icons/upstage-color.svg?url'
import vertexaiColorIcon from '@/assets/llm-icons/vertexai-color.svg?url'
import viduColorIcon from '@/assets/llm-icons/vidu-color.svg?url'
import vllmColorIcon from '@/assets/llm-icons/vllm-color.svg?url'
import tiangongColorIcon from '@/assets/llm-icons/tiangong-color.svg?url'
import tiiColorIcon from '@/assets/llm-icons/tii-color.svg?url'
import togetherColorIcon from '@/assets/llm-icons/together-color.svg?url'
import tripoColorIcon from '@/assets/llm-icons/tripo-color.svg?url'
import udionColorIcon from '@/assets/llm-icons/udio-color.svg?url'
import tencentColorIcon from '@/assets/llm-icons/tencent-color.svg?url'
import tencentcloudColorIcon from '@/assets/llm-icons/tencentcloud-color.svg?url'
import sensenovaColorIcon from '@/assets/llm-icons/sensenova-color.svg?url'
import siliconcloudColorIcon from '@/assets/llm-icons/siliconcloud-color.svg?url'
import sparkColorIcon from '@/assets/llm-icons/spark-color.svg?url'
import stabilityColorIcon from '@/assets/llm-icons/stability-color.svg?url'
import stepfunColorIcon from '@/assets/llm-icons/stepfun-color.svg?url'
import qingyanColorIcon from '@/assets/llm-icons/qingyan-color.svg?url'
import qwenColorIcon from '@/assets/llm-icons/qwen-color.svg?url'
import deepseekColorIcon from '@/assets/llm-icons/deepseek-color.svg?url'
import openaiColorIcon from '@/assets/llm-icons/openai.svg?url'
import ollamaColorIcon from '@/assets/llm-icons/ollama.svg?url'
import doubaoColorIcon from '@/assets/llm-icons/doubao-color.svg?url'
import minimaxColorIcon from '@/assets/llm-icons/minimax-color.svg?url'
import fireworksColorIcon from '@/assets/llm-icons/fireworks-color.svg?url'
import zerooneColorIcon from '@/assets/llm-icons/zeroone.svg?url'
import xaiColorIcon from '@/assets/llm-icons/xai.svg?url'
import vercelColorIcon from '@/assets/llm-icons/vercel.svg?url'
import viggleColorIcon from '@/assets/llm-icons/viggle.svg?url'
import sunoColorIcon from '@/assets/llm-icons/suno.svg?url'
import syncColorIcon from '@/assets/llm-icons/sync.svg?url'
import rwkvColorIcon from '@/assets/llm-icons/rwkv.svg?url'
import ppioColorIcon from '@/assets/llm-icons/ppio-color.svg?url'
import tokenfluxColorIcon from '@/assets/llm-icons/tokenflux-color.svg?url'
import moonshotColorIcon from '@/assets/llm-icons/moonshot.svg?url'
import openrouterColorIcon from '@/assets/llm-icons/openrouter.svg?url'
import geminiColorIcon from '@/assets/llm-icons/gemini-color.svg?url'
import githubColorIcon from '@/assets/llm-icons/github.svg?url'
import azureOpenaiColorIcon from '@/assets/llm-icons/azure-color.svg?url'
import claudeColorIcon from '@/assets/llm-icons/claude-color.svg?url'
import googleColorIcon from '@/assets/llm-icons/google-color.svg?url'
import qiniuIcon from '@/assets/llm-icons/qiniu.svg?url'
import grokColorIcon from '@/assets/llm-icons/grok.svg?url'
import groqColorIcon from '@/assets/llm-icons/groq.svg?url'
import hunyuanColorIcon from '@/assets/llm-icons/hunyuan-color.svg?url'
import dashscopeColorIcon from '@/assets/llm-icons/alibabacloud-color.svg?url'
import aihubmixColorIcon from '@/assets/llm-icons/aihubmix.png?url'
import defaultIcon from '@/assets/logo.png?url'
import metaColorIcon from '@/assets/llm-icons/meta.svg?url'
import lmstudioColorIcon from '@/assets/llm-icons/lmstudio.svg?url'
import _302aiIcon from '@/assets/llm-icons/302ai.svg?url'
import modelscopeColorIcon from '@/assets/llm-icons/modelscope-color.svg?url'
import awsBedrockIcon from '@/assets/llm-icons/aws-bedrock.svg?url'

// 创建 providerId 到图标 URL 的映射，与 ModelIcon.vue 保持一致
const modelIconMap: Record<string, string> = {
  modelscope: modelscopeColorIcon,
  '302ai': _302aiIcon,
  aihubmix: aihubmixColorIcon,
  dashscope: dashscopeColorIcon,
  hunyuan: hunyuanColorIcon,
  grok: grokColorIcon,
  groq: groqColorIcon,
  qiniu: qiniuIcon,
  gemma: googleColorIcon,
  claude: claudeColorIcon,
  azure: azureOpenaiColorIcon,
  deepseek: deepseekColorIcon,
  lmstudio: lmstudioColorIcon,
  adobe: adobeColorIcon,
  openai: openaiColorIcon,
  ollama: ollamaColorIcon,
  doubao: doubaoColorIcon,
  minimax: minimaxColorIcon,
  fireworks: fireworksColorIcon,
  zeabur: zeaburColorIcon,
  zeroone: zerooneColorIcon,
  zhipu: zhipuColorIcon,
  vllm: vllmColorIcon,
  volcengine: volcengineColorIcon,
  wenxin: wenxinColorIcon,
  workersai: workersaiColorIcon,
  xai: xaiColorIcon,
  xuanyuan: xuanyuanColorIcon,
  yi: yiColorIcon,
  udio: udionColorIcon,
  upstage: upstageColorIcon,
  vercel: vercelColorIcon,
  vertexai: vertexaiColorIcon,
  vidu: viduColorIcon,
  viggle: viggleColorIcon,
  tiangong: tiangongColorIcon,
  tii: tiiColorIcon,
  together: togetherColorIcon,
  tripo: tripoColorIcon,
  stepfun: stepfunColorIcon,
  suno: sunoColorIcon,
  sync: syncColorIcon,
  tencent: tencentColorIcon,
  tencentcloud: tencentcloudColorIcon,
  rwkv: rwkvColorIcon,
  sensenova: sensenovaColorIcon,
  silicon: siliconcloudColorIcon,
  spark: sparkColorIcon,
  stability: stabilityColorIcon,
  ppio: ppioColorIcon,
  tokenflux: tokenfluxColorIcon,
  qingyan: qingyanColorIcon,
  qwen: qwenColorIcon,
  moonshot: moonshotColorIcon,
  openrouter: openrouterColorIcon,
  gemini: geminiColorIcon,
  github: githubColorIcon,
  anthropic: claudeColorIcon,
  gpt: openaiColorIcon,
  o1: openaiColorIcon,
  o3: openaiColorIcon,
  llama: metaColorIcon,
  o4: openaiColorIcon,
  glm: zhipuColorIcon,
  meta: metaColorIcon,
  'aws-bedrock': awsBedrockIcon,
  default: defaultIcon
}

export function getFaviconIcon(providerId?: string): string {
  try {
    if (!providerId) {
      return modelIconMap.default
    }

    const lowerProviderId = providerId.toLowerCase()

    // 直接匹配
    if (modelIconMap[lowerProviderId]) {
      return modelIconMap[lowerProviderId]
    }

    // 模糊匹配，参考 ModelIcon.vue 的逻辑
    const iconEntries = Object.keys(modelIconMap)
    const matchedIcon = iconEntries.find((key) => {
      return lowerProviderId.includes(key)
    })

    return matchedIcon ? modelIconMap[matchedIcon] : modelIconMap.default
  } catch (error) {
    console.warn('Error getting favicon icon:', error)
    return modelIconMap.default
  }
}

// 为了向后兼容，也导出这个函数给其他组件使用
export function getModelIcon(modelId: string): string {
  try {
    if (!modelId) {
      return modelIconMap.default
    }

    const modelIdLower = modelId.toLowerCase()
    const iconEntries = Object.keys(modelIconMap)

    // 查找匹配的图标
    const matchedIcon = iconEntries.find((key) => {
      return modelIdLower.includes(key)
    })
    return matchedIcon ? modelIconMap[matchedIcon] : modelIconMap.default
  } catch (error) {
    console.warn('Error getting model icon:', error)
    return modelIconMap.default
  }
}

// 导出图标映射给其他组件使用
export { modelIconMap }
